import type { User } from '@supabase/supabase-js';
import type { UserContext } from '@/domain/agent';
import { createReadOnlySupabaseClient } from '@/lib/supabase-ssr';
import { readPreviewUser } from '@/lib/preview-auth';

interface CookieReader {
  getAll(): Array<{ name: string; value: string }>;
  get(name: string): { name: string; value: string } | undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

function normalize(user: User): UserContext {
  const metadata = record(user.user_metadata);
  const appMetadata = record(user.app_metadata);
  const app = record(appMetadata.app);
  const chaoxing = record(appMetadata.chaoxing);
  return {
    id: user.id,
    role: text(app, 'role') === 'teacher' ? 'teacher' : 'student',
    displayName: text(metadata, 'full_name') || text(chaoxing, 'displayName') || '用户',
    studentNo: text(chaoxing, 'studentNo') || null,
    provider: 'chaoxing',
    chaoxingUid: text(chaoxing, 'uid') || null,
  };
}

export async function getCurrentUser(cookies: CookieReader): Promise<UserContext | null> {
  const preview = readPreviewUser(cookies);
  if (preview) return preview;
  try {
    const supabase = createReadOnlySupabaseClient(cookies);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return normalize(data.user);
  } catch {
    return null;
  }
}
