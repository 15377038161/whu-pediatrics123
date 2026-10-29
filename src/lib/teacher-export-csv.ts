import type { TeacherStudentProfile, TeacherStudentSummary } from '@/lib/repository';
import { csvEscape, maskName, maskStudentNo } from '@/lib/usage-stats-csv';

/**
 * 批次5·教师分模块导出 CSV 构造（脱敏 + 公式注入防护）。
 * 独立纯函数模块便于单测覆盖；身份列脱敏口径与 usage-stats 导出一致
 * （页面可见明文，导出统一脱敏）；公式注入防护统一由 csvEscape 处理
 * （caseId/班级名等可能受学生侧或外部数据影响的文本字段同样受保护）。
 */

const modeLabel = (mode: string | null | undefined): string =>
  mode === 'osce' ? 'OSCE 模拟站' : mode === 'practice' ? '专项训练' : mode === 'immersive' ? '沉浸式病例教学' : mode === 'guided' ? '引导训练' : '—';

const formatDateTime = (value: string | null | undefined): string =>
  value ? value.slice(0, 19).replace('T', ' ') : '';

const scoreBasisLabel = (basis: string | null | undefined): string => (basis === 'process' ? '过程完成度' : '临床量表');

/** 学情总表（学生级汇总）：trainCount/reportCount/最近得分（未评分与过程分口径见注释）/待复核/最近活跃。 */
export function buildStudentsCsv(students: TeacherStudentSummary[]): string {
  const lines: string[] = [];
  lines.push('# 学生学情总表（脱敏导出）');
  lines.push('# 口径说明：最近得分沿用学情首页口径（未评分报告与过程分不计入）；待复核=最近报告 pending_review 且无复核留痕；');
  lines.push('# 训练次数=教师可见训练会话总数（含进行中）；报告数=可见报告总数；正式成绩以教师复核留痕为准');
  lines.push(csvEscape('学生明细（脱敏）'));
  lines.push(['学生(脱敏)', '学号(脱敏)', '班级', '训练次数', '报告数', '最近得分', '最近得分口径', '最近模式', '待复核', '最近活跃'].map(csvEscape).join(','));
  for (const student of students) {
    lines.push([
      maskName(student.displayName),
      maskStudentNo(student.studentNo ?? ''),
      student.cohortName ?? '未归属当前班级',
      student.trainCount,
      student.reportCount,
      student.latestScore ?? '—',
      scoreBasisLabel(student.latestScoreBasis),
      modeLabel(student.latestMode),
      student.latestPendingReview ? '待复核' : '—',
      formatDateTime(student.lastActiveAt),
    ].map(csvEscape).join(','));
  }
  return `\uFEFF${lines.join('\n')}`;
}

/** 学生档案（训练明细 + 病例进度汇总两段）：数据与档案页一致，由同一服务端聚合方法授权。 */
export function buildProfileCsv(profile: TeacherStudentProfile): string {
  const lines: string[] = [];
  lines.push('# 学生档案（脱敏导出）');
  lines.push('# 口径说明：得分列为报告折算视图（未评分报告显示「未评分」）；正式成绩/重练次数见病例进度汇总段；');
  lines.push('# 报告状态/已复核为复核流转信息（pending_review 且无留痕=待复核）');
  lines.push([maskName(profile.student.displayName), maskStudentNo(profile.student.studentNo ?? ''), profile.student.cohortName ?? '未归属当前班级'].map(csvEscape).join(','));
  lines.push('');
  lines.push(csvEscape('训练明细（脱敏）'));
  lines.push(['训练开始', '最近更新', '类型', '病例', '会话状态', '得分', '得分口径', '报告状态', '已复核'].map(csvEscape).join(','));
  for (const session of profile.sessions) {
    lines.push([
      formatDateTime(session.startedAt),
      formatDateTime(session.updatedAt),
      modeLabel(session.mode),
      session.caseId ?? '病例未标注',
      session.status ?? '—',
      session.scoreBasis === 'process' ? (session.totalScore === null ? '—' : `过程 ${session.totalScore}`) : session.totalScore ?? '未评分',
      scoreBasisLabel(session.scoreBasis),
      session.reportStatus ?? '—',
      session.reviewed ? '是' : '否',
    ].map(csvEscape).join(','));
  }
  lines.push('');
  lines.push(csvEscape('病例进度汇总'));
  lines.push(['病例', '编号', '训练次数', '完成次数', '报告数', '正式成绩', '重练次数', '待复核数', '最近训练'].map(csvEscape).join(','));
  for (const progress of profile.caseProgress) {
    lines.push([
      progress.caseLabel,
      progress.indexNumber ?? '—',
      progress.trainCount,
      progress.completedCount,
      progress.reportCount,
      progress.officialScore ?? '—',
      progress.retakeCount,
      progress.pendingReviewCount,
      formatDateTime(progress.latestAt),
    ].map(csvEscape).join(','));
  }
  return `\uFEFF${lines.join('\n')}`;
}
