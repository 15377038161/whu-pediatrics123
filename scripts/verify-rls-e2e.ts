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

  // (a) 正向：会话归属+版本绑定+病例匹配全部满足 → 返回 facts（history 阶段投影：仅 history section）
  const rpcOk = await dbA.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  const rpcOkSections = (rpcOk.data as { sections?: Record<string, unknown> } | null)?.sections ?? null;
  check('RPC正向：A本人会话+绑定版本+病例匹配 → 返回facts', !rpcOk.error && Boolean(rpcOk.data), rpcOk.error?.message ?? '');
  check('RPC阶段投影：history阶段剥离exam/tests（不可预读查体检查）', rpcOkSections !== null && !('exam' in rpcOkSections) && !('tests' in rpcOkSections) && rpcOkSections.history === 'probe', JSON.stringify(rpcOkSections));
  check('RPC阶段投影：diagnosis/plan 永不从 facts 返回', rpcOkSections !== null && !('diagnosis' in rpcOkSections) && !('plan' in rpcOkSections));

  // (b) 版本不匹配 → null
  const rpcBadVersion = await dbA.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-rls-probe', p_version: 'wrong-version', p_session_id: rpcSessionId });
  check('RPC版本绑定校验：请求版本≠会话绑定版本 → null', rpcBadVersion.data === null);

  // (c) 病例不匹配 → null
  const rpcBadCase = await dbA.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-OTHER-case', p_version: probeVersion, p_session_id: rpcSessionId });
  check('RPC病例匹配校验：请求病例≠会话病例 → null', rpcBadCase.data === null);

  // (d) 归属校验：教师B用A的会话调 RPC → null（受保护 user_id 列判定，非 state）
  const rpcWrongOwner = await dbB.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  check('RPC归属校验：B用A的会话 → null', rpcWrongOwner.data === null);

  // (d2) 归属伪造：A 把 state->userId 改成 B 后由 B 调用 RPC → 仍 null（归属读受保护 user_id 列）
  await dbA.from('training_sessions').update({
    state: { ...rpcState, userId: b.user.id },
  }).eq('id', rpcSessionId);
  const rpcSpoofOwner = await dbB.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  check('RPC归属防伪造：state.userId改成B后B调用仍拒绝（受保护列判定）', rpcSpoofOwner.data === null, JSON.stringify(rpcSpoofOwner.data ?? null));
  await dbA.from('training_sessions').update({ state: rpcState }).eq('id', rpcSessionId);

  // (d3) guard 触发器：绑定版本/病例不可改（防换患者/换版本串案）
  const forgeVersion = await dbA.from('training_sessions').update({
    state: { ...rpcState, sourceSnapshotVersion: 'v-forged' },
  }).eq('id', rpcSessionId);
  check('guard：学生改绑定快照版本被拒绝（SESSION_SNAPSHOT_BINDING_IMMUTABLE）', Boolean(forgeVersion.error), forgeVersion.error?.message ?? '');
  const forgeCase = await dbA.from('training_sessions').update({
    state: { ...rpcState, caseId: 'teacher-other-case' },
  }).eq('id', rpcSessionId);
  check('guard：学生改会话病例被拒绝（防串案）', Boolean(forgeCase.error), forgeCase.error?.message ?? '');

  // ---- 5.2 case_snapshot_get_reference RPC：完成态门控实测 ----
  // 训练中（active）直接调用：必须无法提前取诊断答案
  const refActive = await dbA.rpc('case_snapshot_get_reference', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  check('REFERENCE完成门控：训练中直接调RPC → null（不可提前取诊断）', refActive.data === null, JSON.stringify(refActive.data ?? null));
  // 完成会话后（合法 finish 路径）→ 返回诊断对照
  const completeRes = await dbA.from('training_sessions').update({ status: 'completed', stage: 'report' }).eq('id', rpcSessionId);
  check('学生A可完成自己的会话（合法finish路径）', !completeRes.error, completeRes.error?.message ?? '');
  const refOk = await dbA.rpc('case_snapshot_get_reference', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  const refData = refOk.data as { diagnosis?: string } | null;
  check('REFERENCE正向：完成后 → 返回诊断对照', !refOk.error && refData?.diagnosis === '教师测试诊断', refOk.error?.message ?? '');
  // 完成后事实：completed 会话全量 sections（复盘）
  const rpcCompleted = await dbA.rpc('case_snapshot_get_facts', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  const completedSections = (rpcCompleted.data as { sections?: Record<string, unknown> } | null)?.sections ?? null;
  check('facts复盘：完成后返回全量sections（history+exam+tests）', completedSections !== null && 'history' in completedSections && 'exam' in completedSections && 'tests' in completedSections, JSON.stringify(completedSections));
  const refBadVersion = await dbA.rpc('case_snapshot_get_reference', { p_case_id: 'teacher-rls-probe', p_version: 'wrong-version', p_session_id: rpcSessionId });
  check('REFERENCE版本绑定校验：版本不匹配 → null', refBadVersion.data === null);
  const refWrongOwner = await dbB.rpc('case_snapshot_get_reference', { p_case_id: 'teacher-rls-probe', p_version: probeVersion, p_session_id: rpcSessionId });
  check('REFERENCE归属校验：B用A的会话 → null', refWrongOwner.data === null);
  // 完成后不可回退（读对照代价=永久结束）
  const regression = await dbA.from('training_sessions').update({ status: 'active', stage: 'history' }).eq('id', rpcSessionId);
  check('guard：completed会话回退active被拒绝（读对照代价=永久结束）', Boolean(regression.error), regression.error?.message ?? '');

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

  // ---- 7. training_reports 防伪造：学生无直接读写策略，全走受控 RPC ----
  // 7.1 学生直插（自选分数伪造成绩）/直读全被拒
  const forgeReportId = crypto.randomUUID();
  const insertReportA = await dbA.from('training_reports').insert({
    id: forgeReportId, session_id: sessionId, user_id: a.user.id, case_id: 'case-bronchiolitis',
    mode: 'osce', total_score: 100, status: 'completed', data: { probe: 'A' },
  });
  check('学生A直插training_reports自选分数被拒绝（无INSERT策略）', Boolean(insertReportA.error), insertReportA.error?.message ?? '');
  const readReportA = await dbA.from('training_reports').select('id').eq('user_id', a.user.id).limit(5);
  check('学生A直读training_reports被拒绝（无SELECT策略，0行）', (readReportA.data?.length ?? 0) === 0 || Boolean(readReportA.error));
  if (c) {
    const insertReportC = await userClient(c.access_token).from('training_reports').insert({
      id: crypto.randomUUID(), session_id: sessionId, user_id: a.user.id, case_id: 'x',
      mode: 'osce', total_score: 100, status: 'completed', data: {},
    });
    check('学生C冒充A插报告被拒绝（无INSERT策略）', Boolean(insertReportC.error));
  }

  // 7.2 report_save_completed 门控：active 会话拒绝；completed 会话成功；重复写入拒绝（幂等）
  const savedActive = await dbA.rpc('report_save_completed', {
    p_report_id: crypto.randomUUID(), p_session_id: sessionId, p_case_id: 'case-bronchiolitis',
    p_mode: 'osce', p_total_score: 72, p_status: 'completed', p_data: { probe: 'A' },
  });
  check('report RPC：会话未完成（active）→ 拒绝写入', savedActive.data !== true, JSON.stringify(savedActive.data ?? null));
  // 用 5.2 已完成的 rpcSessionId 走合法写路径
  const reportAId = crypto.randomUUID();
  const savedCompleted = await dbA.rpc('report_save_completed', {
    p_report_id: reportAId, p_session_id: rpcSessionId, p_case_id: 'teacher-rls-probe',
    p_mode: 'guided', p_total_score: 72, p_status: 'completed', p_data: { probe: 'A', id: reportAId, totalScore: 72 },
  });
  check('report RPC：本人完成会话 → 写入成功', savedCompleted.data === true, JSON.stringify(savedCompleted.data ?? null));
  const savedDup = await dbA.rpc('report_save_completed', {
    p_report_id: crypto.randomUUID(), p_session_id: rpcSessionId, p_case_id: 'teacher-rls-probe',
    p_mode: 'guided', p_total_score: 99, p_status: 'completed', p_data: { probe: 'dup' },
  });
  check('report RPC：同会话重复写入被拒（幂等，防刷分）', savedDup.data !== true);
  // 他人的会话（B）→ 拒绝
  const savedOthers = await dbA.rpc('report_save_completed', {
    p_report_id: crypto.randomUUID(), p_session_id: bSessionId, p_case_id: 'y',
    p_mode: 'osce', p_total_score: 88, p_status: 'completed', p_data: {},
  });
  check('report RPC：A用B的会话写报告 → 拒绝（归属校验）', savedOthers.data !== true);

  // 7.3 受控读：report_get_mine / report_list_mine；教师直读放行
  const mineById = await dbA.rpc('report_get_mine', { p_report_id: reportAId });
  check('report_get_mine：A读自己的报告 → 返回数据', Boolean(mineById.data) && (mineById.data as { total_score?: number }).total_score === 72, JSON.stringify(mineById.data ?? null).slice(0, 120));
  const mineList = await dbA.rpc('report_list_mine');
  check('report_list_mine：A列表含自己的报告', Array.isArray(mineList.data) && (mineList.data as Array<{ id?: string }>).some((row) => row.id === reportAId));
  if (c) {
    const mineOthers = await userClient(c.access_token).rpc('report_get_mine', { p_report_id: reportAId });
    check('report_get_mine：C读A的报告 → null（受保护列判定）', mineOthers.data === null);
  }
  const { data: teacherRead } = await dbB.from('training_reports').select('id,user_id').eq('id', reportAId).maybeSingle();
  check('教师B可读学生A的报告（teacher_select放行）', teacherRead?.user_id === a.user.id);
  const forgeScore = await dbA.from('training_reports').update({ total_score: 100 }).eq('id', reportAId);
  check('学生A直改报告分数被拒绝（无UPDATE策略）', Boolean(forgeScore.error) || (await dbB.from('training_reports').select('total_score').eq('id', reportAId).maybeSingle()).data?.total_score === 72, forgeScore.error?.message ?? '');

  // 7.4 已知残余风险如实记录（不作安全断言）：completed 会话的学生经 Data API 直调
  //     report_save_completed 仍可传入自选分数（平台无服务端特权身份区分应用与用户调用）。
  //     见 docs/security-status.md「已知残余风险」。

  // ---- 8. 题库安全：quiz_questions 答案列不可被学生直读，取题/判分走受控 RPC ----
  // 8.1 学生/匿名直读 quiz_questions 全列拦截（answer/explanation 不暴露）
  const quizReadA = await dbA.from('quiz_questions').select('id,answer,explanation').limit(5);
  check('学生A直读quiz_questions被拦截（0行，答案列不暴露）', !quizReadA.error && (quizReadA.data?.length ?? 0) === 0, quizReadA.error?.message ?? '');
  const quizReadC = c ? (await userClient(c.access_token).from('quiz_questions').select('id').limit(5)) : null;
  if (c) check('学生C直读quiz_questions被拦截', (quizReadC?.data?.length ?? 1) === 0);
  const quizAnon = await anon.from('quiz_questions').select('id').limit(5);
  check('匿名直读quiz_questions被拦截', (quizAnon.data?.length ?? 0) === 0 || Boolean(quizAnon.error));
  // 8.2 教师全量维护：可读全列（含答案）
  const quizReadB = await dbB.from('quiz_questions').select('id,answer').limit(5);
  check('教师B可全表读quiz_questions含答案列（app_is_teacher放行）', !quizReadB.error && (quizReadB.data?.length ?? 0) > 0, quizReadB.error?.message ?? '');

  // 8.3 受控取题 RPC：投影不含 answer/explanation，且写入本人 assignments
  const fetchA = await dbA.rpc('quiz_fetch_questions', { p_count: 3 });
  const fetched = (fetchA.data ?? []) as Array<Record<string, unknown>>;
  check('RPC取题：A获得题目投影', !fetchA.error && fetched.length > 0, fetchA.error?.message ?? '');
  check('RPC取题投影不含answer/explanation', fetched.every((q) => !('answer' in q) && !('explanation' in q) && 'stem' in q && 'options' in q));
  const assignedA = await dbA.from('quiz_assignments').select('question_id').eq('user_id', a.user.id);
  check('RPC取题写入本人quiz_assignments（user_select放行）', (assignedA.data?.length ?? 0) >= fetched.length, assignedA.error?.message ?? '');
  if (c) {
    const assignedC = await userClient(c.access_token).from('quiz_assignments').select('question_id').eq('user_id', a.user.id);
    check('学生C读不到A的quiz_assignments（user_select隔离）', (assignedC.data?.length ?? 1) === 0);
  }
  // 8.4 判分 RPC：未分配题目不可作答；已分配题目作答后返回答案解析
  const notAssignedId = quizReadB.data?.find((q) => !fetched.some((f) => f.id === q.id))?.id ?? crypto.randomUUID();
  const submitUnassigned = await dbA.rpc('quiz_submit_answer', { p_question_id: notAssignedId, p_answer: 'A.试探' });
  check('判分RPC：未分配给A的题目 → NOT_ASSIGNED', !submitUnassigned.error && (submitUnassigned.data as { error?: string })?.error === 'NOT_ASSIGNED', submitUnassigned.error?.message ?? '');
  const probeQ = fetched[0];
  const submitWrong = await dbA.rpc('quiz_submit_answer', { p_question_id: probeQ.id as string, p_answer: 'Z.必错项' });
  const wrongRes = submitWrong.data as { correct?: boolean; answer?: string; explanation?: string; alreadyAnswered?: boolean } | null;
  check('判分RPC：答错 → correct=false且返回answer/explanation', !submitWrong.error && wrongRes?.correct === false && Boolean(wrongRes?.answer), submitWrong.error?.message ?? '');
  // 幂等/不刷分：同一题再次提交"正确答案"，必须保持首次结果（alreadyAnswered=true 且 correct=false）
  const resubmit = await dbA.rpc('quiz_submit_answer', { p_question_id: probeQ.id as string, p_answer: 'A.假装第一次答对' });
  const resubmitRes = resubmit.data as { correct?: boolean; alreadyAnswered?: boolean } | null;
  check('判分RPC幂等：重复提交不覆盖首次结果（不刷分）', !resubmit.error && resubmitRes?.alreadyAnswered === true && resubmitRes?.correct === false, JSON.stringify(resubmitRes ?? null));
  // 用第二题验证答对路径（第一题已被首次作答终局锁定）
  const probeQ2 = fetched[1];
  if (probeQ2) {
    const probe2AnswerRow = await dbB.from('quiz_questions').select('answer').eq('id', probeQ2.id as string).maybeSingle();
    const submitRight = await dbA.rpc('quiz_submit_answer', { p_question_id: probeQ2.id as string, p_answer: probe2AnswerRow.data?.answer ?? '' });
    check('判分RPC：答对（教师视角答案对照） → correct=true', (submitRight.data as { correct?: boolean } | null)?.correct === true, probe2AnswerRow.error?.message ?? '');
  }
  if (c) {
    const submitC = await userClient(c.access_token).rpc('quiz_submit_answer', { p_question_id: probeQ.id as string, p_answer: 'A.越权' });
    check('判分RPC：C对A的题目作答 → NOT_ASSIGNED', (submitC.data as { error?: string } | null)?.error === 'NOT_ASSIGNED');
  }
  // 8.5 匿名调题库 RPC 全拦截
  const anonFetch = await anon.rpc('quiz_fetch_questions', { p_count: 3 });
  check('匿名调quiz_fetch_questions被拦截（无登录）', anonFetch.error !== null || anonFetch.data === null);
  const anonSubmit = await anon.rpc('quiz_submit_answer', { p_question_id: probeQ.id as string, p_answer: 'A.匿名' });
  check('匿名调quiz_submit_answer被拦截（无登录）', anonSubmit.error !== null || anonSubmit.data === null);

  // ---- 8.6 防伪造：学生直插/直改 quiz_assignments 全拦截 ----
  // 直插伪造分配（自分配任意题目后即可调判分RPC提前取答案）必须被 RLS 拒绝
  const forgeInsert = await dbA.from('quiz_assignments').insert({ user_id: a.user.id, question_id: notAssignedId });
  check('学生A直插quiz_assignments伪造分配被拒绝（仅受控取题RPC可写）', Boolean(forgeInsert.error), forgeInsert.error?.message ?? '');
  // 伪造他人分配（给C塞题）同样拒绝
  if (c) {
    const forgeForC = await dbA.from('quiz_assignments').insert({ user_id: c.user.id, question_id: notAssignedId });
    check('学生A给C伪造分配被拒绝', Boolean(forgeForC.error));
  }
  // 直改自己的作答记录（刷正确率）必须无效果
  const forgeUpdate = await dbA.from('quiz_assignments').update({ is_correct: true, submitted_answer: 'A.篡改' }).eq('user_id', a.user.id).eq('question_id', probeQ.id as string);
  const afterForge = await dbA.from('quiz_assignments').select('is_correct,submitted_answer').eq('user_id', a.user.id).eq('question_id', probeQ.id as string).maybeSingle();
  check('学生A直改自己的is_correct/答案记录被拒绝（无UPDATE策略，数据未变）', !forgeUpdate.error && afterForge.data?.is_correct === false && afterForge.data?.submitted_answer === 'Z.必错项', JSON.stringify(afterForge.data ?? null));
  // 直删重练（删记录后重新作答刷分）同样拒绝
  const forgeDelete = await dbA.from('quiz_assignments').delete().eq('user_id', a.user.id).eq('question_id', probeQ.id as string);
  const afterDelete = await dbA.from('quiz_assignments').select('question_id').eq('user_id', a.user.id).eq('question_id', probeQ.id as string).maybeSingle();
  check('学生A直删作答记录重练被拒绝（记录仍在）', !forgeDelete.error && afterDelete.data !== null);

  // ---- 清理探针数据 ----
  await dbB.from('training_reports').delete().eq('id', reportAId);
  await dbB.from('case_snapshot_answers').delete().eq('case_id', 'teacher-rls-probe');
  await dbB.from('case_snapshot_facts').delete().eq('case_id', 'teacher-rls-probe');
  await dbA.from('training_sessions').delete().eq('id', sessionId);
  await dbA.from('training_sessions').delete().eq('id', rpcSessionId);
  await dbB.from('training_sessions').delete().eq('id', bSessionId);
  await dbA.from('quiz_assignments').delete().eq('user_id', a.user.id);
  if (c) await userClient(c.access_token).from('quiz_assignments').delete().eq('user_id', c.user.id);
  console.log('已清理探针数据');

  console.log(`\n结果: pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => { console.error('FATAL', error); process.exit(1); });
