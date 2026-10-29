import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfileCsv, buildStudentsCsv } from '../src/lib/teacher-export-csv';
import type { TeacherStudentProfile, TeacherStudentSummary } from '../src/lib/repository';

const baseStudent = (overrides: Partial<TeacherStudentSummary> & { id: string }): TeacherStudentSummary => ({
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

const baseProfile = (): TeacherStudentProfile => ({
  student: { id: 'preview-student-001', displayName: '张三', studentNo: '20240001', chaoxingUid: null, avatarUrl: null, cohortId: null, cohortName: null },
  sessions: [
    { sessionId: 's1', mode: 'osce', startedAt: '2026-03-01T07:00:00Z', updatedAt: '2026-03-01T08:00:00Z', caseId: 'teacher-A', status: 'completed', reportId: 'r1', totalScore: 88, scoreBasis: 'clinical', reportStatus: 'pending_review', reviewed: false },
    { sessionId: 's2', mode: 'practice', startedAt: '2026-03-02T07:00:00Z', updatedAt: '2026-03-02T08:00:00Z', caseId: null, status: 'active', reportId: null, totalScore: null, scoreBasis: 'clinical', reportStatus: null, reviewed: false },
  ],
  caseProgress: [
    { caseId: 'teacher-A', caseLabel: '病名:teacher-A', indexNumber: 3, trainCount: 1, completedCount: 1, reportCount: 1, latestScore: 88, latestScoreBasis: 'clinical', latestAt: '2026-03-01T07:00:00Z', officialScore: 88, retakeCount: 0, pendingReviewCount: 1 },
    { caseId: '', caseLabel: '病例未标注', indexNumber: null, trainCount: 1, completedCount: 0, reportCount: 0, latestScore: null, latestScoreBasis: 'clinical', latestAt: '2026-03-02T07:00:00Z', officialScore: null, retakeCount: 0, pendingReviewCount: 0 },
  ],
});

test('批次5·学情总表导出：脱敏/字段齐全/口径标注/公式注入防护（纯函数）', () => {
  const csv = buildStudentsCsv([
    baseStudent({ id: 'a1' }),
    baseStudent({ id: 'a2', displayName: '欧阳娜娜', studentNo: null, cohortName: '=HYPERLINK("http://evil")', latestScore: null, latestScoreBasis: 'process', latestPendingReview: true, lastActiveAt: null }),
  ]);
  assert.ok(csv.startsWith('\uFEFF'), 'BOM 头（Excel 中文兼容）');
  const lines = csv.replace('\uFEFF', '').split('\n');
  assert.ok(lines[0]?.includes('脱敏导出'), '注释行标注脱敏口径');
  const headerIndex = lines.findIndex((line) => line.includes('学生(脱敏)'));
  assert.ok(headerIndex > 0, '存在表头行');
  const header = lines[headerIndex]?.split(',') ?? [];
  assert.equal(header.length, 10, '10 列表头');
  const rowA = lines[headerIndex + 1] ?? '';
  assert.ok(rowA.includes('张*'), '姓名脱敏（保留姓）');
  assert.ok(rowA.includes('2024***'), '学号脱敏（前 4 位）');
  assert.ok(rowA.includes('未归属当前班级'), '无班级兜底文案');
  assert.ok(rowA.includes('临床量表'), '临床量表口径标注');
  const rowB = lines[headerIndex + 2] ?? '';
  assert.ok(rowB.includes(`'=`), '公式注入防护：以 = 开头的班级名前置单引号');
  assert.ok(rowB.includes('过程完成度'), '过程分口径标注');
  assert.ok(rowB.includes('待复核'), '待复核状态导出');
});

test('批次5·学生档案导出：两段结构/折算视图/复核状态列（纯函数）', () => {
  const csv = buildProfileCsv(baseProfile());
  assert.ok(csv.startsWith('\uFEFF'), 'BOM 头');
  const text = csv.replace('\uFEFF', '');
  assert.ok(text.includes('训练明细（脱敏）'), '第一段：训练明细');
  assert.ok(text.includes('病例进度汇总'), '第二段：病例进度汇总');
  assert.ok(text.includes('张*'), '身份行脱敏');
  assert.ok(text.includes('未评分'), '无报告会话得分显示未评分');
  assert.ok(text.includes('病例未标注'), '无 caseId 会话归未标注');
  assert.ok(text.includes('正式成绩'), '病例进度段含正式成绩列');
  const lines = text.split('\n');
  const detailHeader = lines.findIndex((line) => line.includes('会话状态'));
  assert.ok(detailHeader > 0, '训练明细表头存在');
  const firstRow = lines[detailHeader + 1] ?? '';
  assert.ok(firstRow.includes('pending_review'), '报告状态导出原始值（复核流转信息）');
});
