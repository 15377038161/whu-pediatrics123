/* 真实验收（shouldUseModel 对齐后角色 LLM 链路）：
 * 1. 既有账号（演示学生）真实登录拿 JWT，走 Bearer 直连本地 dev server；
 * 2. guided 会话连续 4 轮 ASK_QUESTION（起病/发热/咳嗽/用药问哪答哪域），
 *    断言 200 与角色回复非空（回复内容不外显，仅内部判定）；
 * 3. agent_call_records 落库核验：问诊轮 execution ∈ {model, model_fallback}
 *    （修复前平台凭据漏检恒 deterministic），输出 execution 计数；
 * 4. 内容质量计数（不输出内容）：
 *    - 年龄匹配：患儿回复无医学术语（3岁2个月儿童语言）；
 *    - 问哪答哪：每轮回复含该问题域关键词（命中数/总数）；
 *    - 不复述问题：逐字复读问题违规计数=0；
 *    - 不讲课：治疗建议/诊断口吻标记违规计数=0；
 *    - 单聊天流：全部角色消息经同一 newMessages 数组返回（单聊天流轮数=总轮数）；
 * 5. 返回 history 不因 plan 误切沟通：诊断→计划提交后继续 ASK_QUESTION，
 *    仍走问诊链路（角色回复存在、不误解锁 COMMUNICATION、stage 不切 communication）；
 * 6. 错误分类：非 200 响应按错误码计数输出。
 * 仅使用既有账号，不新建账号；只操作本人会话；不输出任何患者/回复内容。
 * 运行：pnpm exec tsx scripts/verify-role-model-acceptance.ts
 */
export {};
import { readFileSync } from 'node:fs';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const baseUrl = `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('仅允许本地 dev server 地址');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

const DEMO_FILE = process.env.ACCEPT_ROLE_CRED_FILE ?? '/workspace/.demo-secrets/demo-student-credentials.txt';

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

interface AuthTokens { access_token: string }
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
  let body: ApiEnvelope<T> | null = null;
  try { body = (await resp.json()) as ApiEnvelope<T>; } catch { body = null; }
  return { status: resp.status, body: body ?? { ok: false } };
}

let pass = 0; let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}

interface TurnMessage { actor: string; content: string }
interface TurnSession { id: string; stage: string; plan?: unknown; unlockedEvidence: string[] }

/** 问哪答哪问题域：问题 + 相关域关键词（回复含任一即命中；关键词为公共口语词，不外显病例细节） */
const QUESTION_ROUNDS: Array<{ question: string; domainKeywords: string[] }> = [
  { question: '宝宝是什么时候开始不舒服的？', domainKeywords: ['前天', '昨天', '两天', '天前', '开始', '晚上'] },
  { question: '孩子体温最高烧到多少度？', domainKeywords: ['39', '度', '热', '烧'] },
  { question: '咳嗽是干咳还是有痰？晚上咳得厉害吗？', domainKeywords: ['咳', '痰', '干', '晚', '夜'] },
  { question: '之前在家给孩子用过什么药？效果怎么样？', domainKeywords: ['药', '热', '烧', '用'] },
];

/** 患儿（3岁2个月）语言违规术语：明确医学术语（公共术语，非病例数据） */
const CHILD_JARGON = ['血氧饱和度', '诊断', '抗生素', '阵发性', '支气管', '啰音', '毛细支气管', '抗感染', '炎症指标', '血常规'];
/** 讲课/建议口吻标记（角色不得替医生总结、给诊断或操作建议） */
const LECTURE_MARKERS = ['治疗方案', '诊断为', '请及时就医', '护理要点', '需要抗感染', '用药建议', '建议住院', '鉴别诊断'];

async function main(): Promise<void> {
  const student = await login(loadCredentials(DEMO_FILE));
  console.log(`目标服务: ${baseUrl}`);

  // 1. 创建 guided 会话（演示病例，角色 LLM 链路）
  const created = await api<TurnSession>('/api/sessions', { method: 'POST', token: student.access_token, body: JSON.stringify({ mode: 'guided' }) });
  const sessionId = created.body?.data?.id;
  check('演示学生创建 guided 会话', created.status === 201 && Boolean(sessionId), `status=${created.status}`);
  if (!sessionId) throw new Error('无法创建会话，中止');

  const errorCounts = new Map<string, number>();
  const recordError = (status: number, code?: string) => {
    const key = `${status}:${code ?? 'NO_BODY'}`;
    errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
  };

  // 2. 连续多轮问诊（内容仅内部判定，不输出）
  const askEventIds: string[] = [];
  const childReplies: string[] = [];
  const allRoleReplies: string[] = [];
  const domainHits: boolean[] = [];
  const singleFlowRounds: boolean[] = [];
  let echoViolations = 0;
  let jargonViolations = 0;
  let lectureViolations = 0;

  for (let i = 0; i < QUESTION_ROUNDS.length; i += 1) {
    const round = QUESTION_ROUNDS[i];
    const clientEventId = `verify-role-model-${i}-${Date.now()}`;
    askEventIds.push(clientEventId);
    const turn = await api<{ newMessages: TurnMessage[]; session: TurnSession }>('/api/agent/turn', {
      method: 'POST', token: student.access_token,
      body: JSON.stringify({ sessionId, clientEventId, event: { type: 'ASK_QUESTION', data: { text: round.question } } }),
    });
    if (turn.status !== 200) { recordError(turn.status, turn.body?.error?.code); check(`第${i + 1}轮问诊 200`, false, `status=${turn.status}`); continue; }
    const msgs = turn.body?.data?.newMessages ?? [];
    const roleMsgs = msgs.filter((m) => m.actor === 'child' || m.actor === 'parent');
    check(`第${i + 1}轮问诊 200 且角色回复非空`, turn.status === 200 && roleMsgs.length > 0, `roleMsgs=${roleMsgs.length}`);
    // 单聊天流：本轮全部消息（student/child/parent/system）经同一 newMessages 数组（单一会话流）返回
    singleFlowRounds.push(roleMsgs.length > 0 && msgs.every((m) => ['child', 'parent', 'system', 'student'].includes(m.actor)));
    const joined = roleMsgs.map((m) => m.content).join(' ');
    allRoleReplies.push(joined);
    const childReply = roleMsgs.find((m) => m.actor === 'child')?.content ?? '';
    if (childReply) childReplies.push(childReply);
    // 问哪答哪：回复含本问题域关键词
    domainHits.push(round.domainKeywords.some((kw) => joined.includes(kw)));
    // 不复述问题：逐字复读判定
    if (joined.includes(round.question.slice(0, 6)) && joined.length <= round.question.length + 4) echoViolations += 1;
    // 年龄匹配：患儿回复无医学术语
    if (childReply && CHILD_JARGON.some((term) => childReply.includes(term))) jargonViolations += 1;
    // 不讲课：角色回复无建议/诊断口吻
    if (LECTURE_MARKERS.some((marker) => joined.includes(marker))) lectureViolations += 1;
  }

  // 3. 内容质量计数断言（只输出计数，不输出内容）
  check('问哪答哪：各轮回复命中问题域关键词', domainHits.length === QUESTION_ROUNDS.length && domainHits.every(Boolean), `hits=${domainHits.filter(Boolean).length}/${QUESTION_ROUNDS.length}`);
  check('不复述问题：逐字复读违规=0', echoViolations === 0, `violations=${echoViolations}`);
  check('年龄匹配：患儿回复医学术语违规=0', jargonViolations === 0, `violations=${jargonViolations}/childReplies=${childReplies.length}`);
  check('不讲课：建议/诊断口吻违规=0', lectureViolations === 0, `violations=${lectureViolations}`);
  check('单聊天流：全部轮次经同一 newMessages 数组返回', singleFlowRounds.length === QUESTION_ROUNDS.length && singleFlowRounds.every(Boolean), `rounds=${singleFlowRounds.filter(Boolean).length}/${QUESTION_ROUNDS.length}`);
  check('多轮角色回复互不重复', allRoleReplies.length > 0 && new Set(allRoleReplies).size >= Math.min(3, allRoleReplies.length), `unique=${new Set(allRoleReplies).size}/${allRoleReplies.length}`);

  // 4. 返回 history 不因 plan 误切沟通：阶段推进 → 诊断 → 计划 → 再问诊
  for (const stage of ['exam', 'tests'] as const) {
    const nav = await api('/api/agent/turn', {
      method: 'POST', token: student.access_token,
      body: JSON.stringify({ sessionId, clientEventId: `verify-role-nav-${stage}-${Date.now()}`, event: { type: 'NAVIGATE_STAGE', data: { stage } } }),
    });
    if (nav.status !== 200) recordError(nav.status, nav.body?.error?.code);
    check(`阶段推进至 ${stage}`, nav.status === 200, `status=${nav.status}`);
  }
  const decision = await api('/api/agent/turn', {
    method: 'POST', token: student.access_token,
    body: JSON.stringify({ sessionId, clientEventId: `verify-role-decision-${Date.now()}`, event: { type: 'SUBMIT_DECISION', data: { diagnosis: '急性支气管肺炎', summary: '结合问诊与表现考虑呼吸道感染。', differentials: '毛细支气管炎' } } }),
  });
  if (decision.status !== 200) recordError(decision.status, decision.body?.error?.code);
  check('提交初步诊断', decision.status === 200, `status=${decision.status}`);

  const plan = await api<{ session: TurnSession }>('/api/agent/turn', {
    method: 'POST', token: student.access_token,
    body: JSON.stringify({ sessionId, clientEventId: `verify-role-plan-${Date.now()}`, event: { type: 'SUBMIT_PLAN', data: { priority: '吸氧并监测血氧', detail: '低流量吸氧，监测血氧与呼吸。' } } }),
  });
  if (plan.status !== 200) recordError(plan.status, plan.body?.error?.code);
  check('提交处置计划', plan.status === 200 && Boolean(plan.body?.data?.session?.plan), `status=${plan.status}`);

  const postPlanAskId = `verify-role-postplan-${Date.now()}`;
  const postPlanAsk = await api<{ newMessages: TurnMessage[]; session: TurnSession }>('/api/agent/turn', {
    method: 'POST', token: student.access_token,
    body: JSON.stringify({ sessionId, clientEventId: postPlanAskId, event: { type: 'ASK_QUESTION', data: { text: '孩子精神状态怎么样？吃东西还好吗？' } } }),
  });
  if (postPlanAsk.status !== 200) recordError(postPlanAsk.status, postPlanAsk.body?.error?.code);
  const postPlanRoles = (postPlanAsk.body?.data?.newMessages ?? []).filter((m) => m.actor === 'child' || m.actor === 'parent');
  const postPlanEvidence = postPlanAsk.body?.data?.session?.unlockedEvidence ?? [];
  check('计划后继续问诊仍走问诊链路（history 不因 plan 误切沟通）', postPlanAsk.status === 200 && postPlanRoles.length > 0, `status=${postPlanAsk.status} roleMsgs=${postPlanRoles.length}`);
  check('计划后问诊不误解锁 COMMUNICATION 证据', !postPlanEvidence.includes('COMMUNICATION'), `has=${postPlanEvidence.includes('COMMUNICATION')}`);
  check('计划后问诊 stage 不切 communication', postPlanAsk.body?.data?.session?.stage !== 'communication', `stage=${postPlanAsk.body?.data?.session?.stage}`);

  // 5. agent_call_records 落库核验：问诊轮 execution 证据（model / model_fallback）
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${student.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: records, error: recordsError } = await db
    .from('agent_call_records')
    .select('client_event_id,execution,model_name,duration_ms')
    .eq('session_id', sessionId);
  if (recordsError) throw new Error(`落库查询失败: ${recordsError.message}`);
  const askRows = (records ?? []).filter((r: { client_event_id: string }) => [...askEventIds, postPlanAskId].includes(r.client_event_id));
  const execCounts = askRows.reduce<Record<string, number>>((acc, r: { execution: string }) => { acc[r.execution] = (acc[r.execution] ?? 0) + 1; return acc; }, {});
  const askTotal = askEventIds.length + 1;
  check('落库：全部问诊轮均有 agent_call_records 行', askRows.length === askTotal, `rows=${askRows.length}/${askTotal}`);
  check('落库：问诊轮 execution 无 deterministic（平台凭据漏检已修复）', (execCounts.deterministic ?? 0) === 0, `deterministic=${execCounts.deterministic ?? 0}`);
  check('落库：存在 model/model_fallback 证据', (execCounts.model ?? 0) + (execCounts.model_fallback ?? 0) > 0, JSON.stringify(execCounts));
  const dupRows = (records ?? []).length !== new Set((records ?? []).map((r: { client_event_id: string }) => r.client_event_id)).size;
  check('落库：client_event_id 无重复行', !dupRows, `rows=${(records ?? []).length}`);

  // 6. 错误分类输出（计数，不含内容）
  if (errorCounts.size > 0) console.log(`错误分类: ${JSON.stringify([...errorCounts.entries()])}`);
  console.log(`execution 计数: ${JSON.stringify(execCounts)}`);
  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
