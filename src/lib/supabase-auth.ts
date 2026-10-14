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
  // 平台代理超星 OAuth（supabase-auth 技能 chaoxing-oauth.md/chaoxing-login.md 契约）：
  // 姓名（realname）与超星号（cxid）随 user_metadata 首建落库，与本地超星身份
  //（app_metadata.chaoxing.*，应用自带 OAuth 路径）双链兼容；缺失字段按技能约定做空值兜底。
  const cxid = text(metadata, 'cxid');
  const realname = text(metadata, 'realname');
  const chaoxingUid = uid || cxid;
  const hasProviderIdentity = Boolean(fid || uid || providerRoles.length);
  const teacherAllowed = hasProviderIdentity
    ? isTeacherIdentityAllowed({ fid, uid, role: providerRoles })
    : text(app, 'role') === 'teacher';
  const role = teacherAllowed ? 'teacher' : 'student';
  return {
    id: user.id,
    role,
    displayName: text(metadata, 'full_name')
      || text(chaoxing, 'displayName')
      || realname
      || (cxid ? `超星用户 ${cxid}` : '')
      || '用户',
    avatarUrl: text(metadata, 'avatar_url')
      || text(chaoxing, 'avatar')
      || (chaoxingUid ? `https://photo.chaoxing.com/p/${encodeURIComponent(chaoxingUid)}_80` : null),
    studentNo: text(chaoxing, 'studentNo') || cxid || null,
    provider: 'chaoxing',
    chaoxingUid: chaoxingUid || null,
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

/**
 * 校验 Authorization（经网关重命名为 x-sandbox-authorization）头携带的真实用户 token。
 * 官方契约（supabase-auth 技能 verify-session.md）：载荷为用户真实 Supabase access_token，
 * 必须 getUser(token) 网络校验（禁止仅解码信任/自签）。无效/过期返回 null。
 */
export async function verifyHeaderToken(accessToken: string): Promise<AuthContext | null> {
  try {
    const { getSupabaseCredentialsClient } = await import('@/lib/supabase-client');
    const { data, error } = await getSupabaseCredentialsClient().auth.getUser(accessToken);
    if (error || !data.user) return null;
    return { user: normalizeSupabaseUser(data.user), accessToken };
  } catch {
    return null;
  }
}

/** 从请求头解析 Bearer token（x-sandbox-authorization 优先；authorization 备用容错）。 */
export function readBearerToken(request: Request): string | null {
  for (const name of ['x-sandbox-authorization', 'authorization']) {
    const value = request.headers.get(name);
    if (value) {
      const token = value.replace(/^Bearer\s+/i, '').trim();
      if (token) return token;
    }
  }
  return null;
}

export interface AuthContext {
  user: UserContext;
  /** 当前会话的 Supabase access token（JWT）。预览身份无 token，为 null。 */
  accessToken: string | null;
}

/**
 * 获取认证上下文（用户身份 + 会话 JWT）。
 * JWT 用于服务端以用户身份访问数据库（getSupabaseUserClient），行级权限由 RLS 依 auth.uid() 判定。
 */
export async function getCurrentAuth(cookies: CookieReader): Promise<AuthContext | null> {
  const preview = readPreviewUser(cookies);
  if (preview) return { user: preview, accessToken: null };
  try {
    const supabase = createReadOnlySupabaseClient(cookies);
    // tokens-only cookie 模式：session.user 不在 cookie 存储中（服务端访问会抛错），
    // 必须用 getUser(access_token) 网络验证并取回完整用户身份。
    const sessionResult = await supabase.auth.getSession();
    if (sessionResult.error || !sessionResult.data.session) return null;
    const accessToken = sessionResult.data.session.access_token;
    const userResult = await supabase.auth.getUser(accessToken);
    if (userResult.error || !userResult.data.user) return null;
    return { user: normalizeSupabaseUser(userResult.data.user), accessToken };
  } catch {
    return null;
  }
}
