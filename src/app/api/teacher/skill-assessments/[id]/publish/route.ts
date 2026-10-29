import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { isUuid } from '@/lib/question-bank';
import {
  resolveSkillAssessmentTeacherContext,
  publishTeacherAssessment,
  failSkillAssessmentStatus,
} from '@/lib/skill-assessment';

export const dynamic = 'force-dynamic';


/**
 * 发布现场考核（批次8）：POST /api/teacher/skill-assessments/:id/publish
 * 受控 RPC（skill_assessment_publish）校验本人/草稿/明细合法/至少 1 项计分并原子固化总分；
 * 发布后学生方可查看成绩。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await resolveSkillAssessmentTeacherContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) {
      return fail({ code: 'INVALID_REQUEST', message: '考核编号无效。', retryable: false }, undefined, 400);
    }
    const result = await publishTeacherAssessment(db, user.id, id);
    return ok({ assessmentId: id, totalScore: result.totalScore });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failSkillAssessmentStatus(detail.code));
  }
}
