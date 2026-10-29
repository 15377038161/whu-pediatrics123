import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { isUuid } from '@/lib/question-bank';
import { listRubricItems } from '@/lib/skill-assessment';

export const dynamic = 'force-dynamic';


/**
 * 技能评分表（批次8）：GET /api/skills/:skillId/rubric
 * 学生/教师通用（requireAuth 不限角色）：返回该技能内置统一评分项
 * （rubric 为教学口径元数据，登录用户全员可读）。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ skillId: string }> }) {
  try {
    const user = await requireAuth(request);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    if (!isDatabaseConfigured()) {
      return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    }
    const { skillId } = await context.params;
    if (!isUuid(skillId)) {
      return fail({ code: 'INVALID_REQUEST', message: '技能编号无效。', retryable: false }, undefined, 400);
    }
    const db = getSupabaseUserClient(user.accessToken);
    const rubric = await listRubricItems(db, skillId);
    return ok({ rubric });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status =
      detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503
      : 500;
    return fail(detail, undefined, status);
  }
}
