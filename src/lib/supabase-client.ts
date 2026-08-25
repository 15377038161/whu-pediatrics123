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
