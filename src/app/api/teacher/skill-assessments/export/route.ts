import { NextRequest } from 'next/server';
import { errorFromUnknown, fail } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { buildSkillAssessmentCsv } from '@/lib/skill-assessment-csv';
import { buildSkillAssessmentSheets } from '@/lib/skill-assessment-xlsx';
import { XLSX_CONTENT_TYPE, contentDisposition, writeXlsx } from '@/lib/xlsx-writer';
import {
  failSkillAssessmentStatus,
  listTeacherAssessments,
  resolveSkillAssessmentTeacherContext,
} from '@/lib/skill-assessment';

export const dynamic = 'force-dynamic';

/**
 * 教师现场考核导出（默认 .xlsx，?format=csv 为次选）。
 *
 * - 仅白名单教师可导出本人考核（RLS + 显式 teacher_id 过滤）；
 * - 不导出学生 UUID、clientEventId、教师备注等内部/自由文本字段；
 * - 学生姓名脱敏为首字 + **，避免导出文件脱离系统后直接暴露完整身份；
 * - CSV 侧按规则转义并对公式起始字符加单引号；xlsx 侧一律写字面字符串、不写公式，
 *   结构上不可能被表格软件执行，同时总分保持数字类型可直接统计。
 */
export async function GET(request: NextRequest) {
  try {
    const { user, db } = await resolveSkillAssessmentTeacherContext(request);
    const [assessments, workspace] = await Promise.all([
      listTeacherAssessments(db, user.id),
      new AgentRepository(user).listTeacherStudents(),
    ]);
    const nameById = new Map(workspace.students.map((s) => [s.id, s.displayName] as [string, string]));

    const rows = assessments.map((assessment) => ({
      studentName: nameById.get(assessment.studentId) ?? '未知学生',
      skillTitle: assessment.skillTitle,
      assessmentAt: assessment.assessmentAt,
      status: assessment.status,
      totalScore: assessment.totalScore,
      scoredCount: assessment.scoredCount,
      rubricItemCount: assessment.rubricItemCount,
      publishedAt: assessment.publishedAt,
      retakeOf: assessment.retakeOf,
    }));
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (request.nextUrl.searchParams.get('format') === 'csv') {
      return new Response(buildSkillAssessmentCsv(rows), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="skill-assessments-${stamp}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return new Response(await writeXlsx(buildSkillAssessmentSheets(rows)), {
      status: 200,
      headers: {
        'Content-Type': XLSX_CONTENT_TYPE,
        'Content-Disposition': contentDisposition(`现场考核_${stamp}.xlsx`, `skill-assessments-${stamp}.xlsx`),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failSkillAssessmentStatus(detail.code));
  }
}
