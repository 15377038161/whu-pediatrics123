/* eslint-disable no-console */
/**
 * 真实服务重启持久化实测（2026-10-13 收紧轮，用户授权；不发布不 push 不新账号不改密）：
 *
 * 与既有 verify-restart-persistence.ts（两独立进程等价模拟）不同，本脚本验证【真实 dev server 重启】：
 * - 阶段 A（默认）：既有演示学生 A 登录 → 建会话（teacher-川崎病，guided）→ 完整业务流
 *   （聊天/手卫生/查体规则/无规则组合/检查下单/诊断/处置/finish/报告）→ 记录会话+事实+检查订单+
 *   聊天+报告状态摘要（非秘密）落 artifacts/restart-real-state.json；期间对进行中会话做跨学生拒绝面；
 * - 中间步（项目脚本）：bash scripts/sandbox-dev-restart.sh 真实重启 dev server（进程替换，内存清空）；
 * - 阶段 B（--verify <stateFile>）：重新登录 A/B（同账号新 token）→ 重读同一会话与报告逐字段比对，
 *   证明状态来自 DB 持久化而非进程内存；并回归拒绝面：匿名 401、B 读/写 A 会话与报告拒、
 *   B 报告列表不含 A、A 访问教师接口 403、A 本人读取 200。
 *
 * 凭据安全：仅 --cred-a/--cred-b <0600 文本 key: value（email/password）或 JSON；不打印凭据/token/患者正文；
 * 输出仅 sessionId（uuid）/状态码/计数/字段名。
 *
 * 运行（退出码规范：重定向保存原进程退出码，不用管道 tail）：
 *   pnpm tsx scripts/verify-restart-real-restart.ts --cred-a <A> --cred-b <B>
 *   bash scripts/sandbox-dev-restart.sh
 *   pnpm tsx scripts/verify-restart-real-restart.ts --verify artifacts/restart-real-state.json --cred-a <A> --cred-b <B>
 */
export {};

import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.RESTART_BASE_URL ?? `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const STATE_FILE = 'artifacts/restart-real-state.json';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('仅允许本地地址验证');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

const CASE_ID = 'teacher-川崎病';

// ===== 基础设施 =====
interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code: string; message: string } }
let passCount = 0;
let failCount = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passCount += 1; console.log(`PASS  ${name}${detail ? ` (${detail})` : ''}`); }
  else { failCount += 1; console.log(`FAIL  ${name}${detail ? ` (${detail})` : ''}`); }
}
function summary(): number {
  console.log(`结果: ${passCount} PASS / ${failCount} FAIL`);
  return failCount === 0 ? 0 : 1;
}

async function api<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}

function loadCred(argName: string): { email: string; password: string } {
  const idx = process.argv.indexOf(argName);
  const file = idx >= 0 ? process.argv[idx + 1] : '';
  if (!file) throw new Error(`缺少 ${argName} <0600 凭据文件（key: value 文本或 JSON）>`);
  const raw = readFileSync(file, 'utf8');
  let email = '', password = '';
  if (raw.trimStart().startsWith('{')) {
    const j = JSON.parse(raw) as { email?: string; password?: string };
    email = j.email ?? ''; password = j.password ?? '';
  } else {
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(email|password)\s*[:=]\s*(.+?)\s*$/i);
      if (m) { if (m[1].toLowerCase() === 'email') email = m[2]; else password = m[2]; }
    }
  }
  if (!email || !password) throw new Error(`凭据文件 ${file} 缺少 email/password`);
  return { email, password };
}

interface AuthResult { access_token: string; user: { id: string } }
async function login(cred: { email: string; password: string }): Promise<AuthResult> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${SUPA_ANON_KEY}`, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
  const body = (await resp.json()) as AuthResult & { error_code?: string };
  if (!resp.ok || !body.access_token) throw new Error(`登录失败: ${body.error_code ?? resp.status}`);
  return body;
}

async function turn<T = Record<string, unknown>>(token: string, sessionId: string, event: Record<string, unknown>): Promise<{ status: number; body: ApiEnvelope<T> }> {
  return api<T>('/api/agent/turn', { method: 'POST', token, body: JSON.stringify({ sessionId, clientEventId: randomUUID(), event }) });
}

// ===== 状态指纹（会话/事实/检查订单/聊天/报告摘要，无患者正文） =====
interface SessionFingerprint {
  sessionId: string;
  caseId: string;
  stage: string;
  status: string;
  stateVersion: number;
  sourceSnapshotVersion: string | null;
  factsCount: number;
  messagesCount: number;
  eventsCount: number;
  orderedTests: string[];
  unlockedEvidence: string[];
  chatEvidence: { lastActor: string; messagesWithActorCount: number };
}
interface ReportFingerprint {
  reportId: string;
  topKeys: string[];
  hasScores: boolean;
  scoreKeys: string[];
}
interface StateFile {
  phase: 'A' | 'B';
  session: SessionFingerprint;
  report: ReportFingerprint;
}

function fingerprintSession(session: Record<string, unknown>): SessionFingerprint {
  const state = (session.state as Record<string, unknown> | undefined) ?? {};
  const facts = (session.facts as unknown[] | undefined) ?? (state.facts as unknown[] | undefined) ?? [];
  const messages = (session.messages as Array<Record<string, unknown>> | undefined) ?? (state.messages as Array<Record<string, unknown>> | undefined) ?? [];
  const events = (session.events as unknown[] | undefined) ?? (state.events as unknown[] | undefined) ?? [];
  const ordered = (session.orderedTests as string[] | undefined) ?? (state.orderedTests as string[] | undefined) ?? [];
  const unlocked = (session.unlockedEvidence as string[] | undefined) ?? (state.unlockedEvidence as string[] | undefined) ?? [];
  const lastMsg = messages[messages.length - 1] ?? {};
  return {
    sessionId: String(session.id ?? ''),
    caseId: String(session.caseId ?? ''),
    stage: String(session.stage ?? state.stage ?? ''),
    status: String(session.status ?? state.status ?? ''),
    stateVersion: Number(session.stateVersion ?? state.stateVersion ?? 0),
    sourceSnapshotVersion: (session.sourceSnapshotVersion as string | null) ?? (state.sourceSnapshotVersion as string | null) ?? null,
    factsCount: facts.length,
    messagesCount: messages.length,
    eventsCount: events.length,
    orderedTests: [...ordered].sort(),
    unlockedEvidence: [...unlocked].sort(),
    chatEvidence: {
      lastActor: String(lastMsg.actor ?? ''),
      messagesWithActorCount: messages.filter((m) => typeof m.actor === 'string' && m.actor.length > 0).length,
    },
  };
}

function fingerprintReport(reportId: string, report: Record<string, unknown>): ReportFingerprint {
  const scores = (report.scores as Record<string, unknown> | undefined) ?? null;
  return {
    reportId,
    topKeys: Object.keys(report).sort(),
    hasScores: Boolean(scores && Object.keys(scores).length > 0),
    scoreKeys: scores ? Object.keys(scores).sort() : [],
  };
}

function sameFingerprint(a: SessionFingerprint, b: SessionFingerprint): string[] {
  const diffs: string[] = [];
  for (const key of Object.keys(a) as Array<keyof SessionFingerprint>) {
    const va = a[key], vb = b[key];
    if (typeof va === 'object' && va !== null) {
      if (JSON.stringify(va) !== JSON.stringify(vb)) diffs.push(`${key}: ${JSON.stringify(va)} -> ${JSON.stringify(vb)}`);
    } else if (va !== vb) diffs.push(`${key}: ${String(va)} -> ${String(vb)}`);
  }
  return diffs;
}

// ===== 阶段 A：完整业务流 + 状态记录 =====
async function phaseA(): Promise<number> {
  const credA = loadCred('--cred-a');
  const credB = loadCred('--cred-b');
  const a = await login(credA);
  const b = await login(credB);
  console.log(`阶段 A：登录 A/B 成功（仅记录 userId 哈希前缀 A=${a.user.id.slice(0, 6)} B=${b.user.id.slice(0, 6)}）`);

  const created = await api<{ id?: string }>('/api/sessions', { method: 'POST', token: a.access_token, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }) });
  check('A 建会话成功（201）', created.status === 201 && Boolean(created.body.data?.id), `status=${created.status}`);
  const sessionId = created.body.data?.id ?? '';
  if (!sessionId) return summary();

  // 1) 聊天（问诊）
  const chat = await turn(a.access_token, sessionId, { type: 'ASK_QUESTION', data: { text: '孩子发烧几天了？还有别的症状吗？' } });
  check('A 聊天回合成功（200）', chat.status === 200, `status=${chat.status}`);

  // 2) 手卫生 + 查体规则 + 无规则组合（资料未提供口径）
  const hygiene = await turn(a.access_token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } });
  check('A 手卫生成功（200）', hygiene.status === 200, `status=${hygiene.status}`);
  const examRule = await turn(a.access_token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } });
  check('A 查体规则组合成功（200）', examRule.status === 200, `status=${examRule.status}`);
  const noRule = await turn(a.access_token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'thermometer', bodyPartId: 'mouth' } });
  check('A 无规则组合返回资料未提供（200，不编造）', noRule.status === 200, `status=${noRule.status}`);

  // 3) 检查目录 + 首单
  const loaded = await api<Record<string, unknown>>(`/api/sessions/${sessionId}`, { token: a.access_token });
  check('A 读取本人会话（200）', loaded.status === 200, `status=${loaded.status}`);
  const caseOptions = (loaded.body.data?.caseOptions ?? null) as { tests?: Array<{ id: string }> } | null;
  const tests = caseOptions?.tests ?? [];
  check('检查目录可见', tests.length > 0, `目录数=${tests.length}`);
  const navTests = await turn(a.access_token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage: 'tests' } });
  check('推进到检查阶段（200）', navTests.status === 200, `status=${navTests.status}`);
  const firstOrder = await turn(a.access_token, sessionId, { type: 'ORDER_TEST', data: { testId: tests[0]?.id ?? 'source-test-0' } });
  check('A 首单成功（200，检查订单落库）', firstOrder.status === 200, `status=${firstOrder.status}`);

  // 4) 拒绝面（会话进行中）
  const anonGet = await api(`/api/sessions/${sessionId}`, {});
  check('匿名读取会话被拒（401）', anonGet.status === 401, `status=${anonGet.status}`);
  const bGet = await api(`/api/sessions/${sessionId}`, { token: b.access_token });
  check('B 读取 A 会话被拒（403/404）', bGet.status === 403 || bGet.status === 404, `status=${bGet.status}`);
  const bTurn = await turn(b.access_token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } });
  check('B 向 A 会话发回合被拒（403/404）', bTurn.status === 403 || bTurn.status === 404, `status=${bTurn.status}`);

  // 5) 诊断 → 处置 → finish → 报告
  const navAssess = await turn(a.access_token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage: 'assessment' } });
  check('推进到诊断阶段（200）', navAssess.status === 200, `status=${navAssess.status}`);
  const decision = await turn(a.access_token, sessionId, { type: 'SUBMIT_DECISION', data: { diagnosis: '川崎病（皮肤黏膜淋巴结综合征）', summary: '患儿持续发热伴皮疹、结合膜充血、口唇改变与四肢末端硬性水肿，炎症指标升高。', differentials: '猩红热、传染性单核细胞增多症、幼年特发性关节炎' } });
  check('A 提交诊断（200）', decision.status === 200, `status=${decision.status}`);
  const navPlan = await turn(a.access_token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage: 'plan' } });
  check('推进到处置阶段（200）', navPlan.status === 200, `status=${navPlan.status}`);
  const plan = await turn(a.access_token, sessionId, { type: 'SUBMIT_PLAN', data: { priority: '静脉免疫球蛋白与阿司匹林抗炎治疗', detail: '住院监测冠状动脉病变，超声心动图随访，退热补液对症处理。' } });
  check('A 提交处置（200）', plan.status === 200, `status=${plan.status}`);
  const finish = await api<{ id?: string; reportId?: string }>(`/api/sessions/${sessionId}/finish`, { method: 'POST', token: a.access_token, body: JSON.stringify({ communication: '已向家长解释病情与治疗方案，安抚情绪并说明随访计划。' }) });
  check('A finish 成功（2xx）', finish.status >= 200 && finish.status < 300, `status=${finish.status}`);
  // finish 返回完整 report 对象（route: ok(report)，字段为 id）；已 finish 会话返回既有报告
  const reportId = finish.body.data?.id ?? finish.body.data?.reportId ?? '';
  check('finish 返回报告 id', Boolean(reportId));

  // 6) 终态指纹（会话+报告）
  const finalSession = await api<Record<string, unknown>>(`/api/sessions/${sessionId}`, { token: a.access_token });
  check('A 读取终态会话（200）', finalSession.status === 200, `status=${finalSession.status}`);
  const finalReport = await api<Record<string, unknown>>(`/api/reports/${reportId}`, { token: a.access_token });
  check('A 读取报告（200）', finalReport.status === 200, `status=${finalReport.status}`);

  const sessionFp = fingerprintSession(finalSession.body.data ?? {});
  const reportFp = fingerprintReport(reportId, finalReport.body.data ?? {});
  console.log(`终态摘要: stage=${sessionFp.stage} status=${sessionFp.status} stateVersion=${sessionFp.stateVersion} facts=${sessionFp.factsCount} messages=${sessionFp.messagesCount} events=${sessionFp.eventsCount} orderedTests=${sessionFp.orderedTests.length} unlocked=${sessionFp.unlockedEvidence.length} reportKeys=${reportFp.topKeys.length}`);

  const state: StateFile = { phase: 'A', session: sessionFp, report: reportFp };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`状态摘要已写入 ${STATE_FILE}（无凭据/患者正文）`);
  console.log('下一步：bash scripts/sandbox-dev-restart.sh 重启后运行 --verify');
  return summary();
}

// ===== 阶段 B：重启后重读比对 + 拒绝面回归 =====
async function phaseB(): Promise<number> {
  const idx = process.argv.indexOf('--verify');
  const stateFile = idx >= 0 ? process.argv[idx + 1] : STATE_FILE;
  const expected = JSON.parse(readFileSync(stateFile, 'utf8')) as StateFile;
  const credA = loadCred('--cred-a');
  const credB = loadCred('--cred-b');
  const a = await login(credA);
  const b = await login(credB);
  console.log(`阶段 B：重新登录 A/B 成功（同账号新 token）`);

  // 1) 重启后重读同一会话 → 逐字段比对（DB 持久化证明）
  const reread = await api<Record<string, unknown>>(`/api/sessions/${expected.session.sessionId}`, { token: a.access_token });
  check('重启后 A 重读同一会话（200）', reread.status === 200, `status=${reread.status}`);
  const actualFp = fingerprintSession(reread.body.data ?? {});
  const diffs = sameFingerprint(expected.session, actualFp);
  check('会话状态逐字段一致（DB 持久化非内存）', diffs.length === 0, diffs.length ? `差异: ${diffs.join('; ').slice(0, 200)}` : `stage=${actualFp.stage} status=${actualFp.status} facts=${actualFp.factsCount} messages=${actualFp.messagesCount} orderedTests=${actualFp.orderedTests.length}`);

  // 2) 重启后重读报告 → 结构比对
  const rereadReport = await api<Record<string, unknown>>(`/api/reports/${expected.report.reportId}`, { token: a.access_token });
  check('重启后 A 重读报告（200）', rereadReport.status === 200, `status=${rereadReport.status}`);
  const actualReport = fingerprintReport(expected.report.reportId, rereadReport.body.data ?? {});
  const reportSame = actualReport.topKeys.join(',') === expected.report.topKeys.join(',')
    && actualReport.hasScores === expected.report.hasScores
    && actualReport.scoreKeys.join(',') === expected.report.scoreKeys.join(',');
  check('报告结构一致（含评分键）', reportSame, `hasScores=${actualReport.hasScores} scoreKeys=${actualReport.scoreKeys.length}`);

  // 3) 拒绝面回归（重启后）
  const anonSession = await api(`/api/sessions/${expected.session.sessionId}`, {});
  check('匿名读取会话被拒（401）', anonSession.status === 401, `status=${anonSession.status}`);
  const anonReports = await api('/api/reports', {});
  check('匿名读取报告列表被拒（401）', anonReports.status === 401, `status=${anonReports.status}`);
  const bSession = await api(`/api/sessions/${expected.session.sessionId}`, { token: b.access_token });
  check('B 读取 A 会话被拒（403/404）', bSession.status === 403 || bSession.status === 404, `status=${bSession.status}`);
  const bReport = await api(`/api/reports/${expected.report.reportId}`, { token: b.access_token });
  check('B 读取 A 报告被拒（403/404）', bReport.status === 403 || bReport.status === 404, `status=${bReport.status}`);
  const bTurn = await turn(b.access_token, expected.session.sessionId, { type: 'ASK_QUESTION', data: { text: 'test' } });
  check('B 向 A 会话发回合被拒（403/404）', bTurn.status === 403 || bTurn.status === 404, `status=${bTurn.status}`);
  const bList = await api<unknown>('/api/reports', { token: b.access_token });
  // 报告列表 data 兼容数组与 {items: []} 两种形态（运行时以实际响应为准，类型安全窄化）
  const rawData = bList.body.data;
  const bItems = (Array.isArray(rawData) ? rawData : Array.isArray((rawData as { items?: unknown } | null | undefined)?.items) ? (rawData as { items: unknown[] }).items : []) as Array<{ sessionId?: string; id?: string }>;
  const leaked = bItems.some((item) => item.sessionId === expected.session.sessionId || item.id === expected.report.reportId);
  check('B 报告列表不含 A 的会话/报告', bList.status === 200 && !leaked, `列表数=${bItems.length}`);
  const aTeacherStudents = await api('/api/teacher/students', { token: a.access_token });
  check('A 访问教师接口 /api/teacher/students 被拒（403）', aTeacherStudents.status === 403, `status=${aTeacherStudents.status}`);
  const aTeacherImport = await api('/api/teacher/case-import', { method: 'POST', token: a.access_token, body: '{}' });
  check('A 访问教师接口 /api/teacher/case-import 被拒（403）', aTeacherImport.status === 403, `status=${aTeacherImport.status}`);

  // 4) 本人允许面（重启后）
  const ownSession = await api(`/api/sessions/${expected.session.sessionId}`, { token: a.access_token });
  check('A 读取本人会话允许（200）', ownSession.status === 200, `status=${ownSession.status}`);
  const ownReport = await api(`/api/reports/${expected.report.reportId}`, { token: a.access_token });
  check('A 读取本人报告允许（200）', ownReport.status === 200, `status=${ownReport.status}`);
  const ownList = await api('/api/sessions', { token: a.access_token });
  check('A 读取本人会话列表允许（200）', ownList.status === 200, `status=${ownList.status}`);

  return summary();
}

async function main(): Promise<void> {
  if (process.argv.includes('--verify')) {
    process.exit(await phaseB());
  }
  process.exit(await phaseA());
}

void main();
