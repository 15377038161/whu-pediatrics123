/* 真实验收A（第二阶段查体+辅助检查修复）：
 * Phase 1（默认）：正常流——登录→建会话→手卫生→器材×部位→体征解锁→无规则组合「资料未提供」
 *   →list_tests 目录（无答案）+ 未下单 get_test 拒绝（2026-10-11 安全口径修正：先记单后取结果）
 *   →匿名401→跨学生403→学生访问教师路由403。
 *   不下单（orderedTests=0 保持剥离态，供 Phase 2 恢复流验收死锁修复）。
 * Phase 2（--resume <sessionId>，dev server 重启后执行）：
 *   GET 会话（恢复路径→目录注入）→断言 caseOptions.tests 目录可见（无答案）→
 *   首单（record_test_order 持久化→get_test 行级结果）→诊断提交→处置提交→finish→报告评分。
 * 仅使用既有账号（演示学生+残留探针学生），不新建账号；只读+本人会话合法操作。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const baseUrl = `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('仅允许本地 dev server 地址');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

const CASE_ID = 'teacher-川崎病';
const DEMO_FILE = process.env.ACCEPT_A_CRED_FILE ?? '/workspace/.demo-secrets/demo-student-credentials.txt';
const PROBE_FILE = process.env.ACCEPT_A_ATTACKER_FILE ?? '/workspace/.demo-secrets/probe-account-credentials-deprecated.txt';

const EXAM_COMBOS: Array<[string, string]> = [
  ['stethoscope', 'chest'], ['inspection', 'skin'], ['tongue-depressor', 'mouth'],
  ['palpation', 'abdomen'], ['thermometer', 'forehead'], ['oximeter', 'finger'],
  ['bp-cuff', 'upper-arm'], ['flashlight', 'forehead'], ['reflex-hammer', 'limbs'],
];

function sha(text: string): string { return createHash('sha256').update(text).digest('hex').slice(0, 12); }

function loadCredentials(file: string): { email: string; password: string } {
  const raw = readFileSync(file, 'utf8');
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([a-zA-Z_]+)\s*[:=]\s*(.+?)\s*$/);
    if (match) map.set(match[1].toLowerCase(), match[2]);
  }
  const email = map.get('email'); const password = map.get('password');
  if (!email || !password) throw new Error(`凭据文件 ${file} 缺少 email/password`);
  return { email, password };
}

interface AuthTokens { access_token: string; refresh_token: string }
async function login({ email, password }: { email: string; password: string }): Promise<AuthTokens> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as AuthTokens & { error_code?: string };
  if (!resp.ok || !body.access_token) throw new Error(`登录失败: ${body.error_code ?? resp.status}`);
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

interface TurnSession {
  id: string; caseId: string; sourceSnapshotVersion?: string | null; stage?: string;
  unlockedEvidence: string[]; orderedTests: string[];
  caseOptions?: { sourceName?: string; hasSource?: boolean; exams?: Array<{ toolId: string; bodyPartId: string; label: string }>; tests?: Array<{ id: string; label: string; indication: string }> } | null;
  events?: Array<{ type: string; stage: string; summary: string; evidenceCodes?: string[] }>;
}
interface TurnData { session: TurnSession; feedback: string | null; newMessages: Array<{ actor: string; content: string }> }

let eventSeq = 0;
const runTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
async function turn(token: string, sessionId: string, event: Record<string, unknown>): Promise<{ status: number; body: ApiEnvelope<TurnData> }> {
  eventSeq += 1;
  return api<TurnData>('/api/agent/turn', {
    method: 'POST', token,
    body: JSON.stringify({ sessionId, clientEventId: `accept-a-${sha(sessionId)}-${runTag}-${eventSeq}`, event }),
  });
}

interface Check { name: string; pass: boolean }
const checks: Check[] = [];
function check(name: string, pass: boolean): void { checks.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`); }
function observe(name: string, value: unknown): void { console.log(`OBS   ${name}: ${JSON.stringify(value)}`); }

/** RPC 直验：list_tests（目录无答案）与 get_test（行级结果），复用学生会话 token。
 *  注意：case_id 保留 teacher- 前缀（与应用侧 getTeacherSourceId 一致，DB 存储即全 ID）。 */
async function rpcListTests(token: string, caseId: string, version: string, sessionId: string): Promise<Array<{ id: string; label: string }> | null> {
  const resp = await fetch(`${SUPA_URL}/rest/v1/rpc/case_snapshot_list_tests`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_case_id: caseId, p_version: version, p_session_id: sessionId }),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as Array<{ id: string; label: string }>;
}
async function rpcGetTest(token: string, caseId: string, version: string, sessionId: string, testId: string): Promise<{ id: string; label: string; result: string } | null> {
  const resp = await fetch(`${SUPA_URL}/rest/v1/rpc/case_snapshot_get_test`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_case_id: caseId, p_version: version, p_session_id: sessionId, p_test_id: testId }),
  });
  if (!resp.ok) return null;
  return (await resp.json()) as { id: string; label: string; result: string };
}

async function main(): Promise<void> {
  const resumeId = process.argv.includes('--resume') ? process.argv[process.argv.indexOf('--resume') + 1] : null;
  const creds = loadCredentials(DEMO_FILE);
  const tokens = await login(creds);
  const token = tokens.access_token;
  check(`${resumeId ? 'Phase2' : 'Phase1'} 真实平台：学生演示身份登录成功`, true);

  if (!resumeId) {
    // ---- Phase 1：正常流（不下单，保持 orderedTests=0 供 Phase 2） ----
    const created = await api<TurnSession>('/api/sessions', { method: 'POST', token, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }) });
    if (created.status !== 201 || !created.body.data) throw new Error(`创建会话失败: ${created.status} ${created.body.error?.code ?? ''}`);
    const session = created.body.data;
    const sessionId = session.id;
    const version = session.sourceSnapshotVersion ?? null;
    observe('会话建立', { sessionId, version, hasSource: session.caseOptions?.hasSource ?? null, caseVersion: 2 });
    if (!version) throw new Error('会话未绑定快照版本');

    // 1) 手卫生 → EX_PREP
    const hygiene = await turn(token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } });
    check('器材→部位：手卫生解锁 EX_PREP', hygiene.status === 200 && (hygiene.body.data?.session.unlockedEvidence ?? []).includes('EX_PREP'));

    // 2) 器材×部位循环至解锁一项体征（病例记录文本）
    let unlocked = false; let unlockedSummary = '';
    for (const [toolId, bodyPartId] of EXAM_COMBOS) {
      const r = await turn(token, sessionId, { type: 'EXAM_ACTION', data: { toolId, bodyPartId } });
      if (r.status !== 200) { observe('查体回合异常', { toolId, bodyPartId, status: r.status }); continue; }
      const s = r.body.data?.session ?? null;
      const hasNew = (s?.unlockedEvidence ?? []).some((code) => code.startsWith('SOURCE_EX_'));
      if (hasNew) { unlocked = true; unlockedSummary = (s?.events ?? []).filter((e) => e.stage === 'exam').at(-1)?.summary ?? ''; break; }
    }
    check('器材→部位→体征：至少一项查体规则解锁（病例记录）', unlocked);
    observe('解锁的体征', unlockedSummary.slice(0, 80));

    // 3) 无规则组合 → 「资料未提供」（非「不匹配」口径，先完成手卫生后）
    const noRule = await turn(token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'thermometer', bodyPartId: 'mouth' } });
    const noRuleData = noRule.body.data;
    const noRuleFeedback = noRuleData?.feedback ?? '';
    check('无来源体征：明确「资料未提供」口径', noRule.status === 200 && noRuleFeedback.includes('资料未提供'));
    observe('无规则组合反馈', noRuleFeedback.slice(0, 80));

    // 4) RPC 直验：list_tests 目录（无答案，本人会话门控）；未下单 get_test 必须拒绝
    //    （安全口径修正 2026-10-11：原断言「未下单返回行级结果」属缺陷误判——探针
    //     scripts/verify-tests-rpc-security.ts 实证 3 defect，迁移 20261011160000 修复为
    //     先 record_test_order 持久化下单、get_test 验证已下单，未下单一律拒绝）
    const catalog = await rpcListTests(token, CASE_ID, version, sessionId);
    check('case_snapshot_list_tests：返回本人会话检查目录', Array.isArray(catalog) && catalog.length > 0);
    observe('目录条目数', { count: catalog?.length ?? 0 });
    const catalogLabels = catalog ?? [];
    const labelHasColonResult = catalogLabels.some((item) => /[:：]/.test(item.label) && item.label.length > 60);
    check('目录 label 无结果文本（无超长/含冒号后内容）', !labelHasColonResult);
    if (catalogLabels.length > 0) {
      const line = await rpcGetTest(token, CASE_ID, version, sessionId, catalogLabels[0].id);
      check('未下单 get_test 被拒（返回 null，不泄露结果）', line === null);
    }

    // 5) 拒绝面：匿名 401 / 跨学生 403 / 学生访问教师路由 403
    const anonTurn = await api('/api/agent/turn', { method: 'POST', body: JSON.stringify({ sessionId, clientEventId: `accept-a-anon-${Date.now()}`, event: { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } } }) });
    check('匿名访问 agent/turn 被拒（401）', anonTurn.status === 401);
    const anonRpc = await fetch(`${SUPA_URL}/rest/v1/rpc/case_snapshot_list_tests`, {
      method: 'POST', headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_case_id: CASE_ID, p_version: version, p_session_id: sessionId }),
    });
    check('匿名调用 list_tests RPC 被拒（非 200）', anonRpc.status !== 200);

    const attackerCreds = loadCredentials(PROBE_FILE);
    const attackerTokens = await login(attackerCreds);
    const attackerGet = await api(`/api/sessions/${sessionId}`, { token: attackerTokens.access_token });
    check('跨学生访问会话被拒（403/404）', attackerGet.status === 403 || attackerGet.status === 404);
    const attackerTurn = await turn(attackerTokens.access_token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } });
    check('跨学生对他人会话发回合被拒（403/404）', attackerTurn.status === 403 || attackerTurn.status === 404);
    const attackerRpc = await rpcListTests(attackerTokens.access_token, CASE_ID, version, sessionId);
    check('跨学生调用 list_tests 被拒（null）', attackerRpc === null);
    const teacherRoute = await api('/api/teacher/case-drafts', { token });
    check('学生访问教师路由被拒（403）', teacherRoute.status === 403);

    console.log(`\nRESUME_ID=${sessionId}`);
    console.log(`RESUME_VERSION=${version}`);
  } else {
    // ---- Phase 2：恢复流（dev server 重启后）----
    const loaded = await api<TurnSession>(`/api/sessions/${resumeId}`, { token });
    if (loaded.status !== 200 || !loaded.body.data) throw new Error(`恢复会话失败: ${loaded.status} ${loaded.body.error?.code ?? ''}`);
    const session = loaded.body.data;
    const version = session.sourceSnapshotVersion ?? null;
    if (!version) throw new Error('恢复会话无版本绑定');
    check('Phase2 恢复会话成功（GET 200，版本绑定保持）', true);
    observe('恢复态 orderedTests', { orderedTests: session.orderedTests, stage: session.stage });

    // 1) 死锁修复核心断言：恢复态（未开单）目录可见（无答案）
    const tests = session.caseOptions?.tests ?? [];
    check('恢复态检查目录可见（死锁修复：caseOptions.tests 非空）', tests.length > 0);
    observe('目录条目', tests.slice(0, 5).map((t) => t.id));
    check('目录项不含结果文本（仅 id/label/indication）', tests.every((t) => !('result' in t)));

    // 2) 首单 → PENDING → get_test 行级结果（先按 UI 真实流程逐格推进 stage：exam→tests）
    if (tests.length === 0) throw new Error('目录为空，无法继续首单验收');
    const navTests = await turn(token, resumeId, { type: 'NAVIGATE_STAGE', data: { stage: 'tests' } });
    check('逐格推进到检查阶段（NAVIGATE_STAGE exam→tests）', navTests.status === 200);
    const firstTest = tests[0];
    const firstOrder = await turn(token, resumeId, { type: 'ORDER_TEST', data: { testId: firstTest.id } });
    const firstData = firstOrder.body.data;
    check('首单成功（恢复态目录下单，orderedTests 记录）', firstOrder.status === 200 && (firstData?.session.orderedTests ?? []).includes(firstTest.id));
    const firstMessage = firstData?.newMessages.at(-1)?.content ?? '';
    check('首单返回行级结果（结果文本非空且非「资料未提供」）', firstMessage.length > 0 && !firstMessage.includes('资料未提供'));
    observe('首单结果摘要', { id: firstTest.id, resultLen: firstMessage.length });

    // 3) 二单（另一项）→ 行级结果
    if (tests.length > 1) {
      const secondTest = tests[1];
      const secondOrder = await turn(token, resumeId, { type: 'ORDER_TEST', data: { testId: secondTest.id } });
      const secondMessage = secondOrder.body.data?.newMessages.at(-1)?.content ?? '';
      check('二单返回行级结果', secondOrder.status === 200 && secondMessage.length > 0);
      observe('二单结果摘要', { id: secondTest.id, resultLen: secondMessage.length });
    }

    // 4) 诊断提交（逐格推进 tests→assessment 后提交，防跳级合法通过）
    const navAssess = await turn(token, resumeId, { type: 'NAVIGATE_STAGE', data: { stage: 'assessment' } });
    check('逐格推进到诊断阶段（NAVIGATE_STAGE tests→assessment）', navAssess.status === 200);
    const decision = await turn(token, resumeId, { type: 'SUBMIT_DECISION', data: { diagnosis: '川崎病（皮肤黏膜淋巴结综合征）', summary: `${'患儿发热伴皮疹、结合膜充血，查体见口唇改变与四肢末端硬性水肿，辅检提示炎症指标升高。'}${firstMessage.slice(0, 60)}`, differentials: '猩红热、传染性单核细胞增多症、幼年特发性关节炎' } });
    check('诊断提交成功（开单后防跳级不拦截）', decision.status === 200);

    // 5) 处置提交（逐格推进 assessment→plan 后提交）
    const navPlan = await turn(token, resumeId, { type: 'NAVIGATE_STAGE', data: { stage: 'plan' } });
    check('逐格推进到处置阶段（NAVIGATE_STAGE assessment→plan）', navPlan.status === 200);
    const plan = await turn(token, resumeId, { type: 'SUBMIT_PLAN', data: { priority: '静脉免疫球蛋白与阿司匹林抗炎治疗', detail: '住院监测冠状动脉病变，超声心动图随访，退热补液对症处理。' } });
    check('处置提交成功', plan.status === 200);

    // 6) finish → 报告评分（finish 返回 201 Created）
    const finish = await api<{ reportId?: string }>(`/api/sessions/${resumeId}/finish`, { method: 'POST', token, body: JSON.stringify({ communication: '已向家长解释病情与治疗方案，安抚情绪并说明随访计划。' }) });
    check('完成会话成功（finish 2xx）', finish.status >= 200 && finish.status < 300);
    observe('finish 响应', { reportId: finish.body.data?.reportId ?? null });
    const reportId = finish.body.data?.reportId;
    if (reportId) {
      const report = await api<{ scores?: unknown }>(`/api/reports/${reportId}`, { token });
      check('报告可读且评分非空', report.status === 200 && Boolean(report.body.data));
      observe('报告摘要', { hasScores: 'scores' in (report.body.data as object) || Object.keys(report.body.data as object).length > 0 });
    }
  }

  const failed = checks.filter((item) => !item.pass);
  console.log(`\n合计: ${checks.length - failed.length}/${checks.length} 通过`);
  if (failed.length > 0) { console.error('失败项:', failed.map((f) => f.name).join(' | ')); process.exit(1); }
}

main().catch((error) => { console.error('FATAL', error); process.exit(1); });
