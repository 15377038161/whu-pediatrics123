import type { UsageStatsResult } from '@/app/api/teacher/usage-stats/route';

/**
 * 教师使用统计 CSV 导出构造（脱敏 + 公式注入防护）。
 * 独立模块便于单测覆盖（route 文件仅导出 HTTP 处理器）。
 */

/** 脱敏显示名：姓名保留姓 + **；学号保留前 4 位 + ***（教师本人在页面可见明文，导出统一脱敏） */
export function maskName(name: string): string {
  if (!name) return '(未命名)';
  if (name.length <= 1) return `${name}*`;
  return `${name.slice(0, 1)}${'*'.repeat(Math.min(name.length - 1, 2))}`;
}

export function maskStudentNo(no: string): string {
  if (!no) return '';
  return no.length <= 4 ? `${no}***` : `${no.slice(0, 4)}***`;
}

/**
 * CSV 单元格转义（含公式注入防护）：
 * - 常规转义：含引号/换行时引号包裹，内部引号翻倍；
 * - ⑦公式注入防护：以 =/+/-/@ 或制表符/回车开头的值前置单引号（OWASP CSV Injection 建议），
 *   防止导出文件在 Excel/WPS 中执行被注入的公式（caseId 等文本字段可由学生侧构造）。
 */
export function csvEscape(value: string | number): string {
  const text = String(value ?? '');
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/["\n]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

/** 脱敏汇总导出 CSV：仅聚合统计与学生级汇总（脱敏身份），不含 user_id 明文、对话内容、患者数据 */
export function buildCsv(result: UsageStatsResult): string {
  const lines: string[] = [];
  lines.push('# 学生使用统计（脱敏导出）');
  lines.push('# 口径说明：统计按北京时间自然日；有效时长=页面可见且活跃（隐藏页/多标签非当前页/挂机不计入）；');
  lines.push('# 进行中=2小时内有更新，中途退出=active且停滞超2小时；练习成绩为训练过程参考，非正式成绩；');
  lines.push('# 本统计基于学生端学习行为埋点，非防篡改学习证据，正式成绩以考核记录为准');
  lines.push(csvEscape('汇总'));
  lines.push(['去重学生数', '训练总数', '完成数', '进行中', '中途退出', '总轮次', '有效活跃小时'].map(csvEscape).join(','));
  lines.push([
    result.overall.studentCount,
    result.overall.sessionCount,
    result.overall.completedCount,
    result.overall.inProgressCount,
    result.overall.sessionCount - result.overall.completedCount - result.overall.inProgressCount,
    result.overall.totalTurnCount,
    result.overall.totalActiveHours,
  ].map(csvEscape).join(','));
  lines.push('');
  lines.push(csvEscape('学生明细（脱敏）'));
  lines.push(['学生(脱敏)', '学号(脱敏)', '账号类型', '训练次数', '完成次数', '进行中', '中途退出', '轮次', '有效时长(h)', '平均练习分(非正式)'].map(csvEscape).join(','));
  for (const row of result.perStudent) {
    lines.push([
      maskName(row.displayName),
      maskStudentNo(row.studentNo),
      row.accountKind === 'unknown' ? '未验证' : '已确认',
      row.sessionCount,
      row.completedCount,
      row.inProgressCount,
      row.abandonedCount,
      row.turnCount,
      row.activeHours,
      row.avgPracticeScore,
    ].map(csvEscape).join(','));
  }
  return `\uFEFF${lines.join('\n')}`;
}
