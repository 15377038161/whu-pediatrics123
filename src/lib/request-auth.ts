import type { NextRequest } from 'next/server';
import type { AppRole, UserContext } from '@/domain/agent';
import { canAccessRole } from '@/lib/access-control';
import { getCurrentUser } from '@/lib/supabase-auth';

export async function requireUser(request: NextRequest, role?: AppRole): Promise<UserContext> {
  const user = await getCurrentUser(request.cookies);
  if (!user) throw new Error('AUTH_REQUIRED');
  if (role && !canAccessRole(user.role, role)) throw new Error('FORBIDDEN');
  return user;
}
