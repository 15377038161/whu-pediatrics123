import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { reviewMine, getPoolStatus } from '@/lib/quiz-pool';

/**
 * GET：学生错题复盘（quiz_review_mine）——仅本人作答记录；
 * answer/explanation 仅已作答题返回（首次提交前不可取答案）。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) {
      return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    }
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const db = getSupabaseUserClient(user.accessToken);
    const records = await reviewMine(db);
    return ok({ records });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500);
  }
}

/**
 * POST：教师查看题池状态（RLS app_is_teacher 放行直读可用题目分布）。
 * 本轮不实现 AI 扩容：生成题未经教师审核不得当权威考试真题，保持既有 43 题闭环。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'teacher');
    if (!isDatabaseConfigured()) {
      return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    }
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const status = await getPoolStatus(user.accessToken);
    return ok(status);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500);
  }
}
