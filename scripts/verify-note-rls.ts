/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 批次6·病历书写两表 RLS 正式验收：真实 Data API（anon key + 用户 JWT + X-Instance-ID）。
 * note_drafts / note_submissions 的允许与拒绝场景，与生产运行时同链路。
 *
 * 硬验证（不依赖班级归属关系）：
 * - 匿名：两表 select/insert 必须失败（anon 无 GRANT）。
 * - 学生 A：本人草稿 insert/update 成功；本人提交 insert 成功；AI 回填列 update 成功；
 *   本人改提交原文（content 列级授权）必须失败。
 * - 学生 C：读不到 A 的草稿与提交（行隔离）。
 * - 教师 B：以 A 的 user_id 插入提交必须失败（WITH CHECK 仅 owner）。
 *
 * 软验证（依赖真实班级归属，如实报告不误判）：
 * - 教师 B 对 A 的提交可见性：由 app_can_view_student + class_period 时间锚点决定，
 *   结果取决于探针班级关系，输出实际结果供人工核对。
 *
 * 凭据：RLS_PROBE_A_PWD / RLS_PROBE_B_PWD / RLS_PROBE_C_PWD 从环境变量读取（不硬编码）；
 * 任一缺失时只执行匿名拒绝组，authenticated 组输出 SKIP 并退出码 2（待凭据环境重跑）。
 * 运行：pnpm tsx scripts/verify-note-rls.ts
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

const credentialsAvailable =
  Boolean(process.env.RLS_PROBE_A_PWD) && Boolean(process.env.RLS_PROBE_B_PWD) && Boolean(process.env.RLS_PROBE_C_PWD);

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
let skip = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}
function checkSkip(name: string, detail = ''): void {
  skip += 1;
  console.log(`SKIP ${name}${detail ? ` (${detail})` : ''}`);
}

async function main() {
  console.log(`URL=${SUPA_URL.replace(/\/$/, '')} tenant=${SUPA_TENANT_ID}`);

  // ---- 1. 匿名拒绝组（anon 无任何 GRANT）----
  const anon = anonClient();
  const anonDraftSelect = await anon.from('note_drafts').select('id').limit(1);
  check('匿名读 note_drafts 必须失败', anonDraftSelect.error !== null, anonDraftSelect.error?.message ?? '');
  const anonSubSelect = await anon.from('note_submissions').select('id').limit(1);
  check('匿名读 note_submissions 必须失败', anonSubSelect.error !== null, anonSubSelect.error?.message ?? '');
  const anonSubInsert = await anon.from('note_submissions').insert({
    session_id: crypto.randomUUID(), case_id: 'anon-probe', content: {},
  });
  check('匿名写 note_submissions 必须失败', anonSubInsert.error !== null, anonSubInsert.error?.message ?? '');
  const anonDraftInsert = await anon.from('note_drafts').insert({ session_id: crypto.randomUUID(), content: {} });
  check('匿名写 note_drafts 必须失败', anonDraftInsert.error !== null, anonDraftInsert.error?.message ?? '');

  if (!credentialsAvailable) {
    checkSkip('authenticated 允许/拒绝组（缺 RLS_PROBE_*_PWD 环境变量，待凭据环境重跑）');
    console.log(`\n# tests ${pass + fail + skip}\n# pass ${pass}\n# fail ${fail}\n# skipped ${skip}`);
    process.exit(fail === 0 ? 2 : 1);
  }

  // ---- 2. 探针登录 ----
  const { PROBE_USER_A, PROBE_USER_B, PROBE_USER_C } = await import('./probe-credentials');
  const [a, b, c] = await Promise.all([
    login(PROBE_USER_A.email, PROBE_USER_A.password),
    login(PROBE_USER_B.email, PROBE_USER_B.password),
    login(PROBE_USER_C.email, PROBE_USER_C.password),
  ]);
  console.log(`用户A(学生) id=${a.user.id}`);
  console.log(`用户B(教师) id=${b.user.id}`);
  console.log(`用户C(学生) id=${c.user.id}`);
  const dbA = userClient(a.access_token);
  const dbB = userClient(b.access_token);
  const dbC = userClient(c.access_token);

  // ---- 3. 探针数据自愈：清理历史运行残留 ----
  const staleSessions = await dbA.from('training_sessions').select('id').eq('user_id', a.user.id);
  if (!staleSessions.error && staleSessions.data?.length) {
    await dbA.from('training_sessions').delete().eq('user_id', a.user.id);
  }

  // ---- 4. 学生 A：探针会话 + 草稿 + 提交 ----
  const DEFAULT_COHORT_ID = '10000000-0000-4000-8000-000000000102';
  const sessionId = crypto.randomUUID();
  const sessionInsert = await dbA.from('training_sessions').insert({
    id: sessionId, user_id: a.user.id, cohort_id: DEFAULT_COHORT_ID, case_id: 'teacher-rls-probe',
    case_version: 1, mode: 'osce', stage: 'history', status: 'active', state: {},
  });
  check('学生A可插入自己的训练会话', !sessionInsert.error, sessionInsert.error?.message ?? '');

  const draftContent = { 主诉: '发热咳嗽两天', 现病史: '', 初步诊断: '' };
  const draftInsert = await dbA.from('note_drafts')
    .insert({ session_id: sessionId, content: draftContent })
    .select('id').maybeSingle();
  check('学生A可插入自己的病历草稿', !draftInsert.error && Boolean(draftInsert.data), draftInsert.error?.message ?? '');
  const draftId = draftInsert.data?.id;

  const draftUpdate = await dbA.from('note_drafts')
    .update({ content: { ...draftContent, 现病史: '咳嗽加重一天' }, updated_at: new Date().toISOString() })
    .eq('id', draftId);
  check('学生A可更新自己的病历草稿', !draftUpdate.error, draftUpdate.error?.message ?? '');

  const clientEventId = crypto.randomUUID();
  const submitInsert = await dbA.from('note_submissions').insert({
    session_id: sessionId, case_id: 'teacher-rls-probe', case_version: '1',
    content: { ...draftContent, 现病史: '咳嗽加重一天' }, client_event_id: clientEventId,
  }).select('id').maybeSingle();
  check('学生A可插入自己的病历提交', !submitInsert.error && Boolean(submitInsert.data), submitInsert.error?.message ?? '');
  const submissionId = submitInsert.data?.id;

  const idempotentRetry = await dbA.from('note_submissions').insert({
    session_id: sessionId, case_id: 'teacher-rls-probe', case_version: '1',
    content: { 主诉: '重试' }, client_event_id: clientEventId,
  }).select('id').maybeSingle();
  check('同 client_event_id 重试命中既有提交（唯一索引，不重复插入）',
    idempotentRetry.error !== null, idempotentRetry.error?.message ?? '');

  const aiWriteBack = await dbA.from('note_submissions')
    .update({ ai_review_status: 'ready', ai_review: { summary: '探针意见' }, ai_prompt_version: 'v1' })
    .eq('id', submissionId);
  check('学生A可写回 AI 审阅回填列', !aiWriteBack.error, aiWriteBack.error?.message ?? '');

  const contentTamper = await dbA.from('note_submissions')
    .update({ content: { 主诉: '篡改原文' } })
    .eq('id', submissionId);
  check('学生A改提交原文（content 列级授权）必须失败', contentTamper.error !== null, contentTamper.error?.message ?? '');

  // ---- 5. 行隔离与越权 ----
  const cReadDraft = await dbC.from('note_drafts').select('id').eq('id', draftId).maybeSingle();
  check('学生C读不到A的草稿', cReadDraft.error === null && cReadDraft.data === null, cReadDraft.error?.message ?? '');

  const cReadSubmission = await dbC.from('note_submissions').select('id').eq('id', submissionId).maybeSingle();
  check('学生C读不到A的提交', cReadSubmission.error === null && cReadSubmission.data === null, cReadSubmission.error?.message ?? '');

  const bInsertForA = await dbB.from('note_submissions').insert({
    user_id: a.user.id, session_id: sessionId, case_id: 'teacher-rls-probe', content: { 主诉: '教师越权插入' },
  });
  check('教师B以A的user_id插入提交必须失败（WITH CHECK仅owner）', bInsertForA.error !== null, bInsertForA.error?.message ?? '');

  const bReadA = await dbB.from('note_submissions').select('id').eq('id', submissionId).maybeSingle();
  // 软验证：教师可见性取决于探针班级归属（app_can_view_student + class_period 时间锚点），如实报告。
  console.log(`INFO 教师B读A提交可见性: ${bReadA.data ? 'VISIBLE（教师授权读放行，需人工确认A在B授权班级且提交时间在归属期间内）' : 'INVISIBLE（被 RLS 拒绝，需人工确认A不在B授权班级或超出归属期间）'}`);

  // ---- 6. 收尾清理 ----
  await dbA.from('note_submissions').delete().eq('id', submissionId);
  await dbA.from('note_drafts').delete().eq('id', draftId);
  await dbA.from('training_sessions').delete().eq('id', sessionId);

  console.log(`\n# tests ${pass + fail + skip}\n# pass ${pass}\n# fail ${fail}\n# skipped ${skip}`);
  process.exit(fail === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error('FATAL', error);
  process.exit(1);
});
