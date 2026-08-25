import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/api-result';
import { getCurrentUser } from '@/lib/supabase-auth';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request.cookies);
  return user ? ok({ user }) : fail({ code: 'AUTH_REQUIRED', message: '未登录或会话已过期。', retryable: false }, undefined, 401);
}
