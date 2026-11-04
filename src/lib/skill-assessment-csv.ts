export interface SkillAssessmentCsvRow {
  studentName: string;
  skillTitle: string;
  assessmentAt: string;
  status: 'draft' | 'published';
  totalScore: number | null;
  scoredCount: number;
  rubricItemCount: number;
  publishedAt: string | null;
  retakeOf: string | null;
}

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
export function csvCell(value: string | number | null): string {
  const raw = value === null ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function maskStudentName(name: string): string {
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

/** 导出字段仅限教学归档所需信息，不包含 UUID、clientEventId 或自由文本备注。 */
export function buildSkillAssessmentCsv(rows: readonly SkillAssessmentCsvRow[]): string {
  const lines = [CSV_HEADERS.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push([
      maskStudentName(row.studentName),
      row.skillTitle,
      formatDateTime(row.assessmentAt),
      row.status === 'published' ? '已发布' : '草稿',
      row.totalScore === null ? '' : row.totalScore.toFixed(2),
      row.scoredCount,
      row.rubricItemCount,
      formatDateTime(row.publishedAt),
      row.retakeOf ? '是' : '否',
    ].map(csvCell).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
