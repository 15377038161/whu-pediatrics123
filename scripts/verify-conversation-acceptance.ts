/* 真实验收B（多轮问诊 + 单聊天框语义推导 + 角色语言链路）：
 * 1. 既有账号（演示学生 + 已弃用探针账号）真实登录拿 JWT，走 Bearer 直连本地 dev server；
 * 2. 演示病例 guided 会话 → 连续多轮 ASK_QUESTION（renderRoleReply 真实 LLM 链路）：
 *    断言 200、角色（患儿/家长）回复非空、多轮回复互不重复、不逐字复读问题；
 * 3. 幂等：同 clientEventId 重复提交 → 200；
 * 4. 隔离：账号B对账号A会话发起 turn → 403/404；无效凭据 → 401；
 * 5. 单聊天框语义推导真实链路：SUBMIT_DECISION → SUBMIT_PLAN 后（session.plan 存在），
 *    同输入文本改走 SEND_COMMUNICATION → 200 且解锁 COMMUNICATION 证据（与前端 isCommunication 推导一致）；
 * 6. agent_call_records 落库核验：每个 clientEventId 恰一行（幂等不增行）。
 * 仅使用既有账号，不新建账号；只操作本人会话。
 * 运行：pnpm tsx scripts/verify-conversation-acceptance.ts
 */
export {};
import { readFileSync } from 'node:fs';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const baseUrl = `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('仅允许本地 dev server 地址');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

const DEMO_FILE = process.env.ACCEPT_B_CRED_FILE ?? '/workspace/.demo-secrets/demo-student-credentials.txt';
const PROBE_FILE = process.env.ACCEPT_B_ATTACKER_FILE ?? '/workspace/.demo-secrets/probe-account-credentials-deprecated.txt';

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

const QUESTIONS = [
  '宝宝最近吃东西怎么样？',
  '有没有发烧的情况？烧到多少度？',
  '孩子呼吸怎么样？有没有咳嗽或者喘？',
  '以前有没有住过院、对什么过敏吗？',
];

async function main(): Promise<void> {
  const studentA = await login(loadCredentials(DEMO_FILE));
  const studentB = await login(loadCredentials(PROBE_FILE));
  console.log(`目标服务: ${baseUrl}`);

  // 1. 创建 guided 会话（演示病例，走角色 LLM 链路）
  const created = await api<TurnSession>('/api/sessions', { method: 'POST', token: studentA.access_token, body: JSON.stringify({ mode: 'guided' }) });
  const sessionId = created.body?.data?.id;
  check('学生A创建 guided 会话', created.status === 201 && Boolean(sessionId), `status=${created.status}`);
  if (!sessionId) throw new Error('无法创建会话，中止');

  // 2. 连续多轮问诊：真实 LLM 角色应答
  const roleReplies: TurnMessage[] = [];
  const eventIds: string[] = [];
  for (let i = 0; i < QUESTIONS.length; i += 1) {
    const clientEventId = `verify-conv-b-${i}-${Date.now()}`;
    eventIds.push(clientEventId);
    const turn = await api<{ newMessages: TurnMessage[]; session: TurnSession }>('/api/agent/turn', {
      method: 'POST', token: studentA.access_token,
      body: JSON.stringify({ sessionId, clientEventId, event: { type: 'ASK_QUESTION', data: { text: QUESTIONS[i] } } }),
    });
    const msgs = turn.body?.data?.newMessages ?? [];
    const roles = msgs.filter((m) => m.actor === 'child' || m.actor === 'parent');
    const first = roles[0];
    check(`第${i + 1}轮问诊 AI 应答成功且角色回复非空`, turn.status === 200 && Boolean(first?.content), `status=${turn.status} roles=${roles.length}`);
    if (first) roleReplies.push(first);
    if (turn.status !== 200) console.log(`  轮次错误详情: ${JSON.stringify(turn.body?.error ?? {}).slice(0, 200)}`);
  }

  // 3. 角色语言自然化断言：多轮回复互不重复、不逐字复读问题、长度在口语范围
  const contents = roleReplies.map((m) => m.content);
  check('多轮角色回复互不重复（≥3 轮两两不同）', new Set(contents).size >= Math.min(3, contents.length), `unique=${new Set(contents).size}/${contents.length}`);
  const echoed = contents.some((c, idx) => c.includes(QUESTIONS[idx].slice(0, 6)) && c.length <= QUESTIONS[idx].length + 4);
  check('角色回复不逐字复读问题', !echoed);
  const tooLong = contents.filter((c) => c.length > 400).length;
  check('角色回复保持口语长度（≤400字）', contents.length > 0 && tooLong === 0, `maxLen=${Math.max(0, ...contents.map((c) => c.length))}`);
  console.log('  样例回复:', contents.slice(0, 2).map((c) => `"${c.slice(0, 50)}"`).join(' / '));

  // 4. 幂等：同 clientEventId 重复提交 → 200
  const retry = await api('/api/agent/turn', {
    method: 'POST', token: studentA.access_token,
    body: JSON.stringify({ sessionId, clientEventId: eventIds[0], event: { type: 'ASK_QUESTION', data: { text: '重复提交幂等测试' } } }),
  });
  check('幂等：同 clientEventId 重复提交返回 200', retry.status === 200, `status=${retry.status}`);

  // 5. 隔离：账号B对A会话发起 turn → 403/404
  const cross = await api('/api/agent/turn', {
    method: 'POST', token: studentB.access_token,
    body: JSON.stringify({ sessionId, clientEventId: `verify-conv-b-cross-${Date.now()}`, event: { type: 'ASK_QUESTION', data: { text: '别人的会话' } } }),
  });
  check('隔离：账号B对A会话发起 turn 被拒（403/404）', cross.status === 403 || cross.status === 404, `status=${cross.status}`);

  // 6. 未登录 → 401
  const anon = await api('/api/agent/turn', {
    method: 'POST', token: 'invalid-token',
    body: JSON.stringify({ sessionId, clientEventId: `verify-conv-b-anon-${Date.now()}`, event: { type: 'ASK_QUESTION', data: { text: '未登录' } } }),
  });
  check('未登录调用 /api/agent/turn 被拒（401）', anon.status === 401, `status=${anon.status}`);

  // 7a. 防跳级守卫正向验证：从问诊阶段直接提交诊断 → 409（DB 触发器 SESSION_STAGE_SKIP_FORBIDDEN）
  const skipId = `verify-conv-b-skip-${Date.now()}`;
  const skip = await api('/api/agent/turn', {
    method: 'POST', token: studentA.access_token,
    body: JSON.stringify({ sessionId, clientEventId: skipId, event: { type: 'SUBMIT_DECISION', data: { diagnosis: '急性支气管肺炎', summary: '跳级提交应当被防跳级守卫拒绝的测试内容。', differentials: '无' } } }),
  });
  check('防跳级：问诊阶段直发诊断被拒（409）', skip.status === 409, `status=${skip.status}`);

  // 7b. 单聊天框语义推导真实链路：按合法阶段推进（exam → tests），决策→计划后输入语义切换为 SEND_COMMUNICATION
  for (const stage of ['exam', 'tests'] as const) {
    const navId = `verify-conv-b-nav-${stage}-${Date.now()}`;
    const nav = await api('/api/agent/turn', {
      method: 'POST', token: studentA.access_token,
      body: JSON.stringify({ sessionId, clientEventId: navId, event: { type: 'NAVIGATE_STAGE', data: { stage } } }),
    });
    check(`阶段推进至 ${stage}（NAVIGATE_STAGE）成功`, nav.status === 200, `status=${nav.status}`);
  }

  const decisionId = `verify-conv-b-decision-${Date.now()}`;
  const decision = await api('/api/agent/turn', {
    method: 'POST', token: studentA.access_token,
    body: JSON.stringify({ sessionId, clientEventId: decisionId, event: { type: 'SUBMIT_DECISION', data: { diagnosis: '急性支气管肺炎', summary: '患儿咳嗽伴发热，呼吸增快，结合问诊与查体考虑急性支气管肺炎。', differentials: '毛细支气管炎、支气管异物' } } }),
  });
  check('提交初步诊断（SUBMIT_DECISION）成功', decision.status === 200, `status=${decision.status}`);

  const planId = `verify-conv-b-plan-${Date.now()}`;
  const plan = await api<{ session: TurnSession }>('/api/agent/turn', {
    method: 'POST', token: studentA.access_token,
    body: JSON.stringify({ sessionId, clientEventId: planId, event: { type: 'SUBMIT_PLAN', data: { priority: '吸氧并监测血氧', detail: '予低流量吸氧，持续监测血氧饱和度与呼吸频率，必要时复查胸片。' } } }),
  });
  check('提交处置计划（SUBMIT_PLAN）成功', plan.status === 200, `status=${plan.status}`);
  check('计划提交后 session.plan 已存在（前端据此切换输入语义）', Boolean(plan.body?.data?.session?.plan));

  const commId = `verify-conv-b-comm-${Date.now()}`;
  const comm = await api<{ session: TurnSession }>('/api/agent/turn', {
    method: 'POST', token: studentA.access_token,
    body: JSON.stringify({ sessionId, clientEventId: commId, event: { type: 'SEND_COMMUNICATION', data: { text: '我能理解您的担心。孩子目前主要是肺部感染引起呼吸快，我们先吸氧、监测血氧，住院观察，病情变化我们会及时处理。' } } }),
  });
  const commEvidence = comm.body?.data?.session?.unlockedEvidence ?? [];
  check('计划后同输入语义切换 SEND_COMMUNICATION 成功', comm.status === 200, `status=${comm.status}`);
  check('沟通解锁 COMMUNICATION 证据', commEvidence.includes('COMMUNICATION'), `evidence=${commEvidence.length}`);

  // 8. agent_call_records 落库核验：每个 clientEventId 恰一行（幂等重试不增行）
  const { createClient } = await import('@supabase/supabase-js');
  const dbA = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${studentA.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: records, error: recordsError } = await dbA
    .from('agent_call_records')
    .select('client_event_id')
    .eq('session_id', sessionId);
  const recordIds = (records ?? []).map((r: { client_event_id: string }) => r.client_event_id);
  const expectedIds = [...eventIds, `verify-conv-b-nav-exam-`, `verify-conv-b-nav-tests-`]
    .flatMap((id) => (id.endsWith('-') ? recordIds.filter((rid) => rid.startsWith(id)) : [id]))
    .concat([decisionId, planId, commId]);
  const allRecorded = expectedIds.every((id) => recordIds.includes(id));
  const noDupRows = recordIds.length === new Set(recordIds).size;
  const expectedCount = eventIds.length + 2 + 3; // 问诊×4 + 导航×2 + 决策/计划/沟通×3（幂等与跳级拒绝不落行）
  check('agent_call_records 每轮恰一行（幂等/跳级拒绝不增行）', !recordsError && allRecorded && noDupRows && recordIds.length === expectedCount,
    recordsError ? recordsError.message : `rows=${recordIds.length} expected=${expectedCount}`);

  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
