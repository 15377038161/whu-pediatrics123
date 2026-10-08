import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { submitAnswer } from '@/lib/quiz-pool';

/**
 * 学生作答判分（服务端判分，客户端不可伪造分数）：
 * 走受控 RPC quiz_submit_answer——归属校验（题目必须已分配本人）+ 幂等
 * （首次提交结果终局，重复提交返回首次记录，不覆盖不刷分）。
 * 作答后才返回 answer/explanation（首次提交前无法取答案）。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) {
      return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    }
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const body = (await request.json()) as { questionId?: string; answer?: string };
    if (!body.questionId || typeof body.answer !== 'string' || body.answer.trim().length === 0) {
      return fail({ code: 'INVALID_REQUEST', message: '参数不完整。', retryable: false }, undefined, 422);
    }
    const db = getSupabaseUserClient(user.accessToken);
    const result = await submitAnswer(db, body.questionId, body.answer);
    if (result.error === 'NOT_ASSIGNED') {
      return fail({ code: 'QUIZ_NOT_ASSIGNED', message: '该题目未分配给你，无法作答。', retryable: false }, undefined, 403);
    }
    if (result.error === 'NOT_FOUND') {
      return fail({ code: 'QUIZ_NOT_FOUND', message: '题目不存在。', retryable: false }, undefined, 404);
    }
    return ok(result);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500);
  }
}
