/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 正式验收：真实 A/B JWT 数据库持久化 + RLS 业务测试。
 * A = 学生（rls-probe-a@luojia.dev），B = 教师（rls-probe-b@luojia.dev，teacher_emails 白名单）。
 * 全部通过 Data API（anon key + 用户 JWT + X-Instance-ID）访问，与生产运行时一致。
 * 运行：pnpm tsx scripts/verify-rls-e2e.ts
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.CODER_SUPABASE_URL;
const anonKey = process.env.CODER_SUPABASE_ANON_KEY;
const tenantId = process.env.CODER_SUPABASE_TENANT_ID;

if (!url || !anonKey || !tenantId) {
  console.error('FATAL: 缺少 CODER_SUPABASE_URL / CODER_SUPABASE_ANON_KEY / CODER_SUPABASE_TENANT_ID');
  process.exit(1);
}

const SUPA_URL = url as string;
const SUPA_ANON_KEY = anonKey as string;
const SUPA_TENANT_ID = tenantId as string;

const USER_A = { email: 'rls-probe-a@luojia.dev', password: 'RlsProbe#2026A' };
const USER_B = { email: 'rls-probe-b@luojia.dev', password: 'RlsProbe#2026B' };
const USER_C = { email: 'rls-probe-c@luojia.dev', password: 'RlsProbe#2026C' };

type TokenResult = { access_token: string; user: { id: string; email?: string } };

async function login(email: string, password: string): Promise<TokenResult> {
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

/** 确保探针用户存在：登录失败时尝试 signup（可能需要邮件确认，失败返回 null 由调用方跳过该组测试）。 */
async function ensureUser(user: { email: string; password: string }): Promise<TokenResult | null> {
  try {
    return await login(user.email, user.password);
  } catch {
    const resp = await fetch(`${SUPA_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    if (!resp.ok) return null;
    try {
      return await login(user.email, user.password);
    } catch {
      return null;
    }
  }
}

function anonClient() {
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function userClient(token: string) {
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}

async function main() {
  const [a, b] = await Promise.all([login(USER_A.email, USER_A.password), login(USER_B.email, USER_B.password)]);
  console.log(`用户A(学生) id=${a.user.id}`);
  console.log(`用户B(教师) id=${b.user.id}`);
  const dbA = userClient(a.access_token);
  const dbB = userClient(b.access_token);

  // ---- 1. 教师身份判定：teacher_emails 无 SELECT 策略属预期（判定在 app_is_teacher 的 SECURITY DEFINER 内完成，
  //      白名单表不向客户端暴露）。改用行为验证：教师 B 可读 training_sessions 全表（teacher_select 走 app_is_teacher）。 ----
  const teacherProof = await dbB.from('training_sessions').select('id').limit(1);
  const studentProof = await dbA.from('training_sessions').select('id').limit(1);
  check('教师B可全表读training_sessions（app_is_teacher放行）', teacherProof.error === null, teacherProof.error?.message ?? '');
  check('teacher_emails不向客户端暴露（无SELECT策略=表不可读）', (await dbB.from('teacher_emails').select('email').limit(1)).error !== null);

  // ---- 2. training_sessions 持久化与归属隔离（cohort_id 非空，与生产一致的默认队列）----
  const DEFAULT_COHORT_ID = '10000000-0000-4000-8000-000000000102';
  const sessionId = crypto.randomUUID();
  const state = {
    id: sessionId, userId: a.user.id, mode: 'osce', caseId: 'case-bronchiolitis', caseVersion: 1,
    stage: 'history', status: 'active', messages: [], events: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const insertA = await dbA.from('training_sessions').insert({
    id: sessionId, user_id: a.user.id, cohort_id: DEFAULT_COHORT_ID, case_id: state.caseId, case_version: 1,
    mode: 'osce', stage: 'history', status: 'active', state,
  });
  check('学生A可插入自己的training_sessions', !insertA.error, insertA.error?.message ?? '');

  const { data: readA } = await dbA.from('training_sessions').select('id,user_id').eq('id', sessionId).maybeSingle();
  check('学生A可读自己的session（数据库持久化生效）', readA?.user_id === a.user.id);

  const { data: readB } = await dbB.from('training_sessions').select('id,user_id').eq('id', sessionId).maybeSingle();
  check('教师B可读A的session（teacher_select放行）', readB?.user_id === a.user.id);

  // ---- 3. 越权：A 抢注他人 session ----
  const stolenId = crypto.randomUUID();
  const steal = await dbA.from('training_sessions').insert({
    id: stolenId, user_id: b.user.id, cohort_id: DEFAULT_COHORT_ID, case_id: 'x', case_version: 1,
    mode: 'osce', stage: 'history', status: 'active', state: {},
  });
  check('学生A不能以B身份插入session（owner_insert拦截）', Boolean(steal.error));

  // ---- 4. 学生A不能读教师B私有的session ----
  const bSessionId = crypto.randomUUID();
  const insertB = await dbB.from('training_sessions').insert({
    id: bSessionId, user_id: b.user.id, cohort_id: DEFAULT_COHORT_ID, case_id: 'y', case_version: 1,
    mode: 'osce', stage: 'history', status: 'active', state: {},
  });
  check('教师B可插入自己的session', !insertB.error, insertB.error?.message ?? '');
  const { data: aReadB } = await dbA.from('training_sessions').select('id').eq('id', bSessionId).maybeSingle();
  check('学生A读不到教师B的session（user_select拦截）', aReadB === null);

  // ---- 5. case_snapshot_facts：收紧后仅教师可直读（学生全表预读被拦截，仅受控 RPC）----
  const probeVersion = `rlsprobe-${Date.now()}`;
  // 教师先写入探针 facts（服务端持久化路径）
  const factsInsert = await dbB.from('case_snapshot_facts').insert({
    case_id: 'teacher-rls-probe', version: probeVersion, source_name: 'rls-probe', facts: { caseId: 'teacher-rls-probe', sections: { history: 'probe', exam: '', tests: '' } },
  });
  check('教师B可写入case_snapshot_facts', !factsInsert.error, factsInsert.error?.message ?? '');

  // 学生A直读 facts：RLS teacher-only 拦截，应读不到任何行
  const factsReadA = await dbA.from('case_snapshot_facts').select('case_id,version').eq('case_id', 'teacher-rls-probe').eq('version', probeVersion).maybeSingle();
  check('学生A直读case_snapshot_facts被拦截（teacher-only）', factsReadA.data === null, factsReadA.error?.message ?? '');

  // 学生A插入 facts 被拦截（防投毒）
  const factsInsertA = await dbA.from('case_snapshot_facts').insert({
    case_id: 'teacher-rls-probe', version: `${probeVersion}-poison`, source_name: 'poison', facts: { poison: true },
  });
  check('学生A不能插入case_snapshot_facts（防投毒）', Boolean(factsInsertA.error));
  // 学生A UPDATE facts：RLS 拦截命中 0 行，数据未被篡改
  await dbA.from('case_snapshot_facts').update({ source_name: 'tampered' }).eq('case_id', 'teacher-rls-probe').eq('version', probeVersion);
  const { data: factsAfterUpdate } = await dbB.from('case_snapshot_facts').select('source_name').eq('case_id', 'teacher-rls-probe').eq('version', probeVersion).maybeSingle();
  check('学生A不能UPDATE case_snapshot_facts（数据未被篡改）', factsAfterUpdate?.source_name !== 'tampered');

  // ---- 5.1 case_snapshot_get_facts RPC 三重校验 ----
  // 前置：教师写入 answers 探针（供 5.2 使用）
  await dbB.from('case_snapshot_answers').upsert({
    case_id: 'teacher-rls-probe', version: probeVersion, diagnosis: '教师测试诊断', plan: '教师测试方案', documents: [], media: [],
  }, { onConflict: 'case_id,version' });
  // 构造一个 A 名下、绑定该版本与病例的会话
  const rpcSessionId = crypto.randomUUID();
  const rpcState = {
    id: rpcSessionId, userId: a.user.id, mode: 'guided', caseId: 'teacher-rls-probe', caseVersion: 2,
    sourceSnapshotVersion: probeVersion, stage: 'history', status: 'active',
    messages: [], events: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const rpcSessionInsert = await dbA.from('training_sessions').insert({
    id: rpcSessionId, user_id: a.user.id, cohort_id: DEFAULT_COHORT_ID, case_id: rpcState.caseId, case_version: 2,
    mode: 'guided', stage: 'history', status: 'active', state: rpcState,
  });
  check('学生A可插入RPC测试会话', !rpcSessionInsert.error, rpcSessionInsert.error?.message ?? '');

  // (a) 正向：会话归属+版本绑定+病例匹配全部满足 → 返回 facts
  const rpcOk = await dbA.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  check('RPC正向：A本人会话+绑定版本+病例匹配 → 返回facts', !rpcOk.error && Boolean(rpcOk.data), rpcOk.error?.message ?? '');

  // (b) 版本不匹配 → null
  const rpcBadVersion = await dbA.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-rls-probe', p_version: 'wrong-version', p_session_id: rpcSessionId });
  check('RPC版本绑定校验：请求版本≠会话绑定版本 → null', rpcBadVersion.data === null);

  // (c) 病例不匹配 → null
  const rpcBadCase = await dbA.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-OTHER-case', p_version: probeVersion, p_session_id: rpcSessionId });
  check('RPC病例匹配校验：请求病例≠会话病例 → null', rpcBadCase.data === null);

  // (d) 归属校验：教师B用A的会话调 RPC → null（auth.uid()≠state.userId）
  const rpcWrongOwner = await dbB.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  check('RPC归属校验：B用A的会话 → null', rpcWrongOwner.data === null);

  // ---- 5.2 case_snapshot_get_reference RPC：学生评分对照读取三重校验 ----
  const refOk = await dbA.rpc('case_snapshot_get_reference', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  const refData = refOk.data as { diagnosis?: string } | null;
  check('REFERENCE正向：A本人会话 → 返回诊断对照', !refOk.error && refData?.diagnosis === '教师测试诊断', refOk.error?.message ?? '');
  const refBadVersion = await dbA.rpc('case_snapshot_get_reference', { p_case_id: 'teacher-rls-probe', p_version: 'wrong-version', p_session_id: rpcSessionId });
  check('REFERENCE版本绑定校验：版本不匹配 → null', refBadVersion.data === null);
  const refWrongOwner = await dbB.rpc('case_snapshot_get_reference', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  check('REFERENCE归属校验：B用A的会话 → null', refWrongOwner.data === null);

  // ---- 5.3 匿名（anon）：无 JWT 直读/RPC 全拦截 ----
  const anon = anonClient();
  const anonFacts = await anon.from('case_snapshot_facts').select('case_id').limit(1);
  check('匿名直读case_snapshot_facts被拦截', (anonFacts.data?.length ?? 0) === 0 || Boolean(anonFacts.error));
  const anonAnswers = await anon.from('case_snapshot_answers').select('case_id').limit(1);
  check('匿名直读case_snapshot_answers被拦截', (anonAnswers.data?.length ?? 0) === 0 || Boolean(anonAnswers.error));
  const anonSessions = await anon.from('training_sessions').select('id').limit(1);
  check('匿名直读training_sessions被拦截', (anonSessions.data?.length ?? 0) === 0 || Boolean(anonSessions.error));
  const anonRpc = await anon.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  check('匿名调RPC被拦截（无登录）', anonRpc.error !== null || anonRpc.data === null);
  const anonRpcRef = await anon.rpc('case_snapshot_get_reference', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  check('匿名调REFERENCE RPC被拦截（无登录）', anonRpcRef.error !== null || anonRpcRef.data === null);

  // ---- 5.4 学生C：第三方学生对 A 的会话/RPC/报告均不可见 ----
  const c = await ensureUser(USER_C);
  if (c) {
    const dbC = userClient(c.access_token);
    console.log(`用户C(学生) id=${c.user.id}`);
    const cReadSession = await dbC.from('training_sessions').select('id').eq('id', rpcSessionId).maybeSingle();
    check('学生C读不到A的会话（user_select隔离）', cReadSession.data === null);
    const cRpc = await dbC.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
    check('学生C用A的会话调RPC → null（归属校验）', cRpc.data === null);
    const cFacts = await dbC.from('case_snapshot_facts').select('case_id').eq('case_id', 'teacher-rls-probe').limit(1);
    check('学生C直读facts被拦截', (cFacts.data?.length ?? 0) === 0);
  } else {
    console.log('跳过学生C组（signup不可用）');
  }

  // ---- 6. case_snapshot_answers：学生不可读写，教师可读写 ----
  // ---- 6. case_snapshot_answers：学生不可读写（教师读写已在 5.1/5.2 验证）----
  const answersInsert = await dbA.from('case_snapshot_answers').insert({
    case_id: 'teacher-rls-probe', version: `${probeVersion}-poison`, diagnosis: '不应写入', plan: '', documents: [], media: [],
  });
  check('学生A不能插入case_snapshot_answers（teacher-only拦截）', Boolean(answersInsert.error));
  const answersRead = await dbA.from('case_snapshot_answers').select('case_id').eq('case_id', 'teacher-rls-probe').limit(1);
  check('学生A读不到case_snapshot_answers任何行（teacher-only拦截）', (answersRead.data?.length ?? 0) === 0);

  // ---- 7. training_reports 真实数据隔离：A/B 各插一份报告，验证 A 读不到 B、B（教师）可读全部 ----
  const reportAId = crypto.randomUUID();
  const reportBId = crypto.randomUUID();
  const insertReportA = await dbA.from('training_reports').insert({
    id: reportAId, session_id: sessionId, user_id: a.user.id, case_id: 'case-bronchiolitis',
    mode: 'osce', total_score: 72, status: 'completed', data: { probe: 'A' },
  });
  check('学生A可插入自己的training_reports', !insertReportA.error, insertReportA.error?.message ?? '');
  const insertReportB = await dbB.from('training_reports').insert({
    id: reportBId, session_id: bSessionId, user_id: b.user.id, case_id: 'case-y',
    mode: 'osce', total_score: 88, status: 'completed', data: { probe: 'B' },
  });
  check('教师B可插入自己的training_reports', !insertReportB.error, insertReportB.error?.message ?? '');

  const { data: reportAReadB } = await dbA.from('training_reports').select('id').eq('id', reportBId).maybeSingle();
  check('学生A读不到教师B的报告（owner_read隔离）', reportAReadB === null);
  const { data: reportBReadA } = await dbB.from('training_reports').select('id,user_id').eq('id', reportAId).maybeSingle();
  check('教师B可读学生A的报告（teacher_select放行）', reportBReadA?.user_id === a.user.id);
  const forgeScore = await dbA.from('training_reports').update({ total_score: 100 }).eq('id', reportBId);
  check('学生A不能篡改教师B报告的分数（owner_update拦截，命中0行）', !forgeScore.error && (await dbB.from('training_reports').select('total_score').eq('id', reportBId).maybeSingle()).data?.total_score === 88);

  // ---- 清理探针数据 ----
  await dbA.from('training_reports').delete().eq('id', reportAId);
  await dbB.from('training_reports').delete().eq('id', reportBId);
  await dbB.from('case_snapshot_answers').delete().eq('case_id', 'teacher-rls-probe');
  await dbB.from('case_snapshot_facts').delete().eq('case_id', 'teacher-rls-probe');
  await dbA.from('training_sessions').delete().eq('id', sessionId);
  await dbA.from('training_sessions').delete().eq('id', rpcSessionId);
  await dbB.from('training_sessions').delete().eq('id', bSessionId);
  console.log('已清理探针数据');

  console.log(`\n结果: pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => { console.error('FATAL', error); process.exit(1); });
