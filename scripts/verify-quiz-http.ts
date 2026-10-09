/**
 * 题库最小实际 HTTP 链路验证（学生演示身份，只读断言，不输出题目/答案/凭据）：
 * 1. 取题 /api/quiz/questions：结构投影（无 answer/explanation 键）、随机分发、去重
 * 2. 作答判分 /api/quiz/answer：未分配题目 403、非法参数 422（不真实作答，避免污染演示账号记录）
 * 3. 复盘 /api/quiz/review：仅本人记录结构
 * 4. 权限边界：匿名 401、学生访问教师题池状态 403
 * 凭据仅从受控本地文件读取（0600），结束 signOut。
 */
import { readFileSync } from 'node:fs';

const BASE = `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const CREDS_FILE = process.env.QUIZ_CRED_FILE ?? '/tmp/demo-student-credentials.txt';
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

interface Creds { email: string; password: string }

function readCreds(): Creds {
  const raw = readFileSync(CREDS_FILE, 'utf-8');
  const map: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const m = /^(email|password)\s*[:=]\s*(.+)$/i.exec(line.trim());
    if (m) map[m[1].toLowerCase()] = m[2].trim();
  }
  if (!map.email || !map.password) throw new Error('credentials file malformed');
  return { email: map.email, password: map.password };
}

interface LoginResult { accessToken: string; refreshToken: string }

async function login(email: string, password: string): Promise<LoginResult> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as { access_token?: string; refresh_token?: string; error_code?: string };
  if (!resp.ok || !body.access_token || !body.refresh_token) throw new Error(`login failed: ${body.error_code ?? resp.status}`);
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

async function signOut(accessToken: string): Promise<void> {
  await fetch(`${SUPA_URL}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${accessToken}` },
  }).catch(() => undefined);
}

interface ApiEnvelope<T> { success?: boolean; data?: T; error?: { code?: string; message?: string } }

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const res = await fetch(`${BASE}${path}`, init);
  let body: ApiEnvelope<T> = {};
  try { body = (await res.json()) as ApiEnvelope<T>; } catch { /* 非 JSON 响应 */ }
  return { status: res.status, body };
}

const passed: string[] = [];
const failed: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed.push(name); console.log(`  ok - ${name}`); }
  else { failed.push(name); console.log(`  FAIL - ${name}${detail ? ` (${detail})` : ''}`); }
}

interface QuestionProjection { id?: string; caseId?: string; stem?: string; options?: unknown; difficulty?: string }

async function main(): Promise<void> {
  const { email, password } = readCreds();
  const { accessToken } = await login(email, password);
  const auth = { Authorization: `Bearer ${accessToken}` } as Record<string, string>;

  // --- 1. 取题 ---
  console.log('# 取题 /api/quiz/questions');
  const q1 = await call<{ questions?: QuestionProjection[]; poolExhausted?: boolean }>(
    '/api/quiz/questions?count=5', { headers: auth });
  check('取题 HTTP 200', q1.status === 200, `status=${q1.status}`);
  const qs = q1.body.data?.questions ?? [];
  const structureOk = Array.isArray(qs) && qs.every((q) => typeof q.id === 'string'
    && typeof q.caseId === 'string'
    && typeof q.stem === 'string' && q.stem.length > 0
    && Array.isArray(q.options) && q.options.length >= 2
    && ['easy', 'medium', 'hard'].includes(String(q.difficulty)));
  check('题目投影结构合法（stem/options/difficulty）', structureOk, `count=${qs.length}`);
  check('取题数 <= 5', qs.length <= 5, `count=${qs.length}`);
  const projectionLeak = qs.some((q) => 'answer' in (q as Record<string, unknown>) || 'explanation' in (q as Record<string, unknown>));
  check('投影不含 answer/explanation 键', !projectionLeak);

  if (qs.length >= 2) {
    console.log('# 再取一批：去重（本人不重复分配）');
    const q2 = await call<{ questions?: QuestionProjection[] }>(
      '/api/quiz/questions?count=5', { headers: auth });
    const ids1 = new Set(qs.map((q) => q.id));
    const ids2 = (q2.body.data?.questions ?? []).map((q) => q.id);
    check('两次取题无重复分配', ids2.every((id) => !ids1.has(id)), `overlap=${ids2.filter((id) => ids1.has(id)).length}`);
    const caseIds = new Set(qs.map((q) => q.caseId));
    check('题目带病例来源 caseId（catalog 关联可追溯）', caseIds.size >= 1);
  } else {
    // 池耗尽也是合法状态：演示账号此前可能已取完全部 43 题
    check('池耗尽时返回 poolExhausted 或空数组', q1.body.data?.poolExhausted === true || qs.length === 0);
    console.log('  (note) 题池对本账号已耗尽，去重断言跳过');
  }

  // --- 2. 作答判分：仅边界断言，不真实作答（不污染演示账号记录） ---
  console.log('# 作答判分边界 /api/quiz/answer');
  const a1 = await call('/api/quiz/answer', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId: '00000000-0000-0000-0000-000000000000', answer: '非本题选项' }),
  });
  check('未分配题目作答被拒（403/404 归属校验）', a1.status === 403 || a1.status === 404, `status=${a1.status}`);
  const a2 = await call('/api/quiz/answer', {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId: '' }),
  });
  check('非法参数 422', a2.status === 422, `status=${a2.status}`);

  // --- 3. 复盘 ---
  console.log('# 复盘 /api/quiz/review');
  const r1 = await call<{ records?: unknown[] }>('/api/quiz/review', { headers: auth });
  check('复盘 HTTP 200', r1.status === 200, `status=${r1.status}`);
  check('复盘返回本人记录数组', Array.isArray(r1.body.data?.records));

  // --- 4. 权限边界 ---
  console.log('# 权限边界');
  const anon = await call('/api/quiz/questions');
  check('匿名取题 401', anon.status === 401, `status=${anon.status}`);
  const teacherOnly = await call('/api/quiz/review', { method: 'POST', headers: auth });
  check('学生访问教师题池状态 403', teacherOnly.status === 403, `status=${teacherOnly.status}`);
  const wrongCase = await call('/api/quiz/answer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId: '00000000-0000-0000-0000-000000000000', answer: 'x' }),
  });
  check('无凭据作答 401', wrongCase.status === 401, `status=${wrongCase.status}`);

  await signOut(accessToken);

  console.log(`\n# 题库 HTTP 链路：${passed.length} pass / ${failed.length} fail`);
  if (failed.length > 0) process.exitCode = 1;
}

void main().catch((e: unknown) => { console.error('FATAL', (e as Error).message); process.exit(1); });
