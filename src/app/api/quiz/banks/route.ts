import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { listVisibleQuizBanks } from '@/lib/quiz-attempt';

export const dynamic = 'force-dynamic';

/**
 * 学生可见题集列表（GET /api/quiz/banks）：
 * 经受控 RPC quiz_bank_list_student——仅已发布题集（platform 或本人所在 owner 班级），
 * 含本人练习概览（完成次数/最佳正确率/进行中批次）；题集标题经 RPC 投影返回，
 * 学生不可直读题集表。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const db = getSupabaseUserClient(user.accessToken);
    return ok({ banks: await listVisibleQuizBanks(db) });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500);
  }
}
