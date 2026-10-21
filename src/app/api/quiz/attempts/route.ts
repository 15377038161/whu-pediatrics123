import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { isUuid } from '@/lib/question-bank';
import { startQuizAttempt } from '@/lib/quiz-attempt';

export const dynamic = 'force-dynamic';

/**
 * 学生题库练习 API：
 * - GET  /api/quiz/attempts          本人题库批次列表（统一报告列表数据源）
 * - POST /api/quiz/attempts          开始/续作练习批次（fresh=true 时旧进行中批次记 abandoned 后新建）
 * 全部经 SECURITY DEFINER 受控 RPC：可见性（platform/本人所在 owner 班级）、
 * 同一题集最多一个进行中批次、作答前不返回答案，均由 RPC 强制。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const db = getSupabaseUserClient(user.accessToken);
    const { listMyQuizAttempts } = await import('@/lib/quiz-attempt');
    return ok({ attempts: await listMyQuizAttempts(db) });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const body = await request.json().catch(() => null);
    const bankId = typeof (body as { bankId?: unknown } | null)?.bankId === 'string' ? (body as { bankId: string }).bankId : '';
    const fresh = (body as { fresh?: unknown } | null)?.fresh === true;
    if (!isUuid(bankId)) return fail({ code: 'INVALID_REQUEST', message: '题集编号无效。', retryable: false }, undefined, 400);
    const db = getSupabaseUserClient(user.accessToken);
    const attempt = await startQuizAttempt(db, bankId, fresh);
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
