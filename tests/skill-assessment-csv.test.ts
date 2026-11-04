import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkillAssessmentCsv, csvCell, maskStudentName } from '@/lib/skill-assessment-csv';

test('现场考核 CSV 姓名脱敏、字段口径与公式注入防护', () => {
  assert.equal(maskStudentName('王小测(改名)'), '王**');
  assert.equal(maskStudentName('  '), '未知学生');
  for (const value of ['=1+1', '+1', '-1', '@cmd', '\t=1+1', '\r=1+1']) {
    assert.ok(csvCell(value).startsWith('"\''), `${JSON.stringify(value)} 应转为文本单元格`);
  }
  assert.equal(csvCell('含"引号"'), '"含""引号"""');

  const csv = buildSkillAssessmentCsv([{
    studentName: '王小测(改名)',
    skillTitle: '=1+1',
    assessmentAt: '2026-11-04T06:00:00.000Z',
    status: 'published',
    totalScore: 87.5,
    scoredCount: 4,
    rubricItemCount: 5,
    publishedAt: '2026-11-04T06:30:00.000Z',
    retakeOf: 'retake-internal-id',
  }]);

  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes('"王**"'));
  assert.ok(!csv.includes('王小测(改名)'), '不得导出完整姓名');
  assert.ok(csv.includes('"\'=1+1"'), '技能名不得以公式形式进入表格');
  assert.ok(csv.includes('"已发布","87.50","4","5"'));
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(!csv.includes('retake-internal-id'), '补考仅导出是否补考，不导出内部关联 ID');
});

test('空考核列表仍导出可读的 UTF-8 表头', () => {
  const csv = buildSkillAssessmentCsv([]);
  assert.ok(csv.includes('学生（脱敏）'));
  assert.ok(csv.includes('是否补考'));
  assert.equal(csv.trim().split('\r\n').length, 1);
});
