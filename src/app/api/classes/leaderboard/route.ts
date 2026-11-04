import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient } from '@/lib/supabase-client';
import { buildClassLeaderboard } from '@/lib/class-leaderboard';
import { ok } from '@/lib/api-result';
import { classManagementError } from '@/lib/class-management-error';

/** 班级积分榜：实际可见班级与成绩归属期间由 SECURITY DEFINER RPC 统一校验。 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user.accessToken) throw new Error('FORBIDDEN');
    const classId = request.nextUrl.searchParams.get('classId');
    if (!classId || !z.string().uuid().safeParse(classId).success) throw new Error('INVALID_INPUT');
    const { data, error } = await getSupabaseUserClient(user.accessToken).rpc('class_leaderboard_scores', { p_class_id: classId });
    if (error) throw error;
    return ok(buildClassLeaderboard(classId, data));
  } catch (error) {
    return classManagementError(error);
  }
}

export const dynamic = 'force-dynamic';
