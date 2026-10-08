/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 真实服务重启持久化验收（非 DB 复读等价替代）：
 * 1. 真实学生登录（JWT → platform-session 落 httpOnly cookie）；
 * 2. 重启前：作答一题（记录题目ID/答案/判分结果），GET /api/quiz/review 记录基线；
 * 3. 触发 tsx watch 重启（touch src/server.ts），轮询健康检查直到新进程 ready（PID 必须变化）；
 * 4. 复读：同 cookie 再调 review，断言作答记录仍存在且与基线一致（真实重启后从数据库读取）；
 * 5. cookie 重建：用新登录的 JWT 重新走 platform-session 拿新 cookie，仍能读到记录；
 * 6. 退出：POST /api/auth/logout 后，原 cookie 访问受保护接口应 401。
 * 运行：pnpm tsx scripts/verify-restart-persistence.ts
 */
import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

export {};

const BASE = process.env.RESTART_BASE_URL || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5173}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const PROJECT_ROOT = resolve(process.cwd());

const STUDENT = { email: 'rls-probe-a@luojia.dev', password: 'RlsProbe#2026A' };

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

async function establishSession(token: TokenResult): Promise<string> {
  const resp = await fetch(`${BASE}/api/auth/callback/platform-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
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

function serverPid(): string {
  // tsx watch 的服务子进程（node .../loader.mjs src/server.ts）
  const out = execSync(`ps -eo pid,cmd | grep "loader.mjs src/server.ts" | grep -v grep | head -1`, { encoding: 'utf8' }).trim();
  return out ? out.split(/\s+/)[0] : '';
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}

async function waitHealthy(timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${BASE}/api/health/integrations`, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) return;
    } catch { /* 重启中 */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('等待服务 ready 超时');
}

async function main(): Promise<void> {
  console.log(`目标服务: ${BASE}  项目根: ${PROJECT_ROOT}`);
  const pidBefore = serverPid();
  console.log(`重启前服务 PID: ${pidBefore || '(未检出)'}`);
  check('前置：检测到运行中的服务进程', Boolean(pidBefore), `pid=${pidBefore}`);

  // 1. 学生登录 + 建会话前置
  const token = await login(STUDENT);
  const cookie1 = await establishSession(token);
  console.log(`学生 ${token.user.email} cookie 已落地`);

  // 2. 重启前：作答一题（若池有余量）并记录 review 基线
  const q = await api('/api/quiz/questions?count=1', cookie1);
  const questions = q.body?.data?.questions ?? [];
  let answeredId: string | null = null;
  let baselineAnswer: string | null = null;
  if (questions.length > 0) {
    const first = questions[0] as { id: string; options?: Array<{ key?: string; id?: string }> };
    const optionKey = first.options?.[0]?.key ?? first.options?.[0]?.id ?? 'A';
    const ans = await api('/api/quiz/answer', cookie1, {
      method: 'POST',
      body: JSON.stringify({ questionId: first.id, answer: String(optionKey) }),
    });
    answeredId = first.id;
    baselineAnswer = ans.body?.data?.submittedAnswer ?? ans.body?.data?.submitted_answer ?? String(optionKey);
    check('重启前作答成功', ans.status === 200, `status=${ans.status}`);
  } else {
    console.log('SKIP 重启前作答：池已耗尽（沿用既有作答记录做重启复读断言）');
  }
  const reviewBefore = await api('/api/quiz/review', cookie1);
  const baselineRecords = (reviewBefore.body?.data?.records ?? []) as Array<Record<string, any>>;
  const baselineCount = baselineRecords.length;
  check('重启前 review 基线可读', reviewBefore.status === 200, `n=${baselineCount}`);

  // 3. 触发真实重启（touch 入口文件 → tsx watch 重启 → 新 PID）
  const touchFile = resolve(PROJECT_ROOT, 'src/server.ts');
  appendFileSync(touchFile, '\n');
  console.log(`已触发重启: touch ${touchFile}`);
  // 3.1 先轮询 PID 变化（健康检查可能抢在旧进程退出前恢复，导致误读旧 PID）
  const pidChangeDeadline = Date.now() + 60000;
  let pidAfter = '';
  while (Date.now() < pidChangeDeadline) {
    const current = serverPid();
    if (current && current !== pidBefore) { pidAfter = current; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  // 3.2 再等待服务真正 ready
  await waitHealthy();
  if (!pidAfter) { pidAfter = serverPid(); }
  console.log(`重启后服务 PID: ${pidAfter || '(未检出)'}`);
  check('服务进程真实重启（PID 变化）', Boolean(pidAfter) && pidAfter !== pidBefore, `before=${pidBefore} after=${pidAfter}`);

  // 4. 复读：同 cookie 重启后仍能读到作答记录（从数据库读取，非内存）
  const reviewAfter = await api('/api/quiz/review', cookie1);
  const afterRecords = (reviewAfter.body?.data?.records ?? []) as Array<Record<string, any>>;
  check('真实重启后同 cookie 复读作答记录', reviewAfter.status === 200 && afterRecords.length === baselineCount,
    `status=${reviewAfter.status} before_n=${baselineCount} after_n=${afterRecords.length}`);
  if (answeredId) {
    const target = afterRecords.find((r) => r.id === answeredId);
    check('重启后已作答题目记录保留（答案为首次提交值）',
      Boolean(target) && (baselineAnswer === null || target.submittedAnswer === baselineAnswer),
      target ? `submittedAnswer=${target.submittedAnswer}` : '记录丢失');
  }

  // 5. cookie 重建：重新登录拿新 cookie，仍能读到记录
  const token2 = await login(STUDENT);
  const cookie2 = await establishSession(token2);
  const reviewRebuilt = await api('/api/quiz/review', cookie2);
  const rebuiltRecords = (reviewRebuilt.body?.data?.records ?? []) as Array<Record<string, any>>;
  check('重新登录（新cookie）后作答记录仍可读', reviewRebuilt.status === 200 && rebuiltRecords.length === baselineCount,
    `status=${reviewRebuilt.status} n=${rebuiltRecords.length}`);

  // 6. 退出：logout 后原 cookie 失效
  const logoutResp = await fetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie2, 'Content-Type': 'application/json' },
  });
  check('登出接口可用', logoutResp.status === 200 || logoutResp.status === 204, `status=${logoutResp.status}`);
  const postLogout = await api('/api/quiz/review', cookie2);
  check('登出后原 cookie 访问受保护接口被拒（401）', postLogout.status === 401, `status=${postLogout.status}`);

  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
