/* eslint-disable no-console */
/**
 * 会话作用域恢复修复——真实平台双会话回归（仅现有合法学生演示身份）。
 *
 * 验证点（对应 0c03075 修复 + 本轮 caseOptions 非破坏性刷新）：
 * 1) 同一学生账号建两会话 A/B（同一真实已发布病例、同一绑定版本）；
 * 2) A 走正常操作链（手卫生准备→真实查体动作）解锁一项查体证据；B 保持零查体动作；
 * 3) AB/BA 两种恢复顺序 + 可控并发（Promise.all）下：
 *    - B 的回合响应不含 A 已解锁的查体结果（内容哈希比对，不输出病例文本）；
 *    - A 不因 B 的恢复丢失已解锁证据与查体结果（再次执行同动作仍有结果）；
 * 4) 查体闭环实证：投影剥离（未查体）时，经 prep 证据 → RPC 返回查体事实 → 查体动作
 *    可获得真实结果（检查/查体不因会话作用域化永远空）；
 * 5) caseOptions 非破坏性刷新：prep 解锁后 UI 目录字段（exams 列表）跟随当前投影；
 * 6) orderedTests 死锁记录（补偿迁移 20261015100000 恢复原门控后的已知未决问题）：
 *    仅结构性记录，不伪造开单、不猜 testId；合法修复（目录/结果分离）待用户授权；
 * 7) 学生作用域读不到教师/共享缓存：RPC 非本人会话 null、RLS 直读被拒/空；
 * 8) 正常训练→finish 报告链路：scoreBasis=process、status=pending_review
 *    （诊断/计划/沟通提交因死锁被 DB 防跳级触发器 409 拦截，属触发器正确工作，记录不算失败）。
 *
 * 安全边界：不创建账号、不伪造 JWT、不提权、不放宽 RLS；凭据经 /tmp 受控文件读取，
 * 不进命令行/输出/日志；仅输出状态码、结构断言、哈希与计数；结束 signOut(global)。
 *
 * 运行：pnpm tsx scripts/verify-session-scoped-restore.ts
 */
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

const baseUrl = process.env.RESTORE_BASE_URL ?? `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const CRED_FILE = process.env.COLDSTART_REAL_CRED_FILE ?? '/tmp/demo-student-credentials.txt';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('仅允许本地 dev server 地址');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

const CASE_ID = 'teacher-川崎病'; // 与既有真实平台脚本同病例（已验证可建会话且教师已导入）

/** createSourceCase 的全部查体定义组合（toolId/bodyPartId），按序尝试至解锁一项 */
const EXAM_COMBOS: Array<[string, string]> = [
  ['stethoscope', 'chest'],
  ['inspection', 'skin'],
  ['tongue-depressor', 'mouth'],
  ['palpation', 'abdomen'],
  ['thermometer', 'forehead'],
  ['oximeter', 'finger'],
  ['bp-cuff', 'upper-arm'],
  ['flashlight', 'forehead'],
  ['reflex-hammer', 'limbs'],
];

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function loadCredentials(): { email: string; password: string } {
  const raw = readFileSync(CRED_FILE, 'utf8');
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([a-zA-Z_]+)\s*[:=]\s*(.+?)\s*$/);
    if (match) map.set(match[1].toLowerCase(), match[2]);
  }
  const email = map.get('email');
  const password = map.get('password');
  if (!email || !password) throw new Error(`凭据文件 ${CRED_FILE} 缺少 email/password`);
  return { email, password };
}

interface AuthTokens { access_token: string; refresh_token: string }

async function login(email: string, password: string): Promise<AuthTokens> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as AuthTokens & { error_code?: string };
  if (!resp.ok || !body.access_token || !body.refresh_token) throw new Error(`登录失败: ${body.error_code ?? resp.status}`);
  return body;
}

async function signOutGlobal(tokens: AuthTokens): Promise<boolean> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.access_token}` },
  });
  return resp.ok;
}

interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code: string; message: string } }
async function api<T>(path: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}

interface TurnData {
  session: {
    id: string;
    unlockedEvidence: string[];
    orderedTests: string[];
    caseOptions?: { hasSource?: boolean; exams?: unknown[]; tests?: unknown[] } | null;
    messages?: Array<{ actor: string; content: string }>;
  };
  newMessages: Array<{ actor: string; content: string }>;
}

let eventSeq = 0;
async function turn(token: string, sessionId: string, event: Record<string, unknown>): Promise<{ status: number; body: ApiEnvelope<TurnData> }> {
  eventSeq += 1;
  return api<TurnData>('/api/agent/turn', {
    method: 'POST', token,
    body: JSON.stringify({ sessionId, clientEventId: `verify-scoped-${sessionId.slice(0, 8)}-${eventSeq}`, event }),
  });
}

interface Check { name: string; pass: boolean }
const checks: Check[] = [];
function check(name: string, pass: boolean): void {
  checks.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
}
/** 记录性证据（不算通过/失败，输出结构性观测值供报告引用） */
function observe(name: string, value: unknown): void {
  console.log(`OBS   ${name}: ${JSON.stringify(value)}`);
}

function sourceExEvidence(session: TurnData['session']): string[] {
  return (session.unlockedEvidence ?? []).filter((code) => code.startsWith('SOURCE_EX_'));
}

async function main(): Promise<void> {
  const creds = loadCredentials();
  const tokens = await login(creds.email, creds.password);
  const token = tokens.access_token;
  check('真实平台：学生演示身份登录成功', true);

  // ---- 建两会话 A/B（同一病例；期望绑定同一版本） ----
  const createdA = await api<{ id: string; caseId: string; sourceSnapshotVersion?: string | null; caseOptions?: { hasSource?: boolean } | null }>('/api/sessions', {
    method: 'POST', token, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }),
  });
  if (createdA.status !== 201 || !createdA.body.data) throw new Error(`创建会话 A 失败: ${createdA.status} ${createdA.body.error?.code ?? ''}`);
  const sessionA = createdA.body.data.id;
  const versionA = createdA.body.data.sourceSnapshotVersion ?? null;
  check('建会话 A：绑定版本指纹（16 位 hex）', /^[0-9a-f]{16}$/.test(versionA ?? ''));
  const createdB = await api<{ id: string; sourceSnapshotVersion?: string | null }>('/api/sessions', {
    method: 'POST', token, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }),
  });
  if (createdB.status !== 201 || !createdB.body.data) throw new Error(`创建会话 B 失败: ${createdB.status} ${createdB.body.error?.code ?? ''}`);
  const sessionB = createdB.body.data.id;
  check('建会话 B：与 A 绑定同一版本（同病例同版本）', createdB.body.data.sourceSnapshotVersion === versionA);

  // ---- A：手卫生准备（合法临床操作链第一步） ----
  const prep = await turn(token, sessionA, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } });
  const prepEvidence = prep.body.data?.session.unlockedEvidence ?? [];
  check('A 准备动作：手卫生成功且解锁 EX_PREP 证据', prep.status === 200 && prepEvidence.includes('EX_PREP'));

  // ---- BA 顺序：B 先恢复（读回），A 后执行真实查体（B 的恢复不得影响 A） ----
  const bReadBefore = await api<TurnData['session'] & { caseOptions?: { hasSource?: boolean } | null }>(`/api/sessions/${sessionB}`, { token });
  check('BA顺序：B 恢复读回成功（hasSource=true）', bReadBefore.status === 200 && Boolean((bReadBefore.body.data as unknown as { caseOptions?: { hasSource?: boolean } })?.caseOptions?.hasSource));

  // ---- caseOptions 非破坏性刷新实证：prep 证据解锁后，目录查体列表跟随当前投影 ----
  const aReadAfterPrep = await api<TurnData['session'] & { caseOptions?: { exams?: unknown[] } | null }>(`/api/sessions/${sessionA}`, { token });
  const aExamOptions = (aReadAfterPrep.body.data as unknown as { caseOptions?: { exams?: unknown[] } })?.caseOptions?.exams?.length ?? 0;
  observe('A prep 后 caseOptions.exams 数量（修复后应 >1）', aExamOptions);
  check('caseOptions 刷新：prep 解锁后查体目录列表跟随投影（exams>1）', aReadAfterPrep.status === 200 && aExamOptions > 1);

  // ---- A：真实查体动作（按序尝试组合至解锁一项）——查体闭环实证 ----
  let unlockedCombo: [string, string] | null = null;
  let unlockedEvidenceCode = '';
  let examResultSha = '';
  for (const combo of EXAM_COMBOS) {
    const result = await turn(token, sessionA, { type: 'EXAM_ACTION', data: { toolId: combo[0], bodyPartId: combo[1] } });
    if (result.status !== 200) throw new Error(`A 查体动作 HTTP ${result.status}: ${result.body.error?.code ?? ''}`);
    const gained = sourceExEvidence(result.body.data?.session ?? { id: '', unlockedEvidence: [], orderedTests: [] } as TurnData['session']);
    if (gained.length > 0 && (result.body.data?.newMessages ?? []).length > 0) {
      unlockedCombo = combo;
      unlockedEvidenceCode = gained[0];
      examResultSha = sha(result.body.data!.newMessages[0].content);
      break;
    }
  }
  check('查体闭环：A 经 prep 证据→投影扩展→真实查体动作获得结果（解锁 SOURCE_EX_ 证据）', unlockedCombo !== null);
  observe('A 解锁组合与结果哈希（不输出内容）', { combo: unlockedCombo, evidence: unlockedEvidenceCode, resultSha: examResultSha });

  // ---- AB 顺序：A 已解锁后，B 恢复并尝试同一动作——B 不得泄露 A 已解锁内容 ----
  const bReadAfter = await api<TurnData['session']>(`/api/sessions/${sessionB}`, { token });
  check('AB顺序：B 恢复读回成功', bReadAfter.status === 200);
  const bAttempt = await turn(token, sessionB, { type: 'EXAM_ACTION', data: { toolId: unlockedCombo![0], bodyPartId: unlockedCombo![1] } });
  const bNewMessages = bAttempt.body.data?.newMessages ?? [];
  const bEvidence = sourceExEvidence(bAttempt.body.data?.session ?? { id: '', unlockedEvidence: [], orderedTests: [] } as TurnData['session']);
  check('B 零动作隔离：同动作响应无任何结果消息（newMessages=0）', bAttempt.status === 200 && bNewMessages.length === 0);
  check('B 零动作隔离：B 未解锁任何 SOURCE_EX_ 查体证据', bEvidence.length === 0);
  const bMessages = (bReadAfter.body.data?.messages ?? []).map((m) => sha(m.content));
  const bTurnShas = bNewMessages.map((m) => sha(m.content));
  check('B 零动作隔离：B 会话与响应均不含 A 的查体结果哈希', !bMessages.includes(examResultSha) && !bTurnShas.includes(examResultSha));

  // ---- A 不因 B 的恢复丢失已解锁内容：再读回 + 重复同动作仍有结果 ----
  const aReadAfterB = await api<TurnData['session']>(`/api/sessions/${sessionA}`, { token });
  const aEvidenceKept = (aReadAfterB.body.data?.unlockedEvidence ?? []);
  check('A 保持性：B 恢复后 A 已解锁证据未丢失（EX_PREP + SOURCE_EX_ 均在）', aEvidenceKept.includes('EX_PREP') && aEvidenceKept.includes(unlockedEvidenceCode));
  const aRepeat = await turn(token, sessionA, { type: 'EXAM_ACTION', data: { toolId: unlockedCombo![0], bodyPartId: unlockedCombo![1] } });
  const aRepeatMessages = aRepeat.body.data?.newMessages ?? [];
  check('A 保持性：B 恢复后 A 重复同动作仍获得查体结果（newMessages>0）', aRepeat.status === 200 && aRepeatMessages.length > 0);
  check('A 保持性：重复结果与首次结果内容一致（哈希相等）', aRepeatMessages.length > 0 && sha(aRepeatMessages[0].content) === examResultSha);

  // ---- 可控并发：A/B 同时恢复读回，互不影响 ----
  const [aConc, bConc] = await Promise.all([
    api<TurnData['session']>(`/api/sessions/${sessionA}`, { token }),
    api<TurnData['session']>(`/api/sessions/${sessionB}`, { token }),
  ]);
  const aConcEvidence = (aConc.body.data?.unlockedEvidence ?? []);
  const bConcEvidence = sourceExEvidence(bConc.body.data ?? { id: '', unlockedEvidence: [], orderedTests: [] } as TurnData['session']);
  const bConcMessages = (bConc.body.data?.messages ?? []).map((m) => sha(m.content));
  check('并发恢复：A/B 同时读回均 200', aConc.status === 200 && bConc.status === 200);
  check('并发恢复：A 证据保持、B 无查体证据且不含 A 结果哈希', aConcEvidence.includes(unlockedEvidenceCode) && bConcEvidence.length === 0 && !bConcMessages.includes(examResultSha));

  // ---- orderedTests 死锁记录（补偿迁移 20261015100000 恢复原门控后的已知未决问题）：
  //      开单依赖投影目录（caseOptions.tests 由 sections.tests 解析），目录又被"已开单"
  //      门控剥离 → 学生无法开出第一张检查单。仅结构记录，不伪造开单、不猜 testId；
  //      合法修复（目录/结果分离）方案与风险见验收记录，待用户授权后实施。
  const aReadForTests = await api<TurnData['session'] & { caseOptions?: { tests?: Array<{ id: string }> } | null }>(`/api/sessions/${sessionA}`, { token });
  const testCatalog = (aReadForTests.body.data as unknown as { caseOptions?: { tests?: Array<{ id: string }> } })?.caseOptions?.tests ?? [];
  observe('orderedTests 死锁记录：查体后 caseOptions.tests 目录数量（补偿门控下预期 0）', testCatalog.length);
  check('死锁边界：查体证据不解锁 tests 全文目录（补偿门控生效，tests=0）', aReadForTests.status === 200 && testCatalog.length === 0);

  // ---- 学生作用域读不到教师/共享缓存（RPC 归属校验 + RLS 直读拒绝） ----
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rpcForeign } = await db.rpc('case_snapshot_get_facts', {
    p_case_id: CASE_ID, p_version: versionA ?? '', p_session_id: randomUUID(),
  });
  check('作用域隔离：RPC 非本人会话返回 null', rpcForeign === null || rpcForeign === undefined);
  const { data: direct, error: directError } = await db.from('case_snapshot_facts').select('case_id,version').limit(1);
  check('作用域隔离：学生 RLS 直读 case_snapshot_facts 被拒/空', Boolean(directError) || (direct ?? []).length === 0);

  // ---- 死锁症状记录：stage 停留 exam（tests 阶段经合法开单不可达），诊断/计划/沟通提交
  //      被 DB 防跳级触发器拦截（409 SESSION_STAGE_SKIP_FORBIDDEN）——触发器正确工作，
  //      记录不算失败；死锁修复（目录/结果分离）授权后该链路自然恢复。 ----
  const decision = await turn(token, sessionA, { type: 'SUBMIT_DECISION', data: { diagnosis: '合成验收诊断（非病例内容）', summary: '合成验收摘要：围绕主诉与已获取证据形成结构化判断，用于报告链路验证。', differentials: '合成鉴别（验收）' } });
  const plan = await turn(token, sessionA, { type: 'SUBMIT_PLAN', data: { priority: '监测与复评（合成验收）', detail: '合成验收处置计划：结构化记录优先级与后续安排。' } });
  const communication = await turn(token, sessionA, { type: 'SEND_COMMUNICATION', data: { text: '我理解您的担心，我们会一步步说明风险和下一步安排（合成验收）。' } });
  observe('死锁症状：诊断/计划/沟通提交状态码（预期 409/409/200）', { decision: decision.status, plan: plan.status, communication: communication.status });
  // decision/plan 推进 stage（assessment/plan），从 exam 跳过 tests 被防跳级触发器拦截；
  // communication 不改 stage（stage 不回退修复后），任意阶段合法——200 是修复正确效果。
  check('死锁症状：诊断/计划被防跳级拦截（409），沟通不回退 stage（200）', decision.status === 409 && plan.status === 409 && communication.status === 200);
  const finished = await api<{ scoreBasis?: string; status?: string; totalScore?: number }>(`/api/sessions/${sessionA}/finish`, { method: 'POST', token, body: JSON.stringify({}) });
  const report = finished.body.data ?? {};
  observe('finish 报告（结构性）', { status: finished.status, scoreBasis: report.scoreBasis ?? null, reportStatus: report.status ?? null, totalScore: report.totalScore ?? null });
  check('finish 链路：报告生成 201 且过程分口径（scoreBasis=process）', finished.status === 201 && report.scoreBasis === 'process');
  check('finish 链路：报告状态 pending_review（事实不足不冒充临床评分）', report.status === 'pending_review');

  // ---- 收尾 ----
  const revoked = await signOutGlobal(tokens);
  check('收尾：signOut(global) 撤销本次会话', revoked);

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n==== 真实平台会话作用域双会话回归（学生演示身份）：${checks.length - failed}/${checks.length} 通过 ====`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main().catch((e: unknown) => {
  console.error('真实平台验证异常：', (e as Error).message);
  process.exitCode = 1;
});
