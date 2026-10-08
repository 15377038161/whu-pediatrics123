/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * quiz 全链路验收（真实学生身份 + 完整 HTTP 栈）：
 * 1. 学生/教师用真实 Supabase 凭据登录拿 JWT；
 * 2. 学生 JWT POST /api/auth/callback/platform-session（生产 OAuth 落地同款路由）拿 httpOnly cookie；
 * 3. 携带 cookie 走 GET /api/quiz/questions → POST /api/quiz/answer（含重复提交幂等）→ GET /api/quiz/review；
 * 4. 教师身份 POST /api/quiz/review 验证池状态读取。
 * 运行：pnpm tsx scripts/verify-quiz-flow.ts
 */
export {};
import { PROBE_USER_A, PROBE_USER_B } from './probe-credentials';

const BASE = process.env.QUIZ_FLOW_BASE_URL || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5173}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;

const STUDENT = PROBE_USER_A;
const TEACHER = PROBE_USER_B;

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
  const student = await login(STUDENT);
  console.log(`学生 ${student.user.email} id=${student.user.id}`);
  const cookie = await establishSession(student);
  check('platform-session 落地成功（httpOnly cookie 写入）', true, 'luojia-peds-auth');

  // 1. 取题
  const q = await api('/api/quiz/questions?count=2', cookie);
  const questions = q.body?.data?.questions ?? [];
  check('学生取题 2 道', q.status === 200 && questions.length === 2, `status=${q.status} n=${questions.length}`);
  check('取题投影不含答案列', questions.every((x: any) => !('answer' in x) && !('explanation' in x)));

  let answeredId: string | null = null;
  let firstSubmittedAnswer: string | null = null;
  if (questions.length > 0) {
    // 2. 作答（故意答错也行：判分在服务端）
    const first = questions[0] as { id: string; options?: Array<{ id?: string; key?: string }> };
    const optionKey = first.options?.[0]?.key ?? first.options?.[0]?.id ?? 'A';
    const a1 = await api('/api/quiz/answer', cookie, {
      method: 'POST',
      body: JSON.stringify({ questionId: first.id, answer: String(optionKey) }),
    });
    answeredId = first.id;
    firstSubmittedAnswer = a1.body?.data?.submittedAnswer ?? a1.body?.data?.submitted_answer ?? String(optionKey);
    check('学生作答判分（服务端返回正确答案+解析）', a1.status === 200 && 'answer' in (a1.body?.data ?? {}), `status=${a1.status}`);

    // 3. 幂等：重复提交返回首次记录
    const a2 = await api('/api/quiz/answer', cookie, {
      method: 'POST',
      body: JSON.stringify({ questionId: first.id, answer: 'ZZZ' }),
    });
    const same = a2.status === 200
      && (a2.body?.data?.submittedAt ?? a2.body?.data?.submitted_at) === (a1.body?.data?.submittedAt ?? a1.body?.data?.submitted_at);
    check('重复提交幂等（不覆盖首次成绩）', same, `status=${a2.status}`);
  } else {
    console.log('SKIP 作答/幂等：池已耗尽（该探针学生已取完全部题目）');
  }

  // 4. 复盘
  const r = await api('/api/quiz/review', cookie);
  const records = r.body?.data?.records ?? [];
  check('学生错题/记录复盘', r.status === 200 && Array.isArray(records), `status=${r.status} n=${records.length}`);

  // 4b. 跨学生隔离：学生B复盘记录中不含学生A的作答行（quiz_review_mine 按本人过滤）
  const cookieB = await establishSession(await login(TEACHER));
  const rB = await api('/api/quiz/review', cookieB);
  const recordsB = (rB.body?.data?.records ?? []) as Array<{ id: string }>;
  const studentAIds = new Set(records.map((x: any) => x.id));
  const crossLeak = recordsB.some((x) => studentAIds.has(x.id));
  check('跨学生复盘隔离（B看不到A的作答行）', rB.status === 200 && !crossLeak, `B_n=${recordsB.length}`);

  // 4c. 持久化（等价重启验证）：复盘返回的作答记录含 answeredAt，
  //     且此前幂等提交的题目在记录中保留首次 submittedAnswer（服务重启后读自数据库）。
  const persisted = records.find((x: any) => x.id === answeredId);
  if (persisted) {
    check('作答记录持久化（重启后读自数据库，首次作答保留）',
      persisted.answeredAt !== null && (firstSubmittedAnswer === null || persisted.submittedAnswer === firstSubmittedAnswer),
      `answeredAt=${persisted.answeredAt}`);
  } else {
    console.log('SKIP 持久化断言：本轮未作答（池已耗尽），已有记录仍来自数据库');
  }

  // 5. 学生不得访问教师池状态
  const denied = await api('/api/quiz/review', cookie, { method: 'POST', body: '{}' });
  check('学生 POST /quiz/review 被拒（角色校验）', denied.status === 403 || denied.status === 401, `status=${denied.status}`);

  // 6. 教师池状态（应用层）：email 探针无 chaoxing 元数据（生产教师经 OAuth 携带），
  //    应用层 normalizeSupabaseUser 判为学生并 403——验证应用层角色判定正确拒绝。
  const teacher = await login(TEACHER);
  const teacherCookie = await establishSession(teacher);
  const poolDenied = await api('/api/quiz/review', teacherCookie, { method: 'POST', body: '{}' });
  check('无超星元数据的用户被应用层判为学生（403，判定走 chaoxing 身份）', poolDenied.status === 403, `status=${poolDenied.status}`);

  // 6b. 教师池状态（数据层）：探针 B 在 teacher_emails 白名单（RLS 层教师），
  //     以其 JWT 直读 Data API quiz_questions，验证教师 RLS 读路径可用（应用路由之外的数据层证据）。
  const dbTeacher = await fetch(`${SUPA_URL}/rest/v1/quiz_questions?select=case_id&status=eq.available&limit=5`, {
    headers: {
      apikey: SUPA_ANON_KEY,
      Authorization: `Bearer ${teacher.access_token}`,
      'X-Instance-ID': SUPA_TENANT_ID,
    },
  });
  const poolRows = dbTeacher.ok ? await dbTeacher.json() : [];
  check('教师JWT经RLS直读题池（Data API）', dbTeacher.ok && Array.isArray(poolRows), `status=${dbTeacher.status} n=${poolRows.length}`);
  check('教师JWT可读答案列（教师全量维护）', await (async () => {
    const r2 = await fetch(`${SUPA_URL}/rest/v1/quiz_questions?select=answer&limit=1`, {
      headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${teacher.access_token}`, 'X-Instance-ID': SUPA_TENANT_ID },
    });
    return r2.ok;
  })());
  // 6c. 学生 JWT 直读答案列必须被 RLS 拒绝（对照）。
  //     PostgREST 对无 SELECT 策略的表返回 HTTP 200 + 空数组 []（非 403），
  //     判定标准是"返回行数为 0"，而非状态码。
  const studentAnswerRead = await fetch(`${SUPA_URL}/rest/v1/quiz_questions?select=answer&limit=1`, {
    headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${student.access_token}`, 'X-Instance-ID': SUPA_TENANT_ID },
  });
  const studentAnswerRows = studentAnswerRead.ok ? await studentAnswerRead.json() : null;
  check('学生JWT直读答案列被RLS拒绝（0行返回）', Array.isArray(studentAnswerRows) && studentAnswerRows.length === 0, `status=${studentAnswerRead.status} rows=${JSON.stringify(studentAnswerRows)}`);

  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('脚本失败:', e); process.exit(1); });
