'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 浏览器端 Supabase 客户端（官方 supabase-auth 技能模板模式）。
 *
 * 会话策略（网关 Cookie 剥离限制下的官方支持路径）：
 * - session 持久化在 localStorage（persistSession），由 SDK 自动刷新（autoRefreshToken）；
 * - 业务请求经 authedFetch（src/lib/authed-api.ts）附带 Authorization: Bearer <access_token>；
 *   平台网关在边界将其重命名为 x-sandbox-authorization，服务端只从该头读取并做 getUser() 网络校验；
 * - token 只进请求头（同源 API），绝不进入 URL / localStorage 以外的存储 / 日志 / 截图。
 *
 * 凭证来源：NEXT_PUBLIC_CODER_SUPABASE_*（平台注入进程环境，Next.js 内联进浏览器 bundle）。
 * 与服务端 supabase-client.ts 共享同一 Supabase 节点与租户（X-Instance-ID）。
 */

let browserClient: SupabaseClient | null = null;

function requireEnv(): { url: string; anonKey: string; tenantId: string | null } {
  const url = process.env.NEXT_PUBLIC_CODER_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_CODER_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('BROWSER_SUPABASE_NOT_CONFIGURED');
  }
  const tenantId = process.env.NEXT_PUBLIC_CODER_SUPABASE_TENANT_ID || null;
  return { url, anonKey, tenantId };
}

export function isBrowserSupabaseConfigured(): boolean {
  try {
    requireEnv();
    return true;
  } catch {
    return false;
  }
}

export function getBrowserSupabase(): SupabaseClient {
  if (browserClient) return browserClient;
  const { url, anonKey, tenantId } = requireEnv();
  browserClient = createClient(url, anonKey, {
    global: { headers: tenantId ? { 'X-Instance-ID': tenantId } : {} },
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'luojia-peds-auth' },
  });
  return browserClient;
}

/** 当前会话（localStorage，SDK 管理）；无会话返回 null。 */
export async function getBrowserSession(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const { data } = await getBrowserSupabase().auth.getSession();
  const session = data.session;
  if (!session?.access_token) return null;
  return { accessToken: session.access_token, refreshToken: session.refresh_token };
}

/** 退出登录：本地会话清除 + 服务端全局吊销（SDK 携带 token 调 Auth API）。 */
export async function signOutBrowserSession(): Promise<void> {
  await getBrowserSupabase().auth.signOut({ scope: 'global' });
}
