import type { User } from '@supabase/supabase-js';
import type { UserContext } from '@/domain/agent';
import { isTeacherIdentityAllowed } from '@/lib/access-control';
import type { ChaoxingRole } from '@/lib/chaoxing-client';
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

function roles(value: unknown): ChaoxingRole[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ChaoxingRole[] => {
    const role = record(entry);
    const roleId = text(role, 'roleId');
    const roleName = text(role, 'roleName');
    return roleId || roleName ? [{ roleId, roleName }] : [];
  });
}

export function normalizeSupabaseUser(user: User): UserContext {
  const metadata = record(user.user_metadata);
  const appMetadata = record(user.app_metadata);
  const app = record(appMetadata.app);
  const chaoxing = record(appMetadata.chaoxing);
  const fid = text(chaoxing, 'fid');
  const uid = text(chaoxing, 'uid');
  const providerRoles = roles(chaoxing.role);
  const hasProviderIdentity = Boolean(fid || uid || providerRoles.length);
  const teacherAllowed = hasProviderIdentity
    ? isTeacherIdentityAllowed({ fid, uid, role: providerRoles })
    : text(app, 'role') === 'teacher';
  const role = teacherAllowed ? 'teacher' : 'student';
  return {
    id: user.id,
    role,
    displayName: text(metadata, 'full_name') || text(chaoxing, 'displayName') || '用户',
    avatarUrl: text(metadata, 'avatar_url') || null,
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
    return normalizeSupabaseUser(data.user);
  } catch {
    return null;
  }
}
