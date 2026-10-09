import type { NextRequest } from 'next/server';
import type { AppRole, UserContext } from '@/domain/agent';
import { canAccessRole } from '@/lib/access-control';
import {
  getCurrentAuth,
  getCurrentUser,
  readBearerToken,
  verifyHeaderToken,
  type AuthContext,
} from '@/lib/supabase-auth';

export interface AuthedUserContext extends UserContext {
  /** 当前会话 JWT（预览身份为 null）；用于服务端以用户身份访问数据库（RLS 依 auth.uid() 判定） */
  accessToken: string | null;
}

/**
 * 统一鉴权（官方契约：supabase-auth 技能 verify-session.md）：
 *
 * 通道优先级与安全规则：
 * 1. 请求头携带 Bearer token（浏览器发 Authorization，网关边界重命名为 x-sandbox-authorization）：
 *    - token 必须经 getUser() 网络校验（真实 Supabase access_token；禁止仅解码信任/自签）；
 *    - 校验失败（无效/过期）一律 401，绝不静默回退 cookie（防降级）；
 *    - cookie 会话（非预览）若同时存在且身份不同 → 403 IDENTITY_CONFLICT（拒绝而非择一）；
 *    - 预览 cookie 在正式 header 身份存在时忽略（正式身份优先）。
 * 2. 无头时回退 cookie 会话（本地直连 SSR 页面/预览模式的既有路径）。
 */
async function resolveAuth(request: NextRequest): Promise<AuthContext | null> {
  const headerToken = readBearerToken(request);
  if (headerToken) {
    const headerAuth = await verifyHeaderToken(headerToken);
    if (!headerAuth) return null;
    const cookieAuth = await getCurrentAuth(request.cookies);
    const cookieIsPreview = Boolean(request.cookies.get('luojia_preview_role')?.value);
    if (cookieAuth && !cookieIsPreview && cookieAuth.user.id !== headerAuth.user.id) {
      throw new Error('IDENTITY_CONFLICT');
    }
    return headerAuth;
  }
  return getCurrentAuth(request.cookies);
}

export async function requireAuth(request: NextRequest, role?: AppRole): Promise<AuthedUserContext> {
  const auth = await resolveAuth(request);
  if (!auth) throw new Error('AUTH_REQUIRED');
  if (role && !canAccessRole(auth.user.role, role)) throw new Error('FORBIDDEN');
  return { ...auth.user, accessToken: auth.accessToken };
}

export async function requireUser(request: NextRequest, role?: AppRole): Promise<UserContext> {
  const headerToken = readBearerToken(request);
  if (headerToken) {
    const headerAuth = await verifyHeaderToken(headerToken);
    if (!headerAuth) throw new Error('AUTH_REQUIRED');
    if (role && !canAccessRole(headerAuth.user.role, role)) throw new Error('FORBIDDEN');
    return headerAuth.user;
  }
  const user = await getCurrentUser(request.cookies);
  if (!user) throw new Error('AUTH_REQUIRED');
  if (role && !canAccessRole(user.role, role)) throw new Error('FORBIDDEN');
  return user;
}

export type { AuthContext };
