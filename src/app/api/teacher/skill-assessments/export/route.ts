import { NextRequest } from 'next/server';
import { errorFromUnknown, fail } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { buildSkillAssessmentCsv } from '@/lib/skill-assessment-csv';
import {
  failSkillAssessmentStatus,
  listTeacherAssessments,
  resolveSkillAssessmentTeacherContext,
} from '@/lib/skill-assessment';

export const dynamic = 'force-dynamic';

/**
 * 教师现场考核 CSV 导出。
 *
 * - 仅白名单教师可导出本人考核（RLS + 显式 teacher_id 过滤）；
 * - 不导出学生 UUID、clientEventId、教师备注等内部/自由文本字段；
 * - 学生姓名脱敏为首字 + **，避免导出文件脱离系统后直接暴露完整身份；
 * - 所有单元格按 CSV 规则转义，并对公式起始字符加单引号，防止表格公式注入。
 */
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await resolveSkillAssessmentTeacherContext(request);
    const [assessments, workspace] = await Promise.all([
      listTeacherAssessments(db, user.id),
      new AgentRepository(user).listTeacherStudents(),
    ]);
    const nameById = new Map(workspace.students.map((s) => [s.id, s.displayName] as [string, string]));

    const body = buildSkillAssessmentCsv(assessments.map((assessment) => ({
      studentName: nameById.get(assessment.studentId) ?? '未知学生',
      skillTitle: assessment.skillTitle,
      assessmentAt: assessment.assessmentAt,
      status: assessment.status,
      totalScore: assessment.totalScore,
      scoredCount: assessment.scoredCount,
      rubricItemCount: assessment.rubricItemCount,
      publishedAt: assessment.publishedAt,
      retakeOf: assessment.retakeOf,
    })));
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="skill-assessments-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failSkillAssessmentStatus(detail.code));
  }
}
