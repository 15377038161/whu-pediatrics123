import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import type { UsageStatsResult } from '@/app/api/teacher/usage-stats/route';
import type { TeacherStudentProfile, TeacherStudentSummary } from '@/lib/repository';
import type { SkillAssessmentCsvRow } from '@/lib/skill-assessment-csv';
import { buildSkillAssessmentSheets } from '@/lib/skill-assessment-xlsx';
import { buildProfileSheets, buildStudentsSheets } from '@/lib/teacher-export-xlsx';
import { buildUsageStatsSheets } from '@/lib/usage-stats-xlsx';
import { writeXlsx } from '@/lib/xlsx-writer';

const student = (overrides: Partial<TeacherStudentSummary> = {}): TeacherStudentSummary => ({
  id: 'user-internal-uuid-001',
  displayName: '张三',
  studentNo: '20240001',
  chaoxingUid: null,
  avatarUrl: null,
  cohortId: null,
  cohortName: null,
  latestScore: 88,
  latestScoreBasis: 'clinical',
  latestMode: 'osce',
  reportCount: 2,
  latestReportId: 'r1',
  latestSessionId: 's1',
  lastActiveAt: '2026-03-01T08:00:00Z',
  latestPendingReview: false,
  trainCount: 3,
  ...overrides,
});

const profile = (): TeacherStudentProfile => ({
  student: { id: 'user-internal-uuid-001', displayName: '张三', studentNo: '20240001', chaoxingUid: null, avatarUrl: null, cohortId: null, cohortName: null },
  sessions: [
    { sessionId: 's1', mode: 'osce', startedAt: '2026-03-01T07:00:00Z', updatedAt: '2026-03-01T08:00:00Z', caseId: 'teacher-A', status: 'completed', reportId: 'r1', totalScore: 88, scoreBasis: 'clinical', reportStatus: 'pending_review', reviewed: false },
    { sessionId: 's2', mode: 'practice', startedAt: '2026-03-02T07:00:00Z', updatedAt: '2026-03-02T08:00:00Z', caseId: null, status: 'active', reportId: null, totalScore: null, scoreBasis: 'process', reportStatus: null, reviewed: false },
  ],
  caseProgress: [
    { caseId: 'teacher-A', caseLabel: '病名:teacher-A', indexNumber: 3, trainCount: 1, completedCount: 1, reportCount: 1, latestScore: 88, latestScoreBasis: 'clinical', latestAt: '2026-03-01T07:00:00Z', officialScore: 88, retakeCount: 0, pendingReviewCount: 1 },
    { caseId: '', caseLabel: '病例未标注', indexNumber: null, trainCount: 1, completedCount: 0, reportCount: 0, latestScore: null, latestScoreBasis: 'clinical', latestAt: '2026-03-02T07:00:00Z', officialScore: null, retakeCount: 0, pendingReviewCount: 0 },
  ],
});

const usage = (): UsageStatsResult => ({
  perStudent: [{
    userId: 'user-internal-uuid-001',
    displayName: '张三',
    studentNo: '20240001',
    accountKind: 'unknown',
    sessionCount: 4,
    completedCount: 2,
    abandonedCount: 1,
    inProgressCount: 1,
    turnCount: 30,
    activeHours: 2.5,
    avgPracticeScore: 76.5,
  }],
  overall: { studentCount: 1, sessionCount: 10, completedCount: 6, inProgressCount: 3, totalTurnCount: 120, totalActiveHours: 8.25 },
  dailyTrend: [],
  weeklyTrend: [],
  caseDistribution: [{ caseId: 'teacher-A', mode: 'osce', sessionCount: 4, completedCount: 2 }],
  weakAreas: [{ caseId: 'teacher-A', difficulty: '中等', assigned: 10, correct: 6, correctRate: 0.6 }],
  recentSessions: [],
  scoreBasis: 'practice-only',
});

const assessment = (overrides: Partial<SkillAssessmentCsvRow> = {}): SkillAssessmentCsvRow => ({
  studentName: '张三',
  skillTitle: '儿科病史采集',
  assessmentAt: '2026-03-01T08:00:00Z',
  status: 'published',
  totalScore: 82.5,
  scoredCount: 5,
  rubricItemCount: 5,
  publishedAt: '2026-03-01T09:00:00Z',
  retakeOf: null,
  ...overrides,
});

/** 把工作表规格里的单元格摊平，便于断言「某个值不该出现在导出里」。 */
function allCells(sheets: ReturnType<typeof buildStudentsSheets>): string[] {
  return sheets.flatMap((sheet) => [
    ...(sheet.notes ?? []),
    ...sheet.columns.map((column) => column.header),
    ...sheet.rows.flat().map((cell) => (cell === null ? '' : String(cell))),
  ]);
}

test('学情总表 Excel：单表 10 列、脱敏、未评分留空、口径说明随行', () => {
  const [sheet] = buildStudentsSheets([student(), student({ displayName: '欧阳娜娜', studentNo: null, latestScore: null, latestScoreBasis: 'process', latestPendingReview: true, cohortName: '2026 级临床 1 班' })]);
  assert.ok(sheet);
  assert.equal(sheet.name, '学情总表');
  assert.equal(sheet.columns.length, 10);
  assert.ok(sheet.notes?.some((note) => note.includes('脱敏')), '导出必须标注脱敏口径');
  assert.deepEqual(sheet.rows[0]?.slice(0, 3), ['张*', '2024***', '未归属当前班级'], '姓名/学号脱敏，无班级有兜底文案');
  assert.equal(sheet.rows[1]?.[2], '2026 级临床 1 班');
  assert.equal(sheet.rows[1]?.[5], null, '未评分留空（数字列），不写成 0 也不写成文本');
  assert.equal(sheet.rows[1]?.[8], '待复核');
  assert.equal(sheet.rows[0]?.[8], null, '无待复核时该列留空');
  assert.ok(!allCells([sheet]).includes('user-internal-uuid-001'), '不得导出学生 UUID');
});

test('学生档案 Excel：概要 / 训练明细 / 病例进度三表，未评分由「评分状态」列承载', () => {
  const sheets = buildProfileSheets(profile());
  assert.deepEqual(sheets.map((sheet) => sheet.name), ['学生概要', '训练明细', '病例进度']);
  const detail = sheets[1];
  assert.ok(detail);
  assert.equal(detail.columns[5]?.kind, 'number', '得分是数字列');
  assert.deepEqual(detail.rows[0]?.slice(5, 8), [88, '临床量表', '已评分']);
  assert.deepEqual(detail.rows[1]?.slice(3, 4), ['病例未标注'], '无 caseId 归未标注');
  assert.deepEqual(detail.rows[1]?.slice(5, 8), [null, '过程完成度', '未评分'], '未评分留空并在状态列说明，不与 0 分混淆');
  const progress = sheets[2];
  assert.ok(progress);
  assert.equal(progress.columns[1]?.kind, 'number', '病例编号是数字列，便于排序');
  assert.equal(progress.rows[1]?.[5], null, '无正式成绩留空');
});

test('现场考核 Excel：成绩独立口径入说明行，草稿/补考状态中文化，总分为数字', () => {
  const [sheet] = buildSkillAssessmentSheets([assessment(), assessment({ status: 'draft', totalScore: null, publishedAt: null, retakeOf: 'a1' })]);
  assert.ok(sheet);
  assert.equal(sheet.name, '现场考核评分');
  assert.ok(sheet.notes?.some((note) => note.includes('不互换算')), '必须声明与 OSCE/报告成绩不互换算');
  assert.ok(sheet.notes?.some((note) => note.includes('脱敏')), '必须声明姓名脱敏');
  const [name, skill, assessedAt, status, score] = sheet.rows[0] ?? [];
  assert.equal(name, '张**', '姓名脱敏为首字 + **');
  assert.equal(skill, '儿科病史采集');
  assert.ok(String(assessedAt).startsWith('2026-03-01'), '考核时间可读（非时间戳）');
  assert.equal(status, '已发布');
  assert.equal(score, 82.5, '总分为数字');
  assert.deepEqual(sheet.rows[1]?.slice(3, 5), ['草稿', null], '草稿未评分：状态草稿、总分留空');
  assert.equal(sheet.rows[1]?.[8], '是', '补考标记');
  assert.equal(sheet.rows[0]?.[8], '否');
});

test('使用统计 Excel：四表对应页面区块，中途退出为派生差值，正确率按 0–1 小数走百分数格式', () => {
  const sheets = buildUsageStatsSheets(usage());
  assert.deepEqual(sheets.map((sheet) => sheet.name), ['汇总', '学生明细', '病例分布', '题库薄弱项']);
  const summary = sheets[0];
  assert.ok(summary);
  assert.deepEqual(summary.rows.find((row) => row[0] === '中途退出'), ['中途退出', 1], '10 - 6 - 3 = 1');
  assert.equal(summary.columns[1]?.kind, 'number');
  const detail = sheets[1];
  assert.ok(detail);
  assert.deepEqual(detail.rows[0]?.slice(0, 3), ['张*', '2024***', '未验证'], '脱敏 + 账号类型中文化');
  assert.ok(!allCells(sheets).includes('user-internal-uuid-001'), '不得导出学生 UUID');
  const weak = sheets[3];
  assert.ok(weak);
  assert.equal(weak.columns[4]?.kind, 'percent');
  assert.equal(weak.rows[0]?.[4], 0.6, '正确率传 0–1 小数，由百分数格式渲染');
});

test('Excel 导出端到端：四张使用统计表可被真实 xlsx 读回，分数是数字、说明行在表头之上', async () => {
  const bytes = await writeXlsx(buildUsageStatsSheets(usage()));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['汇总', '学生明细', '病例分布', '题库薄弱项']);
  const detail = workbook.getWorksheet('学生明细');
  assert.ok(detail);
  const headerRow = 6;
  assert.equal(detail.getRow(headerRow).getCell(1).value, '学生(脱敏)', '5 行说明 + 表头');
  assert.equal(detail.getRow(headerRow + 1).getCell(4).type, ExcelJS.ValueType.Number, '训练次数是数字，老师可直接求和');
  assert.equal(detail.getRow(headerRow + 1).getCell(1).value, '张*');
  assert.equal(detail.views[0]?.state, 'frozen', '长名单下滑时口径与列名仍可见');
});

test('Excel 导出端到端：学情总表 / 学生档案 / 现场考核三份规格都能写出并被读回', async () => {
  const cases: Array<{ name: string; sheets: ReturnType<typeof buildStudentsSheets>; expected: string[] }> = [
    { name: '学情总表', sheets: buildStudentsSheets([student()]), expected: ['学情总表'] },
    { name: '学生档案', sheets: buildProfileSheets(profile()), expected: ['学生概要', '训练明细', '病例进度'] },
    { name: '现场考核', sheets: buildSkillAssessmentSheets([assessment()]), expected: ['现场考核评分'] },
  ];
  for (const item of cases) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await writeXlsx(item.sheets)));
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), item.expected, `${item.name} 工作表清单`);
    const first = workbook.worksheets[0];
    assert.ok(first && first.rowCount > 1, `${item.name} 有说明行与数据行`);
  }
});
