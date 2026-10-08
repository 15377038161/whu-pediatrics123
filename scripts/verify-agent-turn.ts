/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * agent_call_records 唯一约束修复后的 AI 对话链路验收（真实学生身份 + 完整 HTTP 栈）：
 * 1. 真实学生/教师凭据登录拿 JWT，走 platform-session 路由换 httpOnly cookie；
 * 2. 学生建会话（guided 模式）→ 连续两轮 ASK_QUESTION（AI 应答链路真实执行）；
 * 3. 幂等：同一 clientEventId 重复提交 → 返回 200（upsert 命中唯一约束，不再 409/500）；
 * 4. 隔离：学生B对学生A会话发起 turn → 403（会话归属校验）；
 * 5. 数据核验：教师侧 Data API 查 agent_call_records，确认两行独立记录（session_id, client_event_id 唯一）。
 * 运行：pnpm tsx scripts/verify-agent-turn.ts
 */
export {};

const BASE = process.env.AGENT_TURN_BASE_URL || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5173}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;

const STUDENT_A = { email: 'rls-probe-a@luojia.dev', password: 'RlsProbe#2026A' };
const STUDENT_B = { email: 'rls-probe-b@luojia.dev', password: 'RlsProbe#2026B' };

if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) {
  console.error('FATAL: 缺少 CODER_SUPABASE_* 环境变量');
  process.exit(1);
}

interface TokenResult { access_token: string; refresh_token: string; user: { id: string; email?: string } }

async function login({ email, password }: { email: string; password: string }): Promise<TokenResult> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as TokenResult & { error_code?: string; msg?: string };
  if (!resp.ok || !body.access_token) {
    throw new Error(`登录失败 ${email}: ${body.error_code ?? body.msg ?? resp.status}`);
  }
  return body;
}

/** 走应用 platform-session 路由换 httpOnly cookie（与浏览器 OAuth 落地同链路）。 */
async function establishSession(token: TokenResult): Promise<string> {
  const resp = await fetch(`${BASE}/api/auth/callback/platform-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: token.access_token, refresh_token: token.refresh_token }),
  });
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  const authCookie = setCookies.find((c) => c.startsWith('luojia-peds-auth='));
  if (!resp.ok || !authCookie) {
    throw new Error(`platform-session 落地失败 status=${resp.status} cookies=${setCookies.length}`);
  }
  return authCookie.split(';')[0];
}

async function api(path: string, cookie: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Cookie: cookie, 'Content-Type': 'application/json' },
  });
  let body: any = null;
  try { body = await resp.json(); } catch { /* 非 JSON */ }
  return { status: resp.status, body };
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}

async function main(): Promise<void> {
  console.log(`目标服务: ${BASE}`);
  const studentA = await login(STUDENT_A);
  const studentB = await login(STUDENT_B);
  const cookieA = await establishSession(studentA);
  const cookieB = await establishSession(studentB);
  console.log(`学生A ${studentA.user.email} id=${studentA.user.id}`);
  console.log(`学生B ${studentB.user.email} id=${studentB.user.id}`);

  // 1. 学生A建会话（guided）
  const created = await api('/api/sessions', cookieA, {
    method: 'POST',
    body: JSON.stringify({ mode: 'guided' }),
  });
  const session = created.body?.data ?? {};
  const sessionId = session.id as string | undefined;
  check('学生A创建 guided 会话', created.status === 201 && Boolean(sessionId), `status=${created.status}`);

  if (!sessionId) {
    console.error('FATAL: 无法创建会话，中止验证');
    process.exit(1);
  }

  // 2. 连续两轮问诊（真实 AI 应答链路，验证唯一约束修复后不再 409/500）
  const eventId1 = `verify-agent-turn-1-${Date.now()}`;
  const eventId2 = `verify-agent-turn-2-${Date.now()}`;
  const turn1 = await api('/api/agent/turn', cookieA, {
    method: 'POST',
    body: JSON.stringify({ sessionId, clientEventId: eventId1, event: { type: 'ASK_QUESTION', data: { text: '宝宝最近吃东西怎么样？' } } }),
  });
  check('第一轮问诊 AI 应答成功（不再因唯一约束 409/500）', turn1.status === 200, `status=${turn1.status}`);

  const turn2 = await api('/api/agent/turn', cookieA, {
    method: 'POST',
    body: JSON.stringify({ sessionId, clientEventId: eventId2, event: { type: 'ASK_QUESTION', data: { text: '有没有发烧的情况？' } } }),
  });
  check('第二轮问诊 AI 应答成功（连续多轮正常）', turn2.status === 200, `status=${turn2.status}`);

  // 3. 幂等：同一 clientEventId 重复提交
  const turn1Retry = await api('/api/agent/turn', cookieA, {
    method: 'POST',
    body: JSON.stringify({ sessionId, clientEventId: eventId1, event: { type: 'ASK_QUESTION', data: { text: '重复提交（幂等测试）' } } }),
  });
  check('幂等：同 clientEventId 重复提交返回 200', turn1Retry.status === 200, `status=${turn1Retry.status}`);

  // 4. 隔离：学生B对学生A会话发起 turn → 403
  const turnB = await api('/api/agent/turn', cookieB, {
    method: 'POST',
    body: JSON.stringify({ sessionId, clientEventId: `verify-agent-cross-${Date.now()}`, event: { type: 'ASK_QUESTION', data: { text: '别人的会话' } } }),
  });
  check('隔离：学生B对学生A会话发起 turn 被拒（403/404）', turnB.status === 403 || turnB.status === 404, `status=${turnB.status}`);

  // 5. 未登录调用 → 401
  const turnAnon = await api('/api/agent/turn', 'luojia-peds-auth=invalid', {
    method: 'POST',
    body: JSON.stringify({ sessionId, clientEventId: `verify-agent-anon-${Date.now()}`, event: { type: 'ASK_QUESTION', data: { text: '未登录' } } }),
  });
  check('未登录调用 /api/agent/turn 被拒（401）', turnAnon.status === 401, `status=${turnAnon.status}`);

  // 6. 数据核验：教师侧 Data API 查 agent_call_records 记录数与唯一性
  // 学生B（rls-probe-b）在此探针体系中兼任教师（verify-rls-e2e 同款设定）
  // 通过 Data API 以学生A的JWT查询本人会话的调用记录
  const { createClient } = await import('@supabase/supabase-js');
  const dbA = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${studentA.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: records, error: recordsError } = await dbA
    .from('agent_call_records')
    .select('client_event_id, execution, duration_ms')
    .eq('session_id', sessionId);
  const recordIds = (records ?? []).map((r: any) => r.client_event_id);
  check('agent_call_records 落库两行独立记录（唯一约束生效）',
    !recordsError && recordIds.length === 2 && recordIds.includes(eventId1) && recordIds.includes(eventId2),
    recordsError ? recordsError.message : `rows=${recordIds.length}`);

  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
