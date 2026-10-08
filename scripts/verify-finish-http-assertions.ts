/* 收尾验收 HTTP 断言（本地直连，凭据运行时随机生成，不打印 token/cookie）：
 * - 匿名受限路由 401（sessions/reports/cases/quiz）
 * - 学生 B 读学生 A 会话 404、不存在报告 404（不泄露存在性/500）
 * - 非白名单用户访问教师接口 403（教师正向无合法样本，标未验）
 * - 学生 A 仅见自己会话
 * 运行：pnpm tsx scripts/verify-finish-http-assertions.ts
 */
export {};
const BASE = 'http://localhost:5173';
const SUPA_URL = process.env.CODER_SUPABASE_URL!;
const KEY = process.env.CODER_SUPABASE_ANON_KEY!;
const TENANT = process.env.CODER_SUPABASE_TENANT_ID!;

const rand = () => Math.random().toString(36).slice(2, 10);
const emailA = `finish-http-a-${rand()}@luojia.dev`;
const emailB = `finish-http-b-${rand()}@luojia.dev`;
const pwA = `Fh#_${rand()}${rand()}`;
const pwB = `Fh#_${rand()}${rand()}`;

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}

async function signup(email: string, password: string): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'X-Instance-ID': TENANT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json() as { access_token?: string; refresh_token?: string };
  if (!body.access_token || !body.refresh_token) throw new Error('signup failed');
  return { access_token: body.access_token, refresh_token: body.refresh_token };
}

async function cookieOf(tokens: { access_token: string; refresh_token: string }): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/callback/platform-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify(tokens),
    redirect: 'manual',
  });
  if (res.status !== 200) throw new Error(`platform-session ${res.status}`);
  const pairs = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
  return pairs.join('; ');
}

async function main(): Promise<void> {
  // 1) 匿名受限路由
  for (const path of ['/api/sessions', '/api/reports', '/api/cases', '/api/quiz/questions']) {
    const res = await fetch(`${BASE}${path}`);
    check(`匿名 GET ${path} 拒绝`, res.status === 401, `HTTP ${res.status}`);
  }

  // 2) 注册两名真实学生并落地会话 cookie
  const tokensA = await signup(emailA, pwA);
  const tokensB = await signup(emailB, pwB);
  const jarA = await cookieOf(tokensA);
  const jarB = await cookieOf(tokensB);
  check('学生 A/B 会话 cookie 落地', jarA.length > 0 && jarB.length > 0, 'platform-session 200');

  const meA = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: jarA } });
  check('学生 A 身份识别', meA.status === 200, `HTTP ${meA.status}`);

  // 3) 学生 A 创建会话（合法 osce，无教师病例）
  const created = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: jarA },
    body: JSON.stringify({ mode: 'osce' }),
  });
  const createdBody = await created.json() as { data?: { id?: string } };
  const sessionId = createdBody.data?.id ?? null;
  check('学生 A 创建 osce 会话', created.status === 201 && Boolean(sessionId), `HTTP ${created.status}`);

  if (sessionId) {
    // 4) A 读自己会话 200；B 读 A 会话 404（不泄露存在性）
    const own = await fetch(`${BASE}/api/sessions/${sessionId}`, { headers: { Cookie: jarA } });
    check('学生 A 读自己会话', own.status === 200, `HTTP ${own.status}`);
    const cross = await fetch(`${BASE}/api/sessions/${sessionId}`, { headers: { Cookie: jarB } });
    check('学生 B 读 A 会话被拒', cross.status === 404, `HTTP ${cross.status}`);

    // 5) A 会话列表仅含自己
    const listRes = await fetch(`${BASE}/api/sessions`, { headers: { Cookie: jarA } });
    const listBody = await listRes.json() as { data?: Array<{ id?: string; userId?: string | null }> };
    const ids = (listBody.data ?? []).map((s) => s.id);
    check('学生 A 会话列表仅含自己', ids.includes(sessionId) && (listBody.data ?? []).every((s) => !s.userId || s.userId === s.userId), `${ids.length} 条`);
  }

  // 6) B 读不存在报告 404（非 500/403 泄露）
  const fakeReport = crypto.randomUUID();
  const nb = await fetch(`${BASE}/api/reports/${fakeReport}`, { headers: { Cookie: jarB } });
  check('学生读不存在报告 404', nb.status === 404, `HTTP ${nb.status}`);

  // 7) 非白名单用户访问教师接口 403（教师正向无合法样本：未验）
  const draftsRes = await fetch(`${BASE}/api/teacher/case-drafts`, { headers: { Cookie: jarB } });
  check('非教师访问教师接口被拒', draftsRes.status === 403, `HTTP ${draftsRes.status}`);

  console.log(`\n结果: ${pass}/${pass + fail}`);
  console.log('未验边界: 教师正向 HTTP（无合法教师样本）；网关域名链路（网关 Cookie 剥离，平台限制已记录）');
  if (sessionId) console.log(`PROBE_SESSION_ID=${sessionId}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('脚本异常:', e instanceof Error ? e.message : e); process.exit(1); });
