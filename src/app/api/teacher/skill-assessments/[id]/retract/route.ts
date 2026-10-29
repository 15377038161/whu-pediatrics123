import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { isUuid } from '@/lib/question-bank';
import {
  resolveSkillAssessmentTeacherContext,
  retractTeacherAssessment,
  failSkillAssessmentStatus,
} from '@/lib/skill-assessment';

export const dynamic = 'force-dynamic';


/**
 * 撤回发布（批次8）：POST /api/teacher/skill-assessments/:id/retract
 * published → draft（教师纠错机制；学生查询只返回 published，撤回后成绩即时对学生隐藏）。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await resolveSkillAssessmentTeacherContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) {
      return fail({ code: 'INVALID_REQUEST', message: '考核编号无效。', retryable: false }, undefined, 400);
    }
    await retractTeacherAssessment(db, user.id, id);
    return ok({ assessmentId: id, status: 'draft' });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failSkillAssessmentStatus(detail.code));
  }
}
