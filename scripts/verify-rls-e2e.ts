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

const USER_A = { email: 'rls-probe-a@luojia.dev', password: 'RlsProbe#2026A' };
const USER_B = { email: 'rls-probe-b@luojia.dev', password: 'RlsProbe#2026B' };

type TokenResult = { access_token: string; user: { id: string; email?: string } };

async function login(email: string, password: string): Promise<TokenResult> {
  const resp = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'X-Instance-ID': tenantId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as TokenResult & { error_code?: string; msg?: string };
  if (!resp.ok || !body.access_token) {
    throw new Error(`登录失败 ${email}: ${body.error_code ?? body.msg ?? resp.status}`);
  }
  return body;
}

function userClient(token: string) {
  return createClient(url, anonKey, {
    global: { headers: { 'X-Instance-ID': tenantId, Authorization: `Bearer ${token}` } },
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

  // ---- 5. case_snapshot_facts：登录可读；学生可插入（防投毒 ignoreDuplicates 依赖服务端）----
  const probeVersion = `rlsprobe-${Date.now()}`;
  const factsInsert = await dbA.from('case_snapshot_facts').insert({
    case_id: 'teacher-rls-probe', version: probeVersion, source_name: 'rls-probe', facts: { caseId: 'teacher-rls-probe', sections: { history: 'probe', exam: '', tests: '' } },
  });
  check('学生A可插入case_snapshot_facts（登录可插入）', !factsInsert.error, factsInsert.error?.message ?? '');
  const { data: factsA } = await dbA.from('case_snapshot_facts').select('case_id,version').eq('case_id', 'teacher-rls-probe').eq('version', probeVersion).maybeSingle();
  check('学生A可读插入的facts', Boolean(factsA));

  // 学生不能 UPDATE facts（仅教师）：RLS 拦截时 UPDATE 命中 0 行（不报错），以「数据未被篡改」为判定
  await dbA.from('case_snapshot_facts').update({ source_name: 'tampered' }).eq('case_id', 'teacher-rls-probe').eq('version', probeVersion);
  const { data: factsAfterUpdate } = await dbA.from('case_snapshot_facts').select('source_name').eq('case_id', 'teacher-rls-probe').eq('version', probeVersion).maybeSingle();
  check('学生A不能UPDATE case_snapshot_facts（teacher_manage拦截，数据未被篡改）', factsAfterUpdate?.source_name !== 'tampered');

  // ---- 6. case_snapshot_answers：学生不可读写，教师可读写 ----
  const answersInsert = await dbA.from('case_snapshot_answers').insert({
    case_id: 'teacher-rls-probe', version: probeVersion, diagnosis: '不应写入', plan: '', documents: [], media: [],
  });
  check('学生A不能插入case_snapshot_answers（teacher-only拦截）', Boolean(answersInsert.error));
  const answersRead = await dbA.from('case_snapshot_answers').select('case_id').eq('case_id', 'teacher-rls-probe').limit(1);
  check('学生A读不到case_snapshot_answers任何行（teacher-only拦截）', (answersRead.data?.length ?? 0) === 0);

  const teacherAnswers = await dbB.from('case_snapshot_answers').upsert({
    case_id: 'teacher-rls-probe', version: probeVersion, diagnosis: '教师测试诊断', plan: '教师测试方案', documents: [], media: [],
  }, { onConflict: 'case_id,version' });
  check('教师B可写入case_snapshot_answers', !teacherAnswers.error, teacherAnswers.error?.message ?? '');
  const { data: answersB } = await dbB.from('case_snapshot_answers').select('diagnosis').eq('case_id', 'teacher-rls-probe').eq('version', probeVersion).maybeSingle();
  check('教师B可读case_snapshot_answers（诊断答案）', answersB?.diagnosis === '教师测试诊断');

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
  await dbB.from('training_sessions').delete().eq('id', bSessionId);
  console.log('已清理探针数据');

  console.log(`\n结果: pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => { console.error('FATAL', error); process.exit(1); });
