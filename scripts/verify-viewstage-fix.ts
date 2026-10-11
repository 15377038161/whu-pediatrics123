/* eslint-disable no-console */
/**
 * 沉浸式/guided 处置后「返回会话中心」409 阻断修复复测（2026-10-17 收紧轮第五阶段；
 * 只读 DB 查询 + 正常业务会话写入，零账号新建零权限变更）：
 *
 * 修复内容（d6ac4f3 后最小修正）：SessionState 新增 viewStage（回看展示阶段）——
 * 非 OSCE 的「非前进一格」导航（回看已完成阶段/返回会话中心/同格重进）只记录 viewStage，
 * 不修改业务阶段 stage（DB 防回退触发器语义保持不变）；前进一格正常推进并清回看态。
 * OSCE 防作弊约束不变（回退仍被拒）。
 *
 * 复测项（API 层）：
 * 1. guided 会话（teacher-川崎病）走完整业务流至 plan（处置完成，stage='plan'）；
 * 2. 处置后 NAVIGATE_STAGE history（修复前 409）→ 200，viewStage='history'，stage 保持 'plan'；
 * 3. 回看态问诊（ASK_QUESTION）→ 200（回看态沟通合法，stage 不变）；
 * 4. 回看态沟通（SEND_COMMUNICATION）→ 200（session.communication 记录，stage 不变）；
 * 5. 重读会话（GET）→ viewStage='history' 持久化、stage='plan'（已完成阶段持久化）；
 * 6. 回看其他已完成阶段（NAVIGATE_STAGE assessment）→ 200，viewStage 切换，stage 保持；
 * 7. 回看会话中心完成闭环：FINISH_SESSION → 200，报告可读（修复前 UI 无法到达 finish 按钮）；
 * 8. OSCE 防作弊回归：osce 会话前进至 exam 后 NAVIGATE_STAGE history → 仍被拒（409）；
 * 9. 匿名导航 → 401。
 *
 * 输出仅 sessionId 前缀/状态码/字段值/计数，零患者正文零凭据。
 * 运行（退出码规范）：
 *   pnpm tsx scripts/verify-viewstage-fix.ts --cred <0600 学生凭据>
 */
export {};

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.COVER_BASE_URL ?? `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('仅允许本地地址验证');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

const CASE_ID = 'teacher-川崎病';

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

interface ApiEnvelope<T> { ok?: boolean; data?: T; error?: { code?: string } }
async function api<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}
async function turn<T = Record<string, unknown>>(token: string, sessionId: string, event: Record<string, unknown>): Promise<{ status: number; body: ApiEnvelope<T> }> {
  return api<T>('/api/agent/turn', { method: 'POST', token, body: JSON.stringify({ sessionId, clientEventId: randomUUID(), event }) });
}

function loadCred(): { email: string; password: string } {
  const idx = process.argv.indexOf('--cred');
  const file = idx >= 0 ? process.argv[idx + 1] : '';
  if (!file) throw new Error('缺少 --cred <0600 凭据文件>');
  let email = '', password = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(email|password)\s*[:=]\s*(.+?)\s*$/i);
    if (m) { if (m[1].toLowerCase() === 'email') email = m[2]; else password = m[2]; }
  }
  if (!email || !password) throw new Error('凭据文件缺少 email/password');
  return { email, password };
}
interface AuthResult { access_token: string }
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

interface SessionData {
  id?: string; stage?: string; viewStage?: string; status?: string;
  caseOptions?: { tests?: Array<{ id: string }> } | null;
}
/** /api/agent/turn 响应体 data 形状（会话嵌套于 session 键下）。 */
interface TurnData { session?: SessionData }

async function main(): Promise<void> {
  const token = (await login(loadCred())).access_token;

  // ===== 1) guided 会话走完整业务流至 plan =====
  const created = await api<{ id?: string }>('/api/sessions', { method: 'POST', token, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }) });
  check('建会话成功（201）', created.status === 201 && Boolean(created.body.data?.id), `status=${created.status}`);
  const sessionId = created.body.data?.id ?? '';
  if (!sessionId) { process.exit(summary()); }

  const chat = await turn(token, sessionId, { type: 'ASK_QUESTION', data: { text: '孩子发烧几天了？还有别的症状吗？' } });
  check('问诊回合成功（200）', chat.status === 200, `status=${chat.status}`);
  const hygiene = await turn(token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } });
  check('手卫生成功（200）', hygiene.status === 200, `status=${hygiene.status}`);
  await turn(token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } });
  const loaded1 = await api<SessionData>(`/api/sessions/${sessionId}`, { token });
  const tests = loaded1.body.data?.caseOptions?.tests ?? [];
  check('检查目录可见', tests.length > 0, `目录数=${tests.length}`);
  const navTests = await turn(token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage: 'tests' } });
  check('前进到检查阶段（200，前进一格）', navTests.status === 200, `status=${navTests.status}`);
  const firstOrder = await turn(token, sessionId, { type: 'ORDER_TEST', data: { testId: tests[0]?.id ?? 'source-test-0' } });
  check('检查首单成功（200）', firstOrder.status === 200, `status=${firstOrder.status}`);
  const navAssess = await turn(token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage: 'assessment' } });
  check('前进到诊断阶段（200）', navAssess.status === 200, `status=${navAssess.status}`);
  const decision = await turn(token, sessionId, { type: 'SUBMIT_DECISION', data: { diagnosis: '川崎病（皮肤黏膜淋巴结综合征）', summary: '患儿持续发热伴皮疹、结合膜充血、口唇改变与四肢末端硬性水肿，炎症指标升高。', differentials: '猩红热、传染性单核细胞增多症' } });
  check('诊断提交成功（200）', decision.status === 200, `status=${decision.status}`);
  const navPlan = await turn(token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage: 'plan' } });
  check('前进到处置阶段（200）', navPlan.status === 200, `status=${navPlan.status}`);
  const plan = await turn<TurnData>(token, sessionId, { type: 'SUBMIT_PLAN', data: { priority: '静脉免疫球蛋白与阿司匹林抗炎治疗', detail: '住院监测冠状动脉病变，超声心动图随访，退热补液对症处理。' } });
  check('处置提交成功（200，业务阶段 stage=plan）', plan.status === 200 && plan.body.data?.session?.stage === 'plan', `status=${plan.status} stage=${plan.body.data?.session?.stage ?? 'n/a'}`);

  // ===== 2) 修复核心：处置后 NAVIGATE_STAGE history（修复前 409）=====
  const backHome = await turn<TurnData>(token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage: 'history' } });
  check('处置后返回会话中心（200，修复前 409）', backHome.status === 200, `status=${backHome.status}`);
  check('返回会话中心只记 viewStage（stage 保持 plan）', backHome.body.data?.session?.viewStage === 'history' && backHome.body.data?.session?.stage === 'plan', `viewStage=${backHome.body.data?.session?.viewStage ?? 'n/a'} stage=${backHome.body.data?.session?.stage ?? 'n/a'}`);

  // ===== 3) 回看态问诊 =====
  const reAsk = await turn<TurnData>(token, sessionId, { type: 'ASK_QUESTION', data: { text: '孩子之前有没有类似的发烧情况？' } });
  check('回看态问诊合法（200，沟通任意阶段合法）', reAsk.status === 200, `status=${reAsk.status}`);
  check('回看态问诊不改业务阶段', reAsk.body.data?.session?.stage === 'plan' && reAsk.body.data?.session?.viewStage === 'history', `stage=${reAsk.body.data?.session?.stage ?? 'n/a'} viewStage=${reAsk.body.data?.session?.viewStage ?? 'n/a'}`);

  // ===== 4) 回看态沟通 =====
  const comm = await turn<TurnData>(token, sessionId, { type: 'SEND_COMMUNICATION', data: { text: '目前考虑川崎病，需要住院完善心脏超声检查，我们会密切随访孩子的病情变化。' } });
  check('回看态沟通合法（200，communication 记录）', comm.status === 200, `status=${comm.status}`);
  check('回看态沟通不改业务阶段（stage 保持 plan）', comm.body.data?.session?.stage === 'plan', `stage=${comm.body.data?.session?.stage ?? 'n/a'}`);

  // ===== 5) 重读会话：viewStage 持久化 + 已完成阶段持久化 =====
  const reloaded = await api<SessionData>(`/api/sessions/${sessionId}`, { token });
  check('重读会话成功（200）', reloaded.status === 200, `status=${reloaded.status}`);
  check('viewStage 持久化（重读仍为 history）', reloaded.body.data?.viewStage === 'history', `viewStage=${reloaded.body.data?.viewStage ?? 'n/a'}`);
  check('业务阶段持久化（重读仍为 plan，已完成阶段不清空）', reloaded.body.data?.stage === 'plan' && reloaded.body.data?.status === 'active', `stage=${reloaded.body.data?.stage ?? 'n/a'} status=${reloaded.body.data?.status ?? 'n/a'}`);

  // ===== 6) 回看其他已完成阶段 =====
  const viewAssess = await turn<TurnData>(token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage: 'assessment' } });
  check('回看诊断阶段（200，viewStage 切换）', viewAssess.status === 200 && viewAssess.body.data?.session?.viewStage === 'assessment' && viewAssess.body.data?.session?.stage === 'plan', `viewStage=${viewAssess.body.data?.session?.viewStage ?? 'n/a'} stage=${viewAssess.body.data?.session?.stage ?? 'n/a'}`);

  // ===== 7) 回看会话中心完成闭环：finish + 报告 =====
  const backHome2 = await turn(token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage: 'history' } });
  check('再次返回会话中心（200）', backHome2.status === 200, `status=${backHome2.status}`);
  const finish = await api<{ id?: string }>(`/api/sessions/${sessionId}/finish`, { method: 'POST', token, body: '{}' });
  check('回看态完成训练（finish 200/201，修复前 UI 无法到达 finish 按钮）', (finish.status === 200 || finish.status === 201) && Boolean(finish.body.data?.id), `status=${finish.status}`);
  const reportId = finish.body.data?.id ?? '';
  if (reportId) {
    const report = await api<Record<string, unknown>>(`/api/reports/${reportId}`, { token });
    check('报告可读（200）', report.status === 200, `status=${report.status}`);
  }

  // ===== 8) OSCE 防作弊回归 =====
  const osceCreated = await api<{ id?: string }>('/api/sessions', { method: 'POST', token, body: JSON.stringify({ mode: 'osce', caseId: CASE_ID }) });
  check('OSCE 建会话成功（201）', osceCreated.status === 201 && Boolean(osceCreated.body.data?.id), `status=${osceCreated.status}`);
  const osceId = osceCreated.body.data?.id ?? '';
  if (osceId) {
    await turn(token, osceId, { type: 'ASK_QUESTION', data: { text: '孩子哪里不舒服？' } });
    // OSCE 前进一格到查体阶段（问诊阶段直发查体被事件门控拒绝，须先前进）
    const osceFwd = await turn(token, osceId, { type: 'NAVIGATE_STAGE', data: { stage: 'exam' } });
    check('OSCE 前进到查体阶段（200）', osceFwd.status === 200, `status=${osceFwd.status}`);
    const osceHygiene = await turn(token, osceId, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } });
    check('OSCE 查体阶段手卫生成功（200）', osceHygiene.status === 200, `status=${osceHygiene.status}`);
    const osceBack = await turn(token, osceId, { type: 'NAVIGATE_STAGE', data: { stage: 'history' } });
    check('OSCE 防回退不回归（前进至查体后返回 history 仍被拒 409）', osceBack.status === 409, `status=${osceBack.status}`);
    const osceView = await turn<TurnData>(token, osceId, { type: 'NAVIGATE_STAGE', data: { stage: 'exam' } });
    check('OSCE 同格导航不误伤（当前 exam 再点 exam，200）', osceView.status === 200 && osceView.body.data?.session?.stage === 'exam' && osceView.body.data?.session?.viewStage === undefined, `status=${osceView.status} stage=${osceView.body.data?.session?.stage ?? 'n/a'} viewStage=${osceView.body.data?.session?.viewStage ?? 'n/a'}`);
  }

  // ===== 9) 匿名拒绝 =====
  const anonNav = await fetch(`${BASE}/api/agent/turn`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, clientEventId: randomUUID(), event: { type: 'NAVIGATE_STAGE', data: { stage: 'history' } } }),
  });
  check('匿名导航被拒（401）', anonNav.status === 401, `status=${anonNav.status}`);

  console.log('注：会话为正常业务写入（guided 1 个 + osce 1 个新会话，非历史修改）；DB 防回退触发器与 OSCE 约束均未改动。');
  process.exit(summary());
}

void main();
