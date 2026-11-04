import { NextRequest } from 'next/server';
import { errorFromUnknown, fail } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
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
const CSV_HEADERS = [
  '学生（脱敏）',
  '技能',
  '考核时间',
  '状态',
  '总分',
  '已评分项',
  '评分项总数',
  '发布时间',
  '是否补考',
] as const;

/** 防 CSV 公式注入：表格软件会执行以 = + - @ 或控制字符开头的单元格。 */
function csvCell(value: string | number | null): string {
  const raw = value === null ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function maskStudentName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '未知学生';
  return `${Array.from(trimmed)[0]}**`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function GET(request: NextRequest) {
  try {
    const { user, db } = await resolveSkillAssessmentTeacherContext(request);
    const [assessments, workspace] = await Promise.all([
      listTeacherAssessments(db, user.id),
      new AgentRepository(user).listTeacherStudents(),
    ]);
    const nameById = new Map(workspace.students.map((s) => [s.id, s.displayName] as [string, string]));

    const lines = [CSV_HEADERS.map(csvCell).join(',')];
    for (const assessment of assessments) {
      lines.push([
        maskStudentName(nameById.get(assessment.studentId) ?? '未知学生'),
        assessment.skillTitle,
        formatDateTime(assessment.assessmentAt),
        assessment.status === 'published' ? '已发布' : '草稿',
        assessment.totalScore === null ? '' : assessment.totalScore.toFixed(2),
        assessment.scoredCount,
        assessment.rubricItemCount,
        formatDateTime(assessment.publishedAt),
        assessment.retakeOf ? '是' : '否',
      ].map(csvCell).join(','));
    }

    const body = `\uFEFF${lines.join('\r\n')}\r\n`;
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
