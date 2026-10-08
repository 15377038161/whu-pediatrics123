import type { NextRequest } from 'next/server';
import type { AppRole, UserContext } from '@/domain/agent';
import { canAccessRole } from '@/lib/access-control';
import { getCurrentAuth, getCurrentUser, type AuthContext } from '@/lib/supabase-auth';

export interface AuthedUserContext extends UserContext {
  /** 当前会话 JWT（预览身份为 null）；用于服务端以用户身份访问数据库（RLS 依 auth.uid() 判定） */
  accessToken: string | null;
}

export async function requireAuth(request: NextRequest, role?: AppRole): Promise<AuthedUserContext> {
  const auth = await getCurrentAuth(request.cookies);
  if (!auth) throw new Error('AUTH_REQUIRED');
  if (role && !canAccessRole(auth.user.role, role)) throw new Error('FORBIDDEN');
  return { ...auth.user, accessToken: auth.accessToken };
}

export async function requireUser(request: NextRequest, role?: AppRole): Promise<UserContext> {
  const user = await getCurrentUser(request.cookies);
  if (!user) throw new Error('AUTH_REQUIRED');
  if (role && !canAccessRole(user.role, role)) throw new Error('FORBIDDEN');
  return user;
}

export type { AuthContext };
