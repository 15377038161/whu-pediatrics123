'use client';

/**
 * 统一鉴权请求层：所有需要登录态的客户端 → API 请求必须经 authedFetch。
 *
 * 契约（supabase-auth 技能 verify-session.md）：
 * - 前端在请求头携带 Authorization: Bearer <access_token>（token 从 SDK 会话实时获取，不缓存）；
 * - 平台网关在边界重命名为 x-sandbox-authorization，服务端只从该头读取并 getUser() 网络校验；
 * - 仅同源 API 调用（相对路径），token 不进入 URL/日志/第三方。
 *
 * 会话来源优先级：
 * 1. localStorage SDK 会话（真实 OAuth 登录）→ 附 Authorization 头；
 * 2. 无 SDK 会话（本地直连预览 / cookie 会话场景）→ 不附头，由服务端回退 cookie 校验。
 *    预览身份在网关域名下不可达（预览仅本地直连开放），不会出现误放行。
 *
 * 401 处理：服务端判定未登录（无有效身份）时清除本地会话并跳转登录页（不静默重试）。
 * 多标签一致性：localStorage 会话由 SDK 跨标签共享（storage 事件），此处不做额外缓存。
 */

import { getBrowserSupabase } from '@/lib/supabase-browser';

const LOGIN_PATH = '/';

export interface AuthedFetchResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
  status: number;
}

/** 带 code 的请求异常（页面可按 code 区分 FORBIDDEN / 503 等，而非仅 message）。 */
export class AuthedApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AuthedApiError';
    this.code = code;
  }
}

async function handleUnauthorized(): Promise<void> {
  // 会话无效/过期：清除本地会话（若残留），回登录页重新走 OAuth
  try {
    await getBrowserSupabase().auth.signOut({ scope: 'local' });
  } catch {
    // 清理失败不阻断跳转
  }
  if (window.location.pathname !== LOGIN_PATH) {
    window.location.assign(LOGIN_PATH);
  }
}

/** 当前 SDK 会话的 access token；无会话/未配置返回 null（回退 cookie 路径）。 */
async function currentAccessToken(): Promise<string | null> {
  try {
    const { data } = await getBrowserSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function applyAuthHeader(headers: Headers): Promise<void> {
  const token = await currentAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
}

/** 鉴权 fetch：附带当前会话 token（如有）；401 时清理会话并跳登录页。返回解析后的业务数据。 */
export async function authedFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  await applyAuthHeader(headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) {
    await handleUnauthorized();
    throw new AuthedApiError('AUTH_REQUIRED', '未登录或会话已过期。');
  }
  const result = (await response.json().catch(() => null)) as AuthedFetchResult<T> | null;
  if (!result) throw new AuthedApiError('INVALID_RESPONSE', `HTTP ${response.status}`);
  if (!result.ok) {
    throw new AuthedApiError(result.error?.code || 'API_ERROR', result.error?.message || `HTTP ${response.status}`);
  }
  return result.data as T;
}

/**
 * 鉴权 fetch（原始 Response）：用于二进制资源（图片/音频/视频/文档流）。
 * <img>/<audio> 等元素无法携带 Authorization 头（网关下 cookie 被剥离会 401），
 * 必须经此函数取回 blob 后用 objectURL 渲染。
 */
export async function authedFetchRaw(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  await applyAuthHeader(headers);
  const response = await fetch(url, { ...init, headers });
  if (response.status === 401) {
    await handleUnauthorized();
    throw new AuthedApiError('AUTH_REQUIRED', '未登录或会话已过期。');
  }
  if (!response.ok) {
    throw new AuthedApiError('HTTP_ERROR', `HTTP ${response.status}`);
  }
  return response;
}

/** 兼容既有组件的 api() 形态（返回 data 或抛错）。 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  return authedFetch<T>(url, init);
}
