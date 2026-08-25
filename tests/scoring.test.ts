import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession } from '@/lib/agent-engine';
import { buildReport } from '@/lib/scoring';

test('报告总分严格由六维证据分项相加得到', () => {
  const session = createInitialSession('student-1', 'guided');
  session.askedIntents = ['onset', 'fever', 'danger', 'general', 'exposure', 'vaccination'];
  session.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2', 'EX_TEMP'];
  session.decision = { diagnosis: '社区获得性肺炎伴低氧', summary: '发热咳嗽伴气促和血氧下降', differentials: '病毒性肺炎、支原体肺炎' };
  session.plan = { priority: '吸氧和生命体征监测', detail: '吸氧后复评，完善检查，必要时住院。' };
  session.communication = '我理解您担心。孩子目前呼吸和血氧有风险，我们先吸氧监测，下一步完成检查。';
  const report = buildReport(session, 'report-1');
  assert.equal(report.totalScore, Object.values(report.abilities).reduce((sum, value) => sum + value, 0));
  assert.ok(report.totalScore >= 80);
  assert.equal(report.evidence.find((item) => item.code === 'RUBRIC_SAFETY')?.achieved, true);
});

test('缺少真实查体证据时不得获得肺部查体和低氧分', () => {
  const session = createInitialSession('student-1', 'guided');
  session.decision = { diagnosis: '肺炎伴低氧', summary: '学生直接猜测结果', differentials: '病毒性肺炎' };
  const report = buildReport(session, 'report-2');
  assert.equal(report.abilities.examination, 0);
  assert.equal(report.evidence.find((item) => item.code === 'RUBRIC_EXAM_RESP')?.score, 0);
  assert.equal(report.evidence.find((item) => item.code === 'RUBRIC_EXAM_OXYGEN')?.score, 0);
});
