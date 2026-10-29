import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { isUuid } from '@/lib/question-bank';
import {
  resolveSkillAssessmentTeacherContext,
  retakeTeacherAssessment,
  failSkillAssessmentStatus,
} from '@/lib/skill-assessment';

export const dynamic = 'force-dynamic';


/**
 * 补考（批次8）：POST /api/teacher/skill-assessments/:id/retake
 * 基于原考核创建新草稿记录（retake_of 关联原考核，历史保留可对比）；新记录需重新打分并发布。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await resolveSkillAssessmentTeacherContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) {
      return fail({ code: 'INVALID_REQUEST', message: '考核编号无效。', retryable: false }, undefined, 400);
    }
    const assessment = await retakeTeacherAssessment(db, user.id, id);
    return ok({ assessment }, undefined, 201);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failSkillAssessmentStatus(detail.code));
  }
}
