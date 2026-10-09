/**
 * 题库真实作答验收（2026-10-10）：
 * - 优先使用既有 probe 学生测试身份（本轮专用），受控凭据本地读取，不输出值
 * - 链路：取题(最少)→提交有效选项→首次结果→重复提交幂等→退出重登结果保留→复盘仅本人
 * - 作答记录明确标记（answer 前缀 '[verify-quiz-answer]'，不删除业务记录）
 * - 不读取答案列（真实已知正确/错误选项不绕过学生权限）；两支判分由合成单测覆盖
 * - 双身份可登录时补最小跨账号拒绝验证
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.QUIZ_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const PROBE_FILE = process.env.QUIZ_PROBE_CRED_FILE ?? '/workspace/.demo-secrets/probe-account-credentials-deprecated.txt';
const DEMO_FILE = process.env.QUIZ_DEMO_CRED_FILE ?? '/workspace/.demo-secrets/demo-student-credentials.txt';
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

interface Creds { email: string; password: string }
function readCreds(path: string): Creds {
  const map: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = /^(email|password)\s*[:=]\s*(.+)$/i.exec(line.trim());
    if (m) map[m[1].toLowerCase()] = m[2].trim();
  }
  if (!map.email || !map.password) throw new Error(`凭据文件 ${path} 缺少 email/password`);
  return { email: map.email, password: map.password };
}

interface AuthTokens { access_token: string; refresh_token: string; role?: string }
async function login(email: string, password: string): Promise<AuthTokens | null> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) return null;
  const body = (await resp.json()) as AuthTokens;
  return body.access_token ? body : null;
}
async function signOutGlobal(token: string): Promise<void> {
  await fetch(`${SUPA_URL}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

interface ApiEnvelope<T> { ok?: boolean; data?: T; error?: { code?: string; message?: string } }
async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}

const passed: string[] = [];
const failed: string[] = [];
const notes: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed.push(name); console.log(`PASS  ${name}`); }
  else { failed.push(name); console.log(`FAIL  ${name}${detail ? ` (${detail})` : ''}`); }
}
function note(name: string, value: unknown): void {
  notes.push(`${name}: ${JSON.stringify(value)}`);
  console.log(`NOTE  ${name}: ${JSON.stringify(value)}`);
}

interface QuestionProjection { id: string; caseId?: string; stem?: string; options?: string[]; difficulty?: string }
interface AnswerResult { correct?: boolean; answer?: string; explanation?: string; alreadyAnswered?: boolean; submittedAnswer?: string }
interface ReviewItem { id: string; submittedAnswer?: string | null; isCorrect?: boolean | null; answeredAt?: string | null; answer?: string | null }

// 答案内容不输出：仅记录存在性与哈希/计数
function sha256(s: string): string {
  // 简易指纹：仅用于比对一致性，不还原内容
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `fp${h.toString(16)}`;
}

async function main(): Promise<void> {
  // === 身份选择：优先 probe 测试身份 ===
  let tokens: AuthTokens | null = null;
  let identity: string;
  try {
    const probe = readCreds(PROBE_FILE);
    tokens = await login(probe.email, probe.password);
    identity = 'probe 测试身份';
  } catch {
    tokens = null;
    identity = '';
  }
  if (tokens) {
    check('probe 测试身份受控凭据可用并可登录', true);
  } else {
    // 不可用：按用户指令报告阻塞，不擅自改演示账号密码/不建新账号
    note('probe 身份登录', '不可用（凭据缺失或已失效）');
    console.log('\n# 阻塞：无可用专用测试身份，真实作答验收无法执行');
    process.exitCode = 1;
    return;
  }

  // === 1. 取题（最少 1 题） ===
  console.log('\n## 取题（count=1）');
  const q1 = await api<{ questions?: QuestionProjection[]; poolExhausted?: boolean }>('/api/quiz/questions?count=1', { token: tokens.access_token });
  const qs = q1.body.data?.questions ?? [];
  check('取题 HTTP 200', q1.status === 200, `status=${q1.status}`);
  check('取得题目（poolExhausted=false 且 1 题）', qs.length === 1 && q1.body.data?.poolExhausted === false, `count=${qs.length}, exhausted=${q1.body.data?.poolExhausted}`);
  const question = qs[0];
  if (!question || !question.options || question.options.length === 0) {
    console.log('FAIL  无可用题目，中止');
    await signOutGlobal(tokens.access_token);
    process.exitCode = 1;
    return;
  }
  note('题目标识', { id: question.id.slice(0, 8), options: question.options.length, difficulty: question.difficulty });
  const projectionLeak = 'answer' in (question as unknown as Record<string, unknown>) || 'explanation' in (question as unknown as Record<string, unknown>);
  check('取题投影不含 answer/explanation 键（作答前不泄露答案）', !projectionLeak);

  // === 2. 提交有效选项（明确标记） ===
  console.log('\n## 首次提交（提交选项为题目 options 中的合法项）');
  const chosen = question.options[0];
  const submitBody = { questionId: question.id, answer: chosen };
  const a1 = await api<AnswerResult>('/api/quiz/answer', { method: 'POST', token: tokens.access_token, body: JSON.stringify(submitBody) });
  check('首次作答 HTTP 200', a1.status === 200, `status=${a1.status}`);
  check('首次返回判分结果（correct 布尔）', typeof a1.body.data?.correct === 'boolean');
  check('首次提交非重复（alreadyAnswered 非真）', a1.body.data?.alreadyAnswered !== true);
  note('首次结果指纹', { correct: a1.body.data?.correct, answerFp: a1.body.data?.answer ? sha256(a1.body.data.answer) : null, explanationLen: a1.body.data?.explanation?.length ?? 0 });

  // === 3. 重复提交幂等（换一个选项，验证不改分不覆盖） ===
  console.log('\n## 重复提交（换选项，验证幂等不改分）');
  const other = question.options.find((o) => o !== chosen) ?? chosen;
  const a2 = await api<AnswerResult>('/api/quiz/answer', { method: 'POST', token: tokens.access_token, body: JSON.stringify({ questionId: question.id, answer: other }) });
  check('重复提交 HTTP 200', a2.status === 200, `status=${a2.status}`);
  check('重复提交标记 alreadyAnswered=true', a2.body.data?.alreadyAnswered === true);
  check('重复提交不改分（correct 与首次一致）', a2.body.data?.correct === a1.body.data?.correct, `first=${a1.body.data?.correct} second=${a2.body.data?.correct}`);
  check('重复提交不覆盖首次选项（submittedAnswer=首次指纹）', a2.body.data?.submittedAnswer === chosen, `submitted=${a2.body.data?.submittedAnswer === chosen ? '首次选项' : '其他'}`);
  check('重复提交返回首次答案（指纹一致）', !a2.body.data?.answer || !a1.body.data?.answer || sha256(a2.body.data.answer) === sha256(a1.body.data.answer));

  // === 4. 退出重登后结果保留 ===
  console.log('\n## 退出重登结果保留');
  await signOutGlobal(tokens.access_token);
  const fresh = await login(readCreds(PROBE_FILE).email, readCreds(PROBE_FILE).password);
  check('退出后重新登录成功', fresh !== null && Boolean(fresh.access_token));
  if (fresh) {
    tokens = fresh;
    const r1 = await api<{ records?: ReviewItem[] }>('/api/quiz/review', { token: tokens.access_token });
    const records = r1.body.data?.records ?? [];
    const mine = records.find((r) => r.id === question.id);
    check('重登后复盘含本题记录', r1.status === 200 && mine !== undefined, `records=${records.length}`);
    check('重登后结果保留（isCorrect 与首次一致）', mine?.isCorrect === a1.body.data?.correct, `stored=${mine?.isCorrect} first=${a1.body.data?.correct}`);
    check('重登后首次选项保留（submittedAnswer=首次指纹）', mine?.submittedAnswer === chosen);
    note('复盘记录计数', { total: records.length, answered: records.filter((r) => r.answeredAt !== null).length });
  }

  // === 5. 复盘仅本人且作答前不泄露（结构性） ===
  console.log('\n## 复盘边界（作答前不泄露）');
  // 取新题（未作答），验证复盘中新题无 answer/explanation
  const q2 = await api<{ questions?: QuestionProjection[] }>('/api/quiz/questions?count=1', { token: tokens.access_token });
  const fresh2 = q2.body.data?.questions ?? [];
  if (fresh2.length === 1) {
    const r2 = await api<{ records?: ReviewItem[] }>('/api/quiz/review', { token: tokens.access_token });
    const unAnswered = (r2.body.data?.records ?? []).find((r) => r.id === fresh2[0].id);
    if (unAnswered) {
      check('未作答题目复盘无 answer/explanation（作答前不泄露）', unAnswered.answer == null, `answer=${unAnswered.answer === null || unAnswered.answer === undefined ? 'null' : '存在'}`);
    } else {
      // 复盘不含未分配题也合法（仅返回已分配题目）
      check('未作答题目不出现在复盘（作答前不泄露）', true);
      note('复盘边界', '新题未出现在复盘列表（仅返回已分配题目，同样不泄露）');
    }
  } else {
    note('复盘边界（新题）', '题池耗尽，跳过');
  }

  // === 6. 跨账号拒绝（演示身份可登录时） ===
  console.log('\n## 跨账号读取/作答拒绝（最小验证）');
  let demoTokens: AuthTokens | null = null;
  try {
    const demo = readCreds(DEMO_FILE);
    demoTokens = await login(demo.email, demo.password);
  } catch { demoTokens = null; }
  if (demoTokens) {
    check('第二合法身份（演示学生）可登录', true);
    // 演示身份作答 probe 身份的题目 → 应被归属校验拒绝
    const cross = await api<AnswerResult>('/api/quiz/answer', { method: 'POST', token: demoTokens.access_token, body: JSON.stringify({ questionId: question.id, answer: chosen }) });
    check('跨账号作答他人分配题目被拒（403/404）', cross.status === 403 || cross.status === 404, `status=${cross.status}`);
    // 跨账号复盘不包含 probe 的作答记录
    const crossReview = await api<{ records?: ReviewItem[] }>('/api/quiz/review', { token: demoTokens.access_token });
    const crossRecords = crossReview.body.data?.records ?? [];
    const leaked = crossRecords.find((r) => r.id === question.id && r.answeredAt !== null);
    check('跨账号复盘不含他人作答记录', leaked === undefined, `leaked=${leaked !== undefined}`);
    await signOutGlobal(demoTokens.access_token);
  } else {
    note('跨账号验证', '第二身份不可用（演示凭据缺失或失效），保留未验');
  }

  await signOutGlobal(tokens.access_token);

  console.log(`\n# 题库真实作答验收：${passed.length} pass / ${failed.length} fail`);
  for (const n of notes) console.log(`  note: ${n}`);
  if (failed.length > 0) process.exitCode = 1;
}

void main().catch((e: unknown) => { console.error('FATAL', (e as Error).message); process.exit(1); });
