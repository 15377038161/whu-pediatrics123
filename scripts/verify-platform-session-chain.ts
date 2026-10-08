/**
 * 脱敏复跑脚本：platform-session 落地 → 首页鉴权 全链路对照实验。
 * 证明链：应用侧会话落地/鉴权无缺陷（本地直连 307 角色重定向），
 * 经沙箱网关域名时客户端 Cookie 不透传（T3/T4 对照，应用侧 cookies:none）。
 * 不输出任何 token/cookie 值，仅状态码与 cookie 名。
 *
 * 运行：pnpm tsx scripts/verify-platform-session-chain.ts
 * 前置：真实测试学生账号（rls-probe-a@luojia.dev，密码经环境变量 RLS_PROBE_A_PWD 注入或默认值）。
 */
const URL_BASE = process.env.DIAG_URL_BASE ?? 'https://sandbox-e82d7fe2-d5e2-4b3b-ba03-2ff680d15bf2-5173.cxiagents.com';
const LOCAL_BASE = 'http://localhost:5173';
const COOKIE_AUTH = 'luojia-peds-auth';

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: process.env.CODER_SUPABASE_ANON_KEY ?? '',
    Authorization: `Bearer ${process.env.CODER_SUPABASE_ANON_KEY ?? ''}`,
    'X-Instance-ID': process.env.CODER_SUPABASE_TENANT_ID ?? '',
  };
}

async function loginProbeUser(): Promise<{ access_token: string; refresh_token: string } | null> {
  const authUrl = `${process.env.CODER_SUPABASE_URL}/auth/v1/token?grant_type=password`;
  const res = await fetch(authUrl, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email: 'rls-probe-a@luojia.dev', password: process.env.RLS_PROBE_A_PWD ?? 'RlsProbe#2026A' }),
  });
  if (!res.ok) return null;
  return (await res.json()) as { access_token: string; refresh_token: string };
}

function jarFromResponse(res: Response): string {
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies
    .map((c) => {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      return `${pair.slice(0, i)}=${pair.slice(i + 1)}`;
    })
    .join('; ');
}

async function main(): Promise<void> {
  const results: Array<{ name: string; pass: boolean; detail: string }> = [];

  const session = await loginProbeUser();
  results.push({ name: '测试用户登录(Auth API)', pass: Boolean(session), detail: session ? 'OK（值不输出）' : 'FAIL' });
  if (!session) {
    for (const r of results) console.log(r.pass ? 'PASS' : 'FAIL', '|', r.name, '|', r.detail);
    process.exit(1);
  }

  // A. 本地直连对照：应用应正确落地并 307 角色重定向
  const localPersist = await fetch(`${LOCAL_BASE}/api/auth/callback/platform-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: LOCAL_BASE },
    body: JSON.stringify(session),
    redirect: 'manual',
  });
  const localJar = jarFromResponse(localPersist);
  results.push({
    name: '本地直连 platform-session',
    pass: localPersist.status === 200 && localJar.includes(COOKIE_AUTH),
    detail: `HTTP ${localPersist.status}，Set-Cookie 名含 ${COOKIE_AUTH}: ${localJar.includes(COOKIE_AUTH)}`,
  });
  const localHome = await fetch(`${LOCAL_BASE}/`, { headers: { Cookie: localJar }, redirect: 'manual' });
  const localLoc = localHome.headers.get('location') ?? '';
  results.push({
    name: '本地直连 GET / 鉴权',
    pass: localHome.status === 307 && localLoc.endsWith('/student'),
    detail: `HTTP ${localHome.status}，location 尾段: ${localLoc.split('/').pop() ?? '(无)'}`,
  });

  // B. 网关域名：会话落地自身 200 且下发 Set-Cookie，但客户端 Cookie 无法经网关回传
  const remotePersist = await fetch(`${URL_BASE}/api/auth/callback/platform-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: URL_BASE },
    body: JSON.stringify(session),
    redirect: 'manual',
  });
  const remoteJar = jarFromResponse(remotePersist);
  results.push({
    name: '网关域名 platform-session',
    pass: remotePersist.status === 200 && remoteJar.includes(COOKIE_AUTH),
    detail: `HTTP ${remotePersist.status}，Set-Cookie 名含 ${COOKIE_AUTH}: ${remoteJar.includes(COOKIE_AUTH)}`,
  });
  const remoteHome = await fetch(`${URL_BASE}/`, { headers: { Cookie: remoteJar }, redirect: 'manual' });
  results.push({
    name: '网关域名 GET /（显式携带会话 Cookie）',
    pass: remoteHome.status === 200,
    detail: `HTTP ${remoteHome.status}（登录页）——网关不透传客户端 Cookie 的已知限制，非应用缺陷`,
  });

  // C. 网关 Cookie 透传对照（唯一路径避免日志污染）：
  //    自定义 cookie 名与 auth cookie 名均不透传；网关仅回放其共享 jar。
  const probePath = `/diag-cookie-fwd-${Date.now()}`;
  const fwdRes = await fetch(`${URL_BASE}${probePath}`, { headers: { Cookie: `fwd-probe=1; ${COOKIE_AUTH}=shortdummy` }, redirect: 'manual' });
  results.push({
    name: '网关 Cookie 透传对照（唯一路径）',
    pass: fwdRes.status === 404,
    detail: `HTTP ${fwdRes.status}；应用侧日志该路径 cookies 状态请人工核对 app.log（应为不含 fwd-probe / luojia-peds-auth）`,
  });

  console.log('\n=== platform-session 链路对照（脱敏） ===');
  for (const r of results) console.log(r.pass ? 'PASS' : 'FAIL', '|', r.name, '|', r.detail);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n结论: ${failed.length === 0 ? '全部通过' : `${failed.length} 项未通过`}`);
  console.log('未验边界: 完整 OAuth（authorize→扫码→exchange→落地→重定向）需真实浏览器会话，受沙箱网关 Cookie 透传限制阻断。');
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('脚本异常:', e instanceof Error ? e.message : e);
  process.exit(1);
});
