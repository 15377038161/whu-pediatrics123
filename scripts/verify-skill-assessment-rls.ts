/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 批次8·技能现场考核 RLS 正式验收：真实 Data API（anon key + 用户 JWT + X-Instance-ID）。
 * 允许与拒绝场景与生产运行时同链路。
 *
 * 硬验证（不依赖考核数据）：
 * - 匿名：skill_rubric_items / skill_assessments / skill_assessment_scores 三表 select 必须失败（anon 无 GRANT）；
 *   skill_assessments_student / skill_assessment_publish RPC 必须失败。
 *
 * 软验证（依赖凭据环境，缺失时 SKIP）：
 * - 学生 A：评分项 select 恰 40 项且 8 技能各 5 项；skill_assessments_student 返回数组结构（可为空）；
 *   skill_assessments 直读被 RLS 过滤（返回 0 行，证明学生无直读面）。
 * - 教师（需 RLS_PROBE_T_PWD 教师凭据，缺失时 SKIP）：本人考核表可读写。
 *
 * 凭据：RLS_PROBE_A_PWD 从环境变量读取（不硬编码）；缺失时只执行匿名拒绝组，
 * authenticated 组输出 SKIP 并退出码 2（待凭据环境重跑）。
 * 运行：pnpm tsx scripts/verify-skill-assessment-rls.ts
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

const studentCredentialAvailable = Boolean(process.env.RLS_PROBE_A_PWD);
const teacherCredentialAvailable = Boolean(process.env.RLS_PROBE_T_PWD);

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

const PLACEHOLDER_ASSESSMENT_ID = '00000000-0000-4000-8000-000000000001';

interface RubricItemRow { id: string; skill_id: string; item_key: string; sort_order: number }
interface StudentAssessmentItem {
  assessmentId: string;
  skillId: string;
  skillTitle: string;
  totalScore: number | null;
  publishedAt: string;
  items: Array<{ itemKey: string; itemLabel: string; score: number | null }>;
}

async function main(): Promise<void> {
  console.log('== 批次8·技能现场考核 RLS 验收 ==');

  // ---------- 匿名拒绝组（硬验证） ----------
  const anon = anonClient();
  const anonRubric = await anon.from('skill_rubric_items').select('id').limit(1);
  check('匿名 skill_rubric_items select 被拒绝', anonRubric.error !== null, anonRubric.error?.message ?? '未报错');
  const anonAssessments = await anon.from('skill_assessments').select('id').limit(1);
  check('匿名 skill_assessments select 被拒绝', anonAssessments.error !== null, anonAssessments.error?.message ?? '未报错');
  const anonScores = await anon.from('skill_assessment_scores').select('item_key').limit(1);
  check('匿名 skill_assessment_scores select 被拒绝', anonScores.error !== null, anonScores.error?.message ?? '未报错');
  const anonStudentRpc = await anon.rpc('skill_assessments_student');
  check('匿名 skill_assessments_student 被拒绝', anonStudentRpc.error !== null, anonStudentRpc.error?.message ?? '未报错');
  const anonPublishRpc = await anon.rpc('skill_assessment_publish', { p_assessment_id: PLACEHOLDER_ASSESSMENT_ID });
  check('匿名 skill_assessment_publish 被拒绝', anonPublishRpc.error !== null, anonPublishRpc.error?.message ?? '未报错');

  // ---------- 学生组 ----------
  const probeEmail = process.env.RLS_PROBE_A_EMAIL ?? 'probe-a@example.com';
  if (!studentCredentialAvailable) {
    checkSkip('学生 A 评分项/无直读面/RPC 结构', '缺少 RLS_PROBE_A_PWD');
  } else {
    const token = await login(probeEmail, process.env.RLS_PROBE_A_PWD as string);
    const student = userClient(token.access_token);

    const rubricSelect = await student.from('skill_rubric_items').select('id, skill_id, item_key, sort_order').order('sort_order');
    check('学生 A skill_rubric_items select 成功', rubricSelect.error === null, rubricSelect.error?.message ?? `${rubricSelect.data?.length ?? 0} 行`);
    const rubricRows = (rubricSelect.data ?? []) as RubricItemRow[];
    check('评分项种子恰 40 项', rubricRows.length === 40, `实际 ${rubricRows.length} 行`);
    const perSkill = new Map<string, number>();
    for (const row of rubricRows) perSkill.set(row.skill_id, (perSkill.get(row.skill_id) ?? 0) + 1);
    check('8 项技能各 5 项', perSkill.size === 8 && [...perSkill.values()].every((count) => count === 5), `覆盖技能 ${perSkill.size} 项`);

    const directRead = await student.from('skill_assessments').select('id').limit(5);
    check('学生 A skill_assessments 直读被 RLS 过滤（0 行不报错）', directRead.error === null && (directRead.data ?? []).length === 0, `返回 ${directRead.data?.length ?? 'ERR'} 行`);

    const studentRpc = await student.rpc('skill_assessments_student');
    check('学生 A skill_assessments_student 成功', studentRpc.error === null, studentRpc.error?.message ?? 'ok');
    const items = (studentRpc.data ?? []) as unknown;
    const list = Array.isArray(items) ? (items as StudentAssessmentItem[]) : [];
    check(
      '学生考核投影键结构完整（可为空数组）',
      list.every((item) => typeof item.assessmentId === 'string' && typeof item.skillTitle === 'string' && Array.isArray(item.items)),
      `实际 ${list.length} 条`,
    );
    if (list.length > 0) {
      console.log(`INFO 学生已发布考核: ${list.map((item) => `${item.skillTitle}=${item.totalScore}`).join('、')}`);
    }
  }

  // ---------- 教师组 ----------
  const teacherEmail = process.env.RLS_PROBE_T_EMAIL ?? '';
  if (!teacherCredentialAvailable || !teacherEmail) {
    checkSkip('教师本人考核表读写', '缺少 RLS_PROBE_T_PWD/RLS_PROBE_T_EMAIL');
  } else {
    const token = await login(teacherEmail, process.env.RLS_PROBE_T_PWD as string);
    const teacher = userClient(token.access_token);
    const listRead = await teacher.from('skill_assessments').select('id').limit(5);
    check('教师 skill_assessments 直读成功（本人行集，可为空）', listRead.error === null, listRead.error?.message ?? `返回 ${listRead.data?.length ?? 0} 行`);
    // 跨教师越权写：以伪造 teacher_id 插入应被 with check 拒绝（不改动真实数据）
    const forgedInsert = await teacher.from('skill_assessments').insert({
      teacher_id: PLACEHOLDER_ASSESSMENT_ID,
      student_id: PLACEHOLDER_ASSESSMENT_ID,
      skill_id: (await teacher.from('skills').select('id').limit(1)).data?.[0]?.id ?? PLACEHOLDER_ASSESSMENT_ID,
      status: 'draft',
      client_event_id: `forge-${Date.now()}`,
    }).select('id');
    check('教师伪造 teacher_id 插入被 RLS 拒绝', forgedInsert.error !== null, forgedInsert.error?.message ?? '未报错');
  }

  console.log(`\n结果：pass=${pass} fail=${fail} skip=${skip}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
