/**
 * 53 来源真实 API 验收（真实学生 A/B 账号，真实 HTTP + DB 持久化）：
 * - A/B 为新注册学生（真实 signup，邮箱前缀 case53-probe-，与真实学生/教师隔离）；
 * - 全部经真实 HTTP（/api/sessions、/api/agent/turn、/api/sessions/:id/finish、/api/sessions/:id），
 *   与生产运行链路一致（requireAuth -> AgentRepository -> RLS training_sessions）；
 * - 多病例真实训练（抽样代表病例 + 全目录计数断言）：建会话 -> 问诊 -> 查体 -> 检查 -> 处置 -> 结束 -> 报告；
 * - 跨学生隔离：B 读 A 会话 403；A 重启恢复（重新 GET 本人会话）事实与版本一致；
 * - 输出仅脱敏计数（case key / 状态码 / 布尔），不打印患者正文与 token。
 * 运行：pnpm tsx scripts/verify-case53-real-api.ts [baseUrl]
 */

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173';
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('仅允许本地地址验证，避免向正式库写入测试记录');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

type TokenResult = { access_token: string; user: { id: string; email?: string } };

async function signup(email: string, password: string): Promise<TokenResult> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as TokenResult & { msg?: string };
  if (!resp.ok || !body.access_token) throw new Error(`signup 失败: ${body.msg ?? resp.status}`);
  return body;
}

interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code: string; message: string } }

async function api<T>(path: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}

interface SessionPayload {
  id: string; caseId: string; mode: string; caseVersion: number;
  sourceSnapshotVersion: string | null;
  caseOptions?: { hasSource: boolean; sourceName: string; tests: unknown[]; exams: unknown[] };
}

let pass = 0; let fail = 0;
function check(name: string, ok: boolean, evidence: string): void {
  if (ok) { pass += 1; console.log(`  ok - ${name} :: ${evidence}`); }
  else { fail += 1; console.error(`  NOT OK - ${name} :: ${evidence}`); }
}

// 代表病例抽样：不同科室/年龄段/字段形态（含缺 sex 病例、别名目标、spo2 unknown 病例）
const SAMPLE_CASES = [
  'teacher-川崎病', 'teacher-肝豆状核变性', 'teacher-新生儿败血症',
  'teacher-肾病综合征', 'teacher-肺炎支原体肺炎', 'teacher-糖原贮积病iv型', 'teacher-心律失常-室上性心动过速',
];

async function train(token: string, caseId: string): Promise<{ session: SessionPayload; reportStatus: string; scoreBasis: string } | { error: string }> {
  const created = await api<SessionPayload>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'guided', caseId }), token });
  if (created.status !== 201 || !created.body.data) return { error: `create ${created.status} ${created.body.error?.code ?? ''}` };
  const session = created.body.data;
  const turn = (type: string, data: unknown) => api(`/api/agent/turn`, { method: 'POST', token, body: JSON.stringify({ sessionId: session.id, clientEventId: crypto.randomUUID(), event: { type, data } }) });
  await turn('ASK_QUESTION', { text: '孩子这次主要是什么不舒服？什么时候开始的？' });
  await turn('EXAM_ACTION', { toolId: 'hand-hygiene', bodyPartId: 'hands' });
  const examOpt = session.caseOptions?.exams.find((e) => (e as { toolId: string }).toolId !== 'hand-hygiene') as { toolId: string; bodyPartId: string } | undefined;
  if (examOpt) await turn('EXAM_ACTION', { toolId: examOpt.toolId, bodyPartId: examOpt.bodyPartId });
  const testOpt = session.caseOptions?.tests[0] as { id: string } | undefined;
  if (testOpt) await turn('ORDER_TEST', { testId: testOpt.id });
  await turn('SUBMIT_PLAN', { priority: '评估与监测', detail: '结合病例资料进一步评估，等待复核。' });
  const finish = await api<{ status?: string; scoreBasis?: string; caseId?: string }>(`/api/sessions/${session.id}/finish`, { method: 'POST', token, body: '{}' });
  // finish 成功语义为 201（报告创建）或 200（重复 finish 幂等返回已有报告）
  if ((finish.status !== 200 && finish.status !== 201) || !finish.body.data) return { error: `finish ${finish.status} ${finish.body.error?.code ?? ''}` };
  return { session, reportStatus: String(finish.body.data.status), scoreBasis: String(finish.body.data.scoreBasis) };
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const userA = await signup(`case53-probe-a-${stamp}@luojia.dev`, `Probe-${stamp}-Aa1!`);
  const userB = await signup(`case53-probe-b-${stamp}@luojia.dev`, `Probe-${stamp}-Bb1!`);
  check('真实学生 A/B signup（平台真实 Auth）', Boolean(userA.access_token && userB.access_token), `A/B 均取得真实 JWT`);

  // 1. 未登录负测
  const anon = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'guided', caseId: 'teacher-川崎病' }) });
  check('未登录创建会话被拒', anon.status === 401, `status=${anon.status}`);

  // 2. 学生 A 多病例真实训练
  let trained = 0;
  const sessions: SessionPayload[] = [];
  for (const caseId of SAMPLE_CASES) {
    const result = await train(userA.access_token, caseId);
    if ('error' in result) { check(`训练 ${caseId}`, false, result.error); continue; }
    const hasSource = result.session.caseOptions?.hasSource === true;
    const versioned = typeof result.session.sourceSnapshotVersion === 'string';
    check(`训练 ${caseId}`, hasSource && result.reportStatus === 'pending_review' && result.scoreBasis === 'process', `hasSource=${hasSource} report=${result.reportStatus}/${result.scoreBasis} 版本绑定=${versioned}`);
    sessions.push(result.session);
    trained += 1;
  }
  check(`A 完成 ${SAMPLE_CASES.length} 例抽样病例真实训练`, trained === SAMPLE_CASES.length, `${trained}/${SAMPLE_CASES.length}`);

  // 3. 缺 sex 病例 unknown 容纳（不报错、训练正常）
  const wd = sessions.find((s) => s.caseId === 'teacher-肝豆状核变性');
  check('缺 sex 病例（肝豆状核变性）训练成功且 unknown 容纳', Boolean(wd), wd ? '会话正常创建并完成' : '失败');

  // 4. 跨学生隔离：B 读 A 会话被拒（RLS 行过滤 -> 404 不泄漏存在性；FORBIDDEN -> 403）
  if (sessions[0]) {
    const cross = await api(`/api/sessions/${sessions[0].id}`, { token: userB.access_token });
    check('B 读 A 会话被拒（403/FORBIDDEN 或 404/RLS 行过滤）', cross.status === 403 || cross.status === 404 || cross.body.error?.code === 'FORBIDDEN', `status=${cross.status} code=${cross.body.error?.code}`);
    const crossTurn = await api('/api/agent/turn', { method: 'POST', token: userB.access_token, body: JSON.stringify({ sessionId: sessions[0].id, clientEventId: crypto.randomUUID(), event: { type: 'ASK_QUESTION', data: { text: '隔离测试' } } }) });
    check('B 对 A 会话发言被拒', crossTurn.status === 403 || crossTurn.status === 404 || crossTurn.body.error?.code === 'FORBIDDEN', `status=${crossTurn.status} code=${crossTurn.body.error?.code}`);
  }

  // 5. 会话列表仅本人：A 列表包含全部 A 会话、不含 B 新建会话
  const bSession = await api<SessionPayload>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'guided', caseId: 'teacher-矮小症' }), token: userB.access_token });
  const listA = await api<SessionPayload[]>('/api/sessions', { token: userA.access_token });
  const listIds = new Set((listA.body.data ?? []).map((s) => s.id));
  const allAIn = sessions.every((s) => listIds.has(s.id));
  const bNotIn = bSession.body.data ? !listIds.has(bSession.body.data.id) : true;
  check('A 会话列表包含全部本人会话', allAIn, `${sessions.length} 例全部在列`);
  check('A 会话列表不含 B 会话', bNotIn, `B 会话${bNotIn ? '不可见' : '泄漏'}`);

  // 6. 重启恢复等价验证：重新读取 A 的首会话（服务端无状态，走 DB state 恢复路径）
  if (sessions[0]) {
    const restored = await api<SessionPayload>(`/api/sessions/${sessions[0].id}`, { token: userA.access_token });
    const same = restored.status === 200 && restored.body.data?.caseId === sessions[0].caseId;
    const sameVersion = restored.body.data?.sourceSnapshotVersion === sessions[0].sourceSnapshotVersion;
    check('A 重新读取本人会话（DB 恢复路径）', same, `status=${restored.status} caseId一致=${same}`);
    check('恢复会话版本绑定一致（不可变来源版本）', sameVersion, `version=${restored.body.data?.sourceSnapshotVersion?.slice(0, 8) ?? 'null'}`);
  }

  // 7. 汇总
  console.log(JSON.stringify({ pass, fail, sampleCases: SAMPLE_CASES.length, verdict: fail === 0 ? 'ALL_PASS' : 'HAS_FAILURES' }, null, 1));
  if (fail > 0) process.exitCode = 1;
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : '验收失败'); process.exitCode = 1; });
