import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

/**
 * 平台凭证优先级：CODER_*（平台沙箱/部署注入）> COZE_*（本地 .env 兼容别名）。
 * 禁止手工 env 桥接；沙箱内进程自动继承 CODER_* 注入。
 */
function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(envValue('CODER_SUPABASE_URL', 'COZE_SUPABASE_URL') && envValue('CODER_SUPABASE_ANON_KEY', 'COZE_SUPABASE_ANON_KEY'));
}

export function getSupabaseCredentials(): SupabaseCredentials {
  const url = envValue('CODER_SUPABASE_URL', 'COZE_SUPABASE_URL');
  const anonKey = envValue('CODER_SUPABASE_ANON_KEY', 'COZE_SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new Error('DATABASE_NOT_CONFIGURED');
  return { url, anonKey };
}

function createSupabaseClient(key: string, token?: string): SupabaseClient {
  const { url } = getSupabaseCredentials();
  const headers: Record<string, string> = {};
  const tenantId = envValue('CODER_SUPABASE_TENANT_ID', 'COZE_SUPABASE_TENANT_ID');
  if (tenantId) headers['X-Instance-ID'] = tenantId;
  if (token) headers.Authorization = `Bearer ${token}`;
  return createClient(url, key, {
    global: { headers },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getSupabaseCredentialsClient(): SupabaseClient {
  // 公开数据只读客户端：anon key + X-Instance-ID 租户头，仅用于公开表（RLS 允许 anon SELECT 的表）
  const { anonKey } = getSupabaseCredentials();
  return createSupabaseClient(anonKey);
}

export function getSupabaseUserClient(accessToken: string): SupabaseClient {
  // 用户身份客户端：anon key + 用户 JWT，RLS 按 auth.uid() 判定行级权限。
  // token 来自请求头 x-sandbox-authorization（平台 Nginx 已重命名 Authorization）。
  const { anonKey } = getSupabaseCredentials();
  return createSupabaseClient(anonKey, accessToken);
}

interface DatabaseRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

const DEFAULT_RETRY = { maxAttempts: 3, baseDelayMs: 300 };

export function isRetryableDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (/fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|terminated|aborted/i.test(error.message)) return true;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && status >= 500 && status !== 501;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDatabaseRetry<T>(operation: () => Promise<T>, options?: DatabaseRetryOptions): Promise<T> {
  const { maxAttempts, baseDelayMs } = { ...DEFAULT_RETRY, ...options };
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableDatabaseError(error)) throw error;
      await delay(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
