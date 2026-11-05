import type { UsageStatsResult } from '@/app/api/teacher/usage-stats/route';
import { maskName, maskStudentNo } from '@/lib/usage-stats-csv';
import type { XlsxSheetSpec } from '@/lib/xlsx-writer';

/**
 * 教师使用统计 Excel 导出（与 buildCsv 同一份数据、同一套脱敏口径，只是换成 .xlsx 交付）。
 * 独立模块便于单测覆盖；route 文件仅负责鉴权与响应头。
 *
 * 工作表内容与教师页面已展示的区块一一对应，不额外派生新指标：
 * 汇总 / 学生明细（CSV 原有两段）+ 病例分布 / 题库薄弱项（页面上已有、CSV 未导出的两段）。
 */

const USAGE_NOTES: readonly string[] = [
  '口径说明：统计按北京时间自然日；有效时长＝页面可见且活跃（隐藏页/多标签非当前页/挂机不计入）。',
  '进行中＝2 小时内有更新；中途退出＝active 且停滞超 2 小时。',
  '练习成绩为训练过程参考分，不是执业医师正式成绩；正式成绩以现场考核与教师复核留痕为准。',
  '本表基于学生端学习行为埋点，属学习行为记录，不是防篡改的考试证据。',
  '姓名与学号已脱敏（页面可见明文，导出统一脱敏）；不含 user_id 明文、对话内容与患者数据。',
];

export function buildUsageStatsSheets(result: UsageStatsResult): XlsxSheetSpec[] {
  const abandoned = result.overall.sessionCount - result.overall.completedCount - result.overall.inProgressCount;
  return [
    {
      name: '汇总',
      notes: USAGE_NOTES,
      columns: [{ header: '指标' }, { header: '数值', kind: 'number' }],
      rows: [
        ['去重学生数', result.overall.studentCount],
        ['训练总数', result.overall.sessionCount],
        ['完成数', result.overall.completedCount],
        ['进行中', result.overall.inProgressCount],
        ['中途退出', abandoned],
        ['总轮次', result.overall.totalTurnCount],
        ['有效活跃小时', result.overall.totalActiveHours],
      ],
    },
    {
      name: '学生明细',
      notes: USAGE_NOTES,
      columns: [
        { header: '学生(脱敏)' },
        { header: '学号(脱敏)' },
        { header: '账号类型' },
        { header: '训练次数', kind: 'number' },
        { header: '完成次数', kind: 'number' },
        { header: '进行中', kind: 'number' },
        { header: '中途退出', kind: 'number' },
        { header: '轮次', kind: 'number' },
        { header: '有效时长(h)', kind: 'number' },
        { header: '平均练习分(非正式)', kind: 'number' },
      ],
      rows: result.perStudent.map((row) => [
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
      ]),
    },
    {
      name: '病例分布',
      columns: [
        { header: '病例' },
        { header: '模式' },
        { header: '训练次数', kind: 'number' },
        { header: '完成次数', kind: 'number' },
      ],
      rows: result.caseDistribution.map((row) => [row.caseId, row.mode, row.sessionCount, row.completedCount]),
    },
    {
      name: '题库薄弱项',
      notes: ['口径说明：按病例 + 难度聚合题库作答正确率；仅列样本数 ≥ 3 且正确率 < 80% 的组合。'],
      columns: [
        { header: '病例' },
        { header: '难度' },
        { header: '作答题数', kind: 'number' },
        { header: '答对题数', kind: 'number' },
        { header: '正确率', kind: 'percent' },
      ],
      rows: result.weakAreas.map((row) => [row.caseId, row.difficulty, row.assigned, row.correct, row.correctRate]),
    },
  ];
}
