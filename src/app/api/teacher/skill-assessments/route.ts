import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import {
  resolveSkillAssessmentTeacherContext,
  createSkillAssessmentSchema,
  listTeacherAssessments,
  createTeacherAssessment,
  failSkillAssessmentStatus,
} from '@/lib/skill-assessment';

export const dynamic = 'force-dynamic';


/**
 * 教师现场考核列表/创建 API（批次8）：
 * - GET  /api/teacher/skill-assessments   本人考核列表（RLS；学生姓名合并自班级清单）
 * - POST /api/teacher/skill-assessments   新建考核草稿（学生必须属于本班）
 * 发布/撤回/补考见 [id] 子路由；行级权限全部由 RLS 保证。
 */
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await resolveSkillAssessmentTeacherContext(request);
    const [assessments, workspace] = await Promise.all([
      listTeacherAssessments(db, user.id),
      new AgentRepository(user).listTeacherStudents(),
    ]);
    const nameById = new Map(workspace.students.map((s) => [s.id, s.displayName] as [string, string]));
    return ok({
      assessments: assessments.map((a) => ({
        ...a,
        studentName: nameById.get(a.studentId) ?? '未知学生',
      })),
    });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failSkillAssessmentStatus(detail.code));
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, db } = await resolveSkillAssessmentTeacherContext(request);
    const body = await request.json().catch(() => null);
    const parsed = createSkillAssessmentSchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '请求参数无效。', retryable: false }, undefined, 400);
    }
    const workspace = await new AgentRepository(user).listTeacherStudents();
    if (!workspace.students.some((s) => s.id === parsed.data.studentId)) {
      return fail(
        { code: 'ASSESSMENT_STUDENT_FORBIDDEN', message: '只能对班级内学生创建现场考核。', retryable: false },
        undefined,
        403,
      );
    }
    const assessment = await createTeacherAssessment(db, user.id, parsed.data);
    return ok({ assessment }, undefined, 201);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failSkillAssessmentStatus(detail.code));
  }
}
