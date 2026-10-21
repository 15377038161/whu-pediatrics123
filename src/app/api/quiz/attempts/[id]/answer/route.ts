import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { isUuid } from '@/lib/question-bank';
import { submitQuizAttemptAnswer } from '@/lib/quiz-attempt';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const answerSchema = z.object({
  itemId: z.string().uuid(),
  answer: z.string().trim().min(1).max(200),
}).strict();

/**
 * 学生批次作答（POST /api/quiz/attempts/:id/answer）：
 * 经受控 RPC quiz_attempt_answer——归属校验 + 服务端判分 + 幂等（首次提交终局），
 * 全部作答完成时原子迁移批次状态；答案与解析仅作答后返回。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '批次编号无效。', retryable: false }, undefined, 400);
    const body = await request.json().catch(() => null);
    const parsed = answerSchema.safeParse(body);
    if (!parsed.success) return fail({ code: 'INVALID_REQUEST', message: '作答参数无效。', retryable: false }, undefined, 400);
    const db = getSupabaseUserClient(user.accessToken);
    const result = await submitQuizAttemptAnswer(db, id, parsed.data.itemId, parsed.data.answer);
    return ok(result);
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'NOT_FOUND' || detail.code === 'ITEM_NOT_FOUND' ? 404
      : detail.code === 'ATTEMPT_CLOSED' ? 409
      : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503
      : 500;
    return fail(detail, undefined, status);
  }
}
