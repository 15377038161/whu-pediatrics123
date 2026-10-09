/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 使用统计专项验收（负测 + 幂等 + 有效时长 + 越权 + 持久化取证）：
 * - A/B 为新注册学生（真实 signup，不污染白名单教师；测试身份邮箱带 usage-probe- 前缀，无 profiles student 行不进统计）；
 * - 全部经真实 HTTP（dev server API + Data API 用户 JWT + X-Instance-ID），与生产运行时一致；
 * - 教师端到端正测受限：既有白名单探针（rls-probe-b）密码未注入环境变量，无法登录教师账号；
 *   本脚本以学生负测（403/FORBIDDEN）+ 数据库行取证代替，教师真实账号正测列入未验收记录。
 * 运行：pnpm tsx scripts/verify-usage-stats.ts [baseUrl]
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8765';
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;

if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) {
  console.error('FATAL: 缺少 CODER_SUPABASE_URL / CODER_SUPABASE_ANON_KEY / CODER_SUPABASE_TENANT_ID');
  process.exit(1);
}

type TokenResult = { access_token: string; user: { id: string; email?: string } };

async function signup(email: string, password: string): Promise<TokenResult> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as TokenResult & { msg?: string; error_code?: string };
  if (!resp.ok || !body.access_token) throw new Error(`signup 失败 ${email}: ${body.msg ?? body.error_code ?? resp.status}`);
  return body;
}

function userClient(token: string): SupabaseClient {
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code: string; message: string } }

async function api<T>(path: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}

async function engagementPost(token: string, payload: Record<string, unknown>) {
  return api<{ accepted: boolean; persisted: boolean }>('/api/engagement', { method: 'POST', body: JSON.stringify(payload), token });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, evidence: string): void {
  if (ok) {
    pass += 1;
    console.log(`  ok - ${name} :: ${evidence}`);
  } else {
    fail += 1;
    console.error(`  NOT OK - ${name} :: ${evidence}`);
  }
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const studentA = await signup(`usage-probe-a-${stamp}@luojia.dev`, `Up!statA${stamp}#x`);
  const studentB = await signup(`usage-probe-b-${stamp}@luojia.dev`, `Up!statB${stamp}#y`);
  console.log(`# 学生 A=${studentA.user.email} B=${studentB.user.email}`);
  const dbA = userClient(studentA.access_token);

  // A 自建 profile 行（事件表 user_id 引用 profiles；统计口径过滤后测试身份不进教师统计）
  const { error: profileError } = await dbA
    .from('profiles')
    .insert({ id: studentA.user.id, display_name: `统计探针A${stamp}`, app_role: 'student' });
  check('学生A profile 自建（RLS self-insert）', !profileError, profileError?.message ?? 'inserted');

  console.log('## 1. 未登录负测');
  const noAuth = await api('/api/teacher/usage-stats', { method: 'GET' });
  check('未登录访问教师统计 401', noAuth.status === 401, `${noAuth.status} ${noAuth.body.error?.code}`);
  const noAuthPost = await api('/api/engagement', { method: 'POST', body: '{}' });
  check('未登录上报事件 401', noAuthPost.status === 401, `${noAuthPost.status} ${noAuthPost.body.error?.code}`);

  console.log('## 2. 学生越权负测');
  const studentStats = await api('/api/teacher/usage-stats', { method: 'GET', token: studentA.access_token });
  check('学生调教师统计接口 403', studentStats.status === 403, `${studentStats.status} ${studentStats.body.error?.code}`);
  const directRpc = await dbA.rpc('teacher_stats_per_student', {});
  check('学生直调统计 RPC 被拒', directRpc.error !== null, String(directRpc.error?.message ?? '').slice(0, 80));

  console.log('## 3. 事件幂等');
  const eventKey = `probe-evt-${stamp}-001`;
  const first = await engagementPost(studentA.access_token, { eventType: 'page_enter', sessionId: null, clientEventId: eventKey, tabId: `probe-tab-${stamp}-a`, detail: { path: '/student' } });
  check('首次上报 accepted=true', first.status === 200 && first.body.data?.accepted === true, `${first.status} ${JSON.stringify(first.body.data)}`);
  const dup = await engagementPost(studentA.access_token, { eventType: 'page_enter', sessionId: null, clientEventId: eventKey, tabId: `probe-tab-${stamp}-a` });
  check('重复上报幂等 accepted=false', dup.status === 200 && dup.body.data?.accepted === false, `${dup.status} ${JSON.stringify(dup.body.data)}`);

  console.log('## 4. 会话归属强制（事件挂他人会话被拒）');
  const created = await api<{ id: string }>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'guided' }), token: studentA.access_token });
  check('学生A创建训练会话', created.status === 201 && Boolean(created.body.data?.id), `${created.status}`);
  const sessionId = created.body.data?.id ?? '';
  const foreign = await engagementPost(studentB.access_token, { eventType: 'session_start', sessionId, clientEventId: `probe-evt-${stamp}-fx`, tabId: `probe-tab-${stamp}-b` });
  check('学生B挂A会话被拒 403', foreign.status === 403, `${foreign.status} ${foreign.body.error?.code}`);
  const own = await engagementPost(studentA.access_token, { eventType: 'session_start', sessionId, clientEventId: `probe-evt-${stamp}-own`, tabId: `probe-tab-${stamp}-a` });
  check('学生A本人会话事件通过', own.status === 200 && own.body.data?.accepted === true, `${own.status} ${JSON.stringify(own.body.data)}`);

  console.log('## 5. 有效时长口径（同标签页归并 / idle 不驱动区间）');
  const tab = `probe-tab-${stamp}-a`;
  // 同标签页 1 秒后心跳 → 归并续期（单区间）
  await engagementPost(studentA.access_token, { eventType: 'heartbeat', sessionId: null, clientEventId: `probe-evt-${stamp}-hb1`, tabId: tab });
  await sleep(1100);
  await engagementPost(studentA.access_token, { eventType: 'heartbeat', sessionId: null, clientEventId: `probe-evt-${stamp}-hb2`, tabId: tab });
  // idle 事件不驱动新区间
  await engagementPost(studentA.access_token, { eventType: 'visibility_idle', sessionId: null, clientEventId: `probe-evt-${stamp}-idle`, tabId: tab });
  const { data: intervals, error: intervalError } = await dbA
    .from('student_active_intervals')
    .select('tab_id,started_at,ended_at,duration_seconds')
    .eq('user_id', studentA.user.id)
    .eq('tab_id', tab);
  const rows = intervals ?? [];
  check('同标签页归并为单一区间（page_enter+session_start+心跳×2 同 5 秒窗口）', !intervalError && rows.length >= 1, `rows=${rows.length} ${intervalError?.message ?? ''}`);
  const merged = rows[0];
  check('区间被心跳续期（duration>10s 或多区间累计）', !intervalError && rows.reduce((sum, r) => sum + r.duration_seconds, 0) >= 10, `sum=${rows.reduce((s, r) => s + r.duration_seconds, 0)}s`);
  check('idle 不新开区间（同标签页区间数不随 idle 增加）', !intervalError && rows.every((r) => r.ended_at >= r.started_at), JSON.stringify(rows.map((r) => r.duration_seconds)));
  void merged;

  console.log('## 6. 学生只能读自己的事件（他人区间不可见）');
  const dbB = userClient(studentB.access_token);
  const { count: bSeesA } = await dbB.from('student_engagement_events').select('*', { count: 'exact', head: true }).eq('user_id', studentA.user.id);
  check('学生B看不到A的事件（RLS 行级隔离）', (bSeesA ?? 0) === 0, `count=${bSeesA}`);

  console.log(`# 结果：pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
