import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { listStudentAssessments } from '@/lib/skill-assessment';

export const dynamic = 'force-dynamic';


/**
 * 学生现场考核成绩（批次8）：GET /api/skill-assessments
 * 本人已发布考核 + 逐项明细（skill_assessments_student 受控 RPC，成绩仅本人可见）。
 * 边界：现场考核成绩独立于训练报告与模拟参考评分，仅教学记录展示。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    if (!isDatabaseConfigured()) {
      return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    }
    const db = getSupabaseUserClient(user.accessToken);
    const assessments = await listStudentAssessments(db);
    return ok({ assessments });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status =
      detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'DATABASE_NOT_CONFIGURED' || detail.code === 'RPC_UNAVAILABLE' ? 503
      : 500;
    return fail(detail, undefined, status);
  }
}
