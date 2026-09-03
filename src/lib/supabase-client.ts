import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface SupabaseCredentials {
  url: string;
  anonKey: string;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.COZE_SUPABASE_URL?.trim() && process.env.COZE_SUPABASE_ANON_KEY?.trim());
}

export function getSupabaseCredentials(): SupabaseCredentials {
  const url = process.env.COZE_SUPABASE_URL?.trim();
  const anonKey = process.env.COZE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) throw new Error('DATABASE_NOT_CONFIGURED');
  return { url, anonKey };
}

function createSupabaseClient(key: string, token?: string): SupabaseClient {
  const { url } = getSupabaseCredentials();
  return createClient(url, key, {
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getSupabaseAdminClient(): SupabaseClient {
  const key = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error('DATABASE_NOT_CONFIGURED');
  return createSupabaseClient(key);
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
