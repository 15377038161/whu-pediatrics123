import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { isUuid } from '@/lib/question-bank';
import {
  resolveSkillAssessmentTeacherContext,
  updateSkillAssessmentSchema,
  getTeacherAssessment,
  updateTeacherAssessmentScores,
  failSkillAssessmentStatus,
} from '@/lib/skill-assessment';

export const dynamic = 'force-dynamic';


/**
 * 教师现场考核单项 API（批次8）：
 * - GET   /api/teacher/skill-assessments/:id   详情（rubric + 逐项明细 + 学生姓名；RLS 限定本人）
 * - PATCH /api/teacher/skill-assessments/:id   保存草稿明细（整体替换；仅 draft 可改）
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await resolveSkillAssessmentTeacherContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) {
      return fail({ code: 'INVALID_REQUEST', message: '考核编号无效。', retryable: false }, undefined, 400);
    }
    const detail = await getTeacherAssessment(db, user.id, id);
    if (!detail) {
      return fail(
        { code: 'ASSESSMENT_NOT_FOUND', message: '未找到该考核记录（或不在你的管理范围内）。', retryable: false },
        undefined,
        404,
      );
    }
    const workspace = await new AgentRepository(user).listTeacherStudents();
    const studentName = workspace.students.find((s) => s.id === detail.studentId)?.displayName ?? '未知学生';
    return ok({ assessment: { ...detail, studentName } });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failSkillAssessmentStatus(detail.code));
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await resolveSkillAssessmentTeacherContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) {
      return fail({ code: 'INVALID_REQUEST', message: '考核编号无效。', retryable: false }, undefined, 400);
    }
    const body = await request.json().catch(() => null);
    const parsed = updateSkillAssessmentSchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '请求参数无效。', retryable: false }, undefined, 400);
    }
    await updateTeacherAssessmentScores(db, user.id, id, parsed.data);
    const detail = await getTeacherAssessment(db, user.id, id);
    if (!detail) {
      return fail(
        { code: 'ASSESSMENT_NOT_FOUND', message: '未找到该考核记录（或不在你的管理范围内）。', retryable: false },
        undefined,
        404,
      );
    }
    return ok({ assessment: detail });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failSkillAssessmentStatus(detail.code));
  }
}
