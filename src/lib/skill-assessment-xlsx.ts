import { formatDateTime, maskStudentName, type SkillAssessmentCsvRow } from '@/lib/skill-assessment-csv';
import type { XlsxSheetSpec } from '@/lib/xlsx-writer';

/**
 * 教师现场考核评分 Excel 导出，与 buildSkillAssessmentCsv 同一份数据与脱敏口径。
 * 导出字段仅限教学归档所需信息，不包含 UUID、clientEventId 或自由文本备注；
 * 总分写成数字列（未评分留空），老师可直接在 Excel 里统计，不会与 0 分混淆。
 */

const NOTES: readonly string[] = [
  '口径说明：现场考核成绩独立于 OSCE 模拟参考评分与训练报告成绩，不互换算、不入 AI 生成。',
  '总分为 40 项评分种子中本次已观察项的折算结果（0-100）；草稿状态尚未发布，学生端不可见。',
  '学生姓名已脱敏为首字 + **，避免导出文件脱离系统后直接暴露完整身份。',
];

export function buildSkillAssessmentSheets(rows: readonly SkillAssessmentCsvRow[]): XlsxSheetSpec[] {
  return [{
    name: '现场考核评分',
    notes: NOTES,
    columns: [
      { header: '学生（脱敏）' },
      { header: '技能' },
      { header: '考核时间' },
      { header: '状态' },
      { header: '总分', kind: 'number' },
      { header: '已评分项', kind: 'number' },
      { header: '评分项总数', kind: 'number' },
      { header: '发布时间' },
      { header: '是否补考' },
    ],
    rows: rows.map((row) => [
      maskStudentName(row.studentName),
      row.skillTitle,
      formatDateTime(row.assessmentAt),
      row.status === 'published' ? '已发布' : '草稿',
      row.totalScore,
      row.scoredCount,
      row.rubricItemCount,
      formatDateTime(row.publishedAt),
      row.retakeOf ? '是' : '否',
    ]),
  }];
}
