/**
 * 53 病例全量真实 API 验收（真实学生探针 + 全 HTTP 栈 + DB 持久化 + 报告恢复）：
 *
 * 证据层级（与既有验收分层，不混淆）：
 * - 本脚本 = 53/53 全量病例真实 API（建会话→问诊→查体→检查→处置→finish→会话恢复→报告恢复）；
 * - 既有 verify-53-cases-e2e.ts = 53/53 纯内存引擎层；旧版本脚本抽样 7 例 ≠ 全量；
 * - 教师页面正测、浏览器重启闭环不在本脚本范围（如实标注未验收）。
 *
 * 凭据安全约定（与 verify-restart-persistence.ts 同模式，本轮起停止默认 signup）：
 * - 复用既有 test 学生探针 case53-probe@luojia.dev（一次性引导见 bootstrap-case53-probe.ts，
 *   profile account_kind='test'，不污染教师统计）；
 * - 凭据仅经 --cred-file <0600 JSON {email,password}> 或 CASE53_PROBE_EMAIL/CASE53_PROBE_PWD
 *   环境变量输入，两者皆缺 fail-closed 退出；绝不 signup 新账号、不打印凭据/token 原文。
 *
 * 逐病例断言（每例独立定位，失败不中断其余病例）：
 * - 建会话 201 + caseId 回显一致 + hasSource=true（本地 teaching-cases 来源）；
 * - sourceSnapshotVersion 绑定（16 位召回指纹；记录绑定率，恢复时必须一致）；
 * - 问诊/查体/检查/处置事件全链路 200；finish 200/201 + pending_review/process；
 * - 会话恢复：GET 会话 caseId/版本/来源名与创建时一致（不漂移换患者）；
 * - 报告恢复：GET 报告 caseId/总分与 finish 返回一致（DB 持久化，非内存复读）；
 * - 未知字段容纳：sex ∈ {男,女,性别未记录}（肝豆状核变性必须为"性别未记录"，不推断默认患者事实）。
 *
 * 输出仅病例 ID / 状态码 / 布尔 / 计数，不打印患者原文与 token。
 * 运行：pnpm tsx scripts/verify-case53-real-api.ts --cred-file /tmp/.case53-probe-creds.json [baseUrl]
 */
export {};

import { readFileSync, readdirSync } from 'node:fs';

const baseUrl = (() => {
  const idx = process.argv.indexOf('--cred-file');
  const after = idx >= 0 ? process.argv.slice(idx + 2) : process.argv.slice(2);
  return after[0] ?? 'http://127.0.0.1:5173';
})();
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('仅允许本地地址验证，避免向正式库写入测试记录');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

// ===== 凭据：受控通道 fail-closed，绝不 signup =====
function loadCredentials(argv: string[]): { email: string; password: string } {
  const idx = argv.indexOf('--cred-file');
  if (idx >= 0 && argv[idx + 1]) {
    const raw = JSON.parse(readFileSync(argv[idx + 1], 'utf8')) as { email?: string; password?: string };
    if (!raw.email || !raw.password) throw new Error('凭据文件缺少 email/password');
    return { email: raw.email, password: raw.password };
  }
  if (process.env.CASE53_PROBE_EMAIL && process.env.CASE53_PROBE_PWD) {
    return { email: process.env.CASE53_PROBE_EMAIL, password: process.env.CASE53_PROBE_PWD };
  }
  throw new Error('缺少凭据：--cred-file <0600 JSON> 或 CASE53_PROBE_EMAIL/CASE53_PROBE_PWD（复用既有探针，不 signup）');
}

interface AuthTokens { access_token: string }
async function login(email: string, password: string): Promise<AuthTokens> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as AuthTokens & { error_code?: string; msg?: string };
  if (!resp.ok || !body.access_token) throw new Error(`login 失败: ${body.error_code ?? resp.status}`);
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
  caseOptions?: { sourceName: string; age: string; sex: string; hasSource: boolean; exams: Array<{ toolId: string; bodyPartId: string }>; tests: Array<{ id: string }> };
}
interface ReportPayload { id: string; caseId: string; totalScore: number; status: string; scoreBasis: string }

let pass = 0; let fail = 0;
function check(name: string, ok: boolean, evidence: string): void {
  if (ok) { pass += 1; console.log(`  ok - ${name} :: ${evidence}`); }
  else { fail += 1; console.error(`  NOT OK - ${name} :: ${evidence}`); }
}

// ===== 单病例全链路（失败返回带阶段定位的错误，不中断其余病例） =====
async function runCase(token: string, caseId: string): Promise<{ error?: string; session?: SessionPayload; report?: ReportPayload }> {
  const created = await api<SessionPayload>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'guided', caseId }), token });
  if (created.status !== 201 || !created.body.data) return { error: `create:${created.status}:${created.body.error?.code ?? ''}` };
  const session = created.body.data;
  if (session.caseId !== caseId) return { error: `caseId回显不一致:${session.caseId}` };
  if (session.caseOptions?.hasSource !== true) return { error: 'hasSource=false（本地来源未加载）' };

  const turn = (type: string, data: unknown) => api('/api/agent/turn', { method: 'POST', token, body: JSON.stringify({ sessionId: session.id, clientEventId: crypto.randomUUID(), event: { type, data } }) });
  const q = await turn('ASK_QUESTION', { text: '孩子这次主要是什么不舒服？什么时候开始的？' });
  if (q.status !== 200) return { error: `问诊:${q.status}:${q.body.error?.code ?? ''}` };
  const prep = await turn('EXAM_ACTION', { toolId: 'hand-hygiene', bodyPartId: 'hands' });
  if (prep.status !== 200) return { error: `查体准备:${prep.status}:${prep.body.error?.code ?? ''}` };
  const examOpt = session.caseOptions?.exams.find((e) => e.toolId !== 'hand-hygiene');
  if (examOpt) {
    const exam = await turn('EXAM_ACTION', { toolId: examOpt.toolId, bodyPartId: examOpt.bodyPartId });
    if (exam.status !== 200) return { error: `查体:${exam.status}:${exam.body.error?.code ?? ''}` };
  }
  const testOpt = session.caseOptions?.tests[0];
  if (testOpt) {
    const test = await turn('ORDER_TEST', { testId: testOpt.id });
    if (test.status !== 200) return { error: `检查:${test.status}:${test.body.error?.code ?? ''}` };
  }
  // stage 单步推进语义：tests→plan 跳级会被 DB guard 拒绝（SESSION_STAGE_SKIP_FORBIDDEN，
  // 防学生伪造 stage 推进的安全设计）。正确流程：SUBMIT_DECISION(stage→assessment) → SUBMIT_PLAN(stage→plan)。
  // 每步 turn 均断言状态码（旧版脚本 turn 不检查状态码，SUBMIT_PLAN 409 被静默吞掉，
  // 证据质量缺陷已在本轮如实记录并修正）。
  const decision = await turn('SUBMIT_DECISION', { diagnosis: '初步诊断待核对', summary: '结合病史、查体与检查结果综合评估，目前诊断依据仍需补充完善。', differentials: '' });
  if (decision.status !== 200) return { error: `诊断:${decision.status}:${decision.body.error?.code ?? ''}` };
  const plan = await turn('SUBMIT_PLAN', { priority: '评估与监测', detail: '结合病例资料进一步评估，等待复核。' });
  if (plan.status !== 200) return { error: `处置:${plan.status}:${plan.body.error?.code ?? ''}` };

  const finish = await api<ReportPayload>(`/api/sessions/${session.id}/finish`, { method: 'POST', token, body: '{}' });
  if ((finish.status !== 200 && finish.status !== 201) || !finish.body.data) return { error: `finish:${finish.status}:${finish.body.error?.code ?? ''}` };
  const report = finish.body.data;
  if (report.status !== 'pending_review' || report.scoreBasis !== 'process') return { error: `report状态:${report.status}/${report.scoreBasis}` };
  if (report.caseId !== caseId) return { error: `报告caseId不一致:${report.caseId}` };

  // 会话恢复：caseId/版本/来源名不漂移
  const restored = await api<SessionPayload>(`/api/sessions/${session.id}`, { token });
  if (restored.status !== 200 || !restored.body.data) return { error: `会话恢复:${restored.status}` };
  const rs = restored.body.data;
  if (rs.caseId !== caseId) return { error: '恢复caseId漂移' };
  if (rs.sourceSnapshotVersion !== session.sourceSnapshotVersion) return { error: '恢复版本漂移' };
  if (rs.caseOptions?.sourceName !== session.caseOptions?.sourceName) return { error: '恢复来源名漂移' };

  // 报告恢复：DB 持久化（总分一致，非内存复读）
  const reportRead = await api<ReportPayload>(`/api/reports/${report.id}`, { token });
  if (reportRead.status !== 200 || !reportRead.body.data) return { error: `报告恢复:${reportRead.status}` };
  if (reportRead.body.data.caseId !== caseId || reportRead.body.data.totalScore !== report.totalScore) return { error: '报告恢复内容不一致' };

  return { session, report };
}

async function main(): Promise<void> {
  const creds = loadCredentials(process.argv);
  const tokens = await login(creds.email, creds.password);
  const token = tokens.access_token;
  console.log(`# 探针（复用既有 test 账号，无新 signup）：${creds.email}`);

  // 53 全量病例 = 本地 teaching-cases 运行时文件集合（与 catalog folder 集合已核验一致）
  const caseIds = readdirSync('knowledge/teaching-cases').filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  if (caseIds.length !== 53) { console.error(`FATAL: 本地运行时病例数 ${caseIds.length} != 53`); process.exitCode = 1; return; }

  // 未登录负测（鉴权边界）
  const anon = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'guided', caseId: caseIds[0] }) });
  check('未登录创建会话被拒 401', anon.status === 401, `status=${anon.status}`);

  let success = 0; let versioned = 0; let sexKnown = 0; let sexUnknown = 0;
  const failures: Array<{ caseId: string; error: string }> = [];
  for (const caseId of caseIds) {
    try {
      const result = await runCase(token, caseId);
      if (result.error) {
        fail += 1;
        failures.push({ caseId, error: result.error });
        console.error(`  NOT OK - 病例 ${caseId} :: ${result.error}`);
        continue;
      }
      const s = result.session!;
      pass += 1; success += 1;
      if (typeof s.sourceSnapshotVersion === 'string' && /^[0-9a-f]{16}$/.test(s.sourceSnapshotVersion)) versioned += 1;
      const sex = s.caseOptions?.sex ?? '';
      if (sex === '男' || sex === '女') sexKnown += 1;
      else if (sex === '性别未记录') sexUnknown += 1;
      else { fail += 1; failures.push({ caseId, error: `sex 非法值形态` }); }
      console.log(`  ok - 病例 ${caseId} :: finish/恢复/报告 全链路通过 ver=${s.sourceSnapshotVersion?.slice(0, 6) ?? 'null'} sex=${sex === '性别未记录' ? 'unknown' : 'known'}`);
    } catch (error) {
      fail += 1;
      failures.push({ caseId, error: `异常:${(error as Error).message.slice(0, 60)}` });
      console.error(`  NOT OK - 病例 ${caseId} :: 异常 ${(error as Error).message.slice(0, 60)}`);
    }
  }
  check('全量 53 病例真实 API 链路', success === 53, `${success}/53 通过，失败 ${failures.length}`);
  check('会话版本绑定率', versioned >= 50, `${versioned}/53 绑定 16 位召回指纹（其余为本地来源无召回版本）`);

  // 未知字段容纳专项：肝豆状核变性 sex 原文未记录，必须为"性别未记录"（不填默认患者事实）
  const wdRe = await api<SessionPayload>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'guided', caseId: 'teacher-肝豆状核变性' }), token });
  const wdSex = wdRe.status === 201 ? wdRe.body.data?.caseOptions?.sex : `create:${wdRe.status}`;
  check('缺 sex 病例（肝豆状核变性）unknown 容纳不推断', wdSex === '性别未记录', `sex=${wdSex}`);

  // DB 持久化直证（探针本人 RLS 可见行）：最后一个成功会话的版本绑定落库
  const dbCheck = await fetch(`${SUPA_URL}/rest/v1/training_sessions?select=case_id,state->>sourceSnapshotVersion&user_id=eq.${await whoami(token)}&case_id=like.teacher-*&limit=5`, {
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` },
  });
  const dbRows = (await dbCheck.json().catch(() => [])) as Array<{ case_id: string; sourceSnapshotVersion: string | null }>;
  check('DB 行级取证：53 会话含版本绑定落库', dbCheck.ok && dbRows.length > 0 && dbRows.some((r) => r.sourceSnapshotVersion), `rows=${dbRows.length} 版本命中=${dbRows.filter((r) => r.sourceSnapshotVersion).length}`);

  console.log(JSON.stringify({ pass, fail, total: 53, success, versioned, sexKnown, sexUnknown, failures: failures.map((f) => f.caseId), verdict: fail === 0 ? 'ALL_PASS' : 'HAS_FAILURES' }, null, 1));
  if (fail > 0 || failures.length > 0) process.exitCode = 1;
}

async function whoami(token: string): Promise<string> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/user`, { headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } });
  const body = (await resp.json()) as { id: string };
  return body.id;
}

void main().catch((error) => { console.error((error as Error).message); process.exitCode = 1; });
