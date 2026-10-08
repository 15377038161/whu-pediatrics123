import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { fetchQuestions } from '@/lib/quiz-pool';

/**
 * 学生取题（随机分发 + 去重）：
 * 走受控 RPC quiz_fetch_questions——登录校验、随机分发未分配题目、
 * 自动写入本人 quiz_assignments（复合主键去重）、返回投影（id/case_id/stem/options/difficulty），
 * 不含 answer/explanation（答案列对学生不可见，作答后由判分 RPC 返回）。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) {
      return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    }
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const db = getSupabaseUserClient(user.accessToken);
    const count = Math.min(Math.max(Number(new URL(request.url).searchParams.get('count') ?? 5), 1), 20);
    const questions = await fetchQuestions(db, count);
    if (questions.length === 0) {
      // 池耗尽（本人已取完全部可用题目）
      return ok({ questions, poolExhausted: true });
    }
    return ok({ questions, poolExhausted: false });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500);
  }
}
