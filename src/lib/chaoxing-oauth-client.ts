'use client';

/**
 * 超星 OAuth2.0 一键登录（平台官方契约）。
 * 端点：authorize-url / checklogin / exchange 全走平台代理（/v1/api/coder/proxy/），
 * 凭证只在服务端，前端只拿跳转地址与 session JSON。
 * session 落地：浏览器官方 SDK setSession（localStorage，SDK 自动刷新，多标签共享）；
 * 业务鉴权经 Authorization → x-sandbox-authorization 头通道（supabase-auth 技能 verify-session.md 契约），
 * 网关剥离 Cookie，服务端 httpOnly cookie 会话在网关域名下不可达（diag 实证）。
 * 契约来源：supabase-auth 技能 references/chaoxing-oauth.md / verify-session.md。
 */

const PROJECT_ID = process.env.NEXT_PUBLIC_CODER_PROJECTS_ID;
// 生产模式该变量不存在 → 空字符串 → 相对路径，由平台网关转发。
const AUTH_BASE = process.env.NEXT_PUBLIC_CODER_AUTH_PROXY_URL || '';

// 登录成功后的业务首页：学生/教师登录后由服务端页面各自重定向，此处统一回到根路径。
export const POST_LOGIN_HOME = '/';

const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
} as const;

export interface LoginResult {
  success: boolean;
  error?: string;
}

/**
 * 可见诊断阶段标志（用户可读、不含任何 URL/token/授权码）。
 * 供登录组件实时展示登录链路走到了哪一步，替代「按钮恢复但无提示」的盲区：
 * 浏览器点击后每个阶段直接可见，不依赖 sessionStorage 假定。
 */
export type LoginStage =
  | 'fetch-start'        // 发起 authorize-url 请求
  | 'fetch-network-error' // 网络层失败
  | 'fetch-http-error'   // 网关返回非 2xx
  | 'authorize-url-ok'   // 已拿到授权地址（仅状态，不显示地址）
  | 'authorize-url-invalid' // 返回内容不含有效授权地址
  | 'nav-assign';        // 即将执行顶层导航 window.location.assign

export const LOGIN_DIAG_VERSION = 'login-diag-20261010-a';

// 跳转拦截检测：assign 外部授权域前落标记；若页面随后重载回本站（导航被环境拦截），
// 组件读到标记后显示手动跳转链接兜底，而不是静默恢复按钮。
const NAV_ATTEMPT_KEY = 'cx_nav_attempt';

/** 读取并清除一次「跳转被拦截」标记（页面重载后由登录组件调用）。 */
export function consumeNavigationAttempt(): string | null {
  try {
    const url = sessionStorage.getItem(NAV_ATTEMPT_KEY);
    if (url) sessionStorage.removeItem(NAV_ATTEMPT_KEY);
    return url;
  } catch {
    return null;
  }
}

function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname;
  } catch {
    return false;
  }
}

/** 超星 OAuth2.0 一键登录：换取授权跳转地址后顶层导航（fetch 跟随跨域 302 会被 CORS 拦截）。 */
export async function loginWithChaoxingOAuth(
  onStage?: (stage: LoginStage, detail?: string) => void,
): Promise<LoginResult> {
  const redirectUri = window.location.href.split('#')[0];
  let res: Response;
  onStage?.('fetch-start');
  try {
    res = await fetch(
      `${AUTH_BASE}/v1/api/coder/proxy/auth/chaoxing-oauth/authorize-url?redirect_uri=${encodeURIComponent(redirectUri)}`,
      { headers: AUTH_HEADERS },
    );
  } catch {
    // fetch 网络层失败（网关不可达/断网）：显式报错，不静默恢复按钮。
    onStage?.('fetch-network-error');
    return { success: false, error: '网络异常，无法连接登录服务，请检查网络后重试' };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    onStage?.('fetch-http-error', `HTTP ${res.status}`);
    return { success: false, error: body.message || `获取授权地址失败 (${res.status})` };
  }
  let authorizeUrl: unknown;
  try {
    ({ authorizeUrl } = await res.json());
  } catch {
    onStage?.('authorize-url-invalid');
    return { success: false, error: '登录服务返回异常，请稍后重试' };
  }
  if (!isValidHttpUrl(authorizeUrl)) {
    // 空/畸形授权地址：window.location.assign 会静默重载当前页——必须显式报错。
    onStage?.('authorize-url-invalid');
    return { success: false, error: '登录服务未返回有效的授权地址，请稍后重试或联系管理员' };
  }
  onStage?.('authorize-url-ok');
  try {
    sessionStorage.setItem(NAV_ATTEMPT_KEY, authorizeUrl);
  } catch {
    // sessionStorage 不可用不影响主流程
  }
  onStage?.('nav-assign');
  window.location.assign(authorizeUrl);
  return { success: true };
}

// in-flight 去重（模块级）：一次性授权码的并发防线（StrictMode 双执行/多挂载点）。
let inflight: Promise<LoginResult> | null = null;

function cleanOAuthParamsFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('userinfo');
  window.history.replaceState({}, '', url.toString());
}

/** exchange 兑换：code（+可选 userinfo 密文）→ Supabase session → setSession → 清理 URL。 */
async function doExchange(code: string, userinfo?: string): Promise<LoginResult> {
  const res = await fetch(`${AUTH_BASE}/v1/api/coder/proxy/auth/chaoxing-oauth/exchange`, {
    method: 'POST',
    headers: AUTH_HEADERS,
    body: JSON.stringify({ code, projectId: PROJECT_ID, ...(userinfo ? { userinfo } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    cleanOAuthParamsFromUrl();
    return { success: false, error: body.message || '登录链接已失效，请重新登录' };
  }
  const session = (await res.json()) as { access_token: string; refresh_token: string };
  // session 落地：浏览器官方 SDK setSession（localStorage 持久化，SDK 自动刷新）。
  // 网关剥离 Cookie，服务端 httpOnly cookie 会话在网关域名下不可达；鉴权改走
  // Authorization → x-sandbox-authorization 头通道（authedFetch），此处不再 POST platform-session。
  const { getBrowserSupabase } = await import('@/lib/supabase-browser');
  const { error } = await getBrowserSupabase().auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) {
    cleanOAuthParamsFromUrl();
    return { success: false, error: '会话建立失败，请重新登录' };
  }
  cleanOAuthParamsFromUrl();
  return { success: true };
}

// ── checklogin 中转 ────────────────────────────────────────────
const CX_CODE_KEY = 'cx_oauth_code';
const CX_RELAY_KEY = 'cx_checklogin_relay';
const RELAY_WINDOW_MS = 5000;

/**
 * 入口页登录闭环编排（唯一公开入口）：code → 暂存 → checklogin 中转 → userinfo 回跳 → exchange。
 * 幂等：模块级 in-flight 去重；中转窗口内无 code/userinfo 的再入绝不兑换（防抢跑消费一次性 code）。
 */
export function handleOAuthLoginFlow(): Promise<LoginResult> {
  if (inflight) return inflight;
  inflight = doHandleOAuthLoginFlow().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doHandleOAuthLoginFlow(): Promise<LoginResult> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const userinfo = params.get('userinfo');
  const relayTs = Number(sessionStorage.getItem(CX_RELAY_KEY) || '0');
  const inRelayWindow = relayTs > 0 && Date.now() - relayTs < RELAY_WINDOW_MS;

  if (code && !inRelayWindow) {
    sessionStorage.setItem(CX_CODE_KEY, code);
    sessionStorage.setItem(CX_RELAY_KEY, String(Date.now()));
    cleanOAuthParamsFromUrl();
    try {
      const backurl = window.location.href.split('#')[0];
      const res = await fetch(
        `${AUTH_BASE}/v1/api/coder/proxy/auth/chaoxing-checklogin/url?backurl=${encodeURIComponent(backurl)}`,
        { headers: AUTH_HEADERS },
      );
      if (res.ok) {
        const { checkloginUrl } = (await res.json()) as { checkloginUrl: string };
        window.location.assign(checkloginUrl);
        return { success: false };
      }
      sessionStorage.removeItem(CX_RELAY_KEY);
    } catch {
      sessionStorage.removeItem(CX_RELAY_KEY);
    }
  }

  if (inRelayWindow && !code && !userinfo) {
    return { success: false };
  }

  const relayedUserinfo = userinfo ? userinfo.replace(/ /g, '+') : undefined;
  const pendingCode = sessionStorage.getItem(CX_CODE_KEY) || code;
  if (pendingCode) {
    try {
      return await doExchange(pendingCode, relayedUserinfo);
    } finally {
      sessionStorage.removeItem(CX_RELAY_KEY);
      sessionStorage.removeItem(CX_CODE_KEY);
      cleanOAuthParamsFromUrl();
    }
  }
  sessionStorage.removeItem(CX_RELAY_KEY);
  cleanOAuthParamsFromUrl();
  return { success: false };
}
