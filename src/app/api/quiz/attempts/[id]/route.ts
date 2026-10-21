import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { isUuid } from '@/lib/question-bank';
import { getQuizAttemptState } from '@/lib/quiz-attempt';

export const dynamic = 'force-dynamic';

/**
 * 学生批次详情（GET /api/quiz/attempts/:id）：
 * 经受控 RPC quiz_attempt_state——归属校验 + 版本快照投影：
 * 未作答题不含 answer/explanation；已作答题释放答案与解析（首次提交后释放规则）。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '批次编号无效。', retryable: false }, undefined, 400);
    const db = getSupabaseUserClient(user.accessToken);
    const attempt = await getQuizAttemptState(db, id);
    return ok({ attempt });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'NOT_FOUND' ? 404
      : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503
      : 500;
    return fail(detail, undefined, status);
  }
}
