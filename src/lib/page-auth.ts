import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AppRole } from '@/domain/agent';
import { canAccessRole } from '@/lib/access-control';
import { getCurrentAuth } from '@/lib/supabase-auth';
import type { AuthedUserContext } from '@/lib/request-auth';

const currentPageAuth = cache(async () => getCurrentAuth(await cookies()));

/**
 * 服务端页面身份（含会话 JWT）：
 * JWT 用于 AgentRepository 以用户身份访问数据库，RLS 依 auth.uid() 判定行级权限；
 * 预览身份 accessToken 为 null，AgentRepository 走内存分支。
 */
export async function requirePageUser(role?: AppRole): Promise<AuthedUserContext> {
  const auth = await currentPageAuth();
  if (!auth) redirect('/');
  const user = { ...auth.user, accessToken: auth.accessToken };
  if (role && !canAccessRole(user.role, role)) redirect(user.role === 'teacher' ? '/teacher' : '/student');
  return user;
}
