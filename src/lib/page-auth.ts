import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AppRole, UserContext } from '@/domain/agent';
import { canAccessRole } from '@/lib/access-control';
import { getCurrentUser } from '@/lib/supabase-auth';

const currentPageUser = cache(async () => getCurrentUser(await cookies()));

export async function requirePageUser(role?: AppRole): Promise<UserContext> {
  const user = await currentPageUser();
  if (!user) redirect('/');
  if (role && !canAccessRole(user.role, role)) redirect(user.role === 'teacher' ? '/teacher' : '/student');
  return user;
}
