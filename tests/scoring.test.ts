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
  // C-评分补验-01（量表 v2）：关键词命中仅为候选证据，共情部分计分，沟通项不再因关键词命中拿满分
  assert.equal(report.rubricVersion, 2, '旗舰量表升级 v2');
  const communication = report.evidence.find((item) => item.code === 'RUBRIC_COMMUNICATION');
  assert.equal(communication?.status, 'partial');
  assert.equal(communication?.score, 9, '共情候选词 2/3 + 风险解释 4 + 下一步 3');
});

test('缺少真实查体证据时不得获得肺部查体和低氧分', () => {
  const session = createInitialSession('student-1', 'guided');
  session.decision = { diagnosis: '肺炎伴低氧', summary: '学生直接猜测结果', differentials: '病毒性肺炎' };
  const report = buildReport(session, 'report-2');
  assert.equal(report.abilities.examination, 0);
  assert.equal(report.evidence.find((item) => item.code === 'RUBRIC_EXAM_RESP')?.score, 0);
  assert.equal(report.evidence.find((item) => item.code === 'RUBRIC_EXAM_OXYGEN')?.score, 0);
});

test('沟通负例：只重复礼貌词（无病例内容）不授予沟通质量分，记无法评价', () => {
  const session = createInitialSession('student-1', 'guided');
  session.askedIntents = ['onset', 'fever'];
  session.unlockedEvidence = ['EX_PREP', 'EX_RESP'];
  session.decision = { diagnosis: '肺炎', summary: '发热咳嗽伴气促', differentials: '' };
  session.plan = { priority: '吸氧监测', detail: '完善检查，必要时住院。' };
  session.communication = '我理解您担心，别紧张，别担心，我们一起加油，我会尽力的，辛苦了。';
  const report = buildReport(session, 'report-polite');
  const communication = report.evidence.find((item) => item.code === 'RUBRIC_COMMUNICATION');
  assert.equal(communication?.status, 'not_assessable', '礼貌词命中仅为候选证据，沟通质量记无法评价');
  assert.equal(communication?.score, 0);
  assert.equal(report.abilities.communication, 0);
  assert.ok(!report.improvements.includes('家长沟通'), '无法评价项不列为重点改进');
  assert.ok(report.recommendation.includes('无法评价'), '推荐语说明待复核项');
  assert.equal(report.totalScore, Object.values(report.abilities).reduce((sum, value) => sum + value, 0), '总分=分项之和');
});

test('沟通负例：空提交与否定表述记无法评价，不作为未达成扣分', () => {
  const sessionEmpty = createInitialSession('student-1', 'guided');
  sessionEmpty.communication = '';
  const reportEmpty = buildReport(sessionEmpty, 'report-empty-comm');
  assert.equal(reportEmpty.evidence.find((item) => item.code === 'RUBRIC_COMMUNICATION')?.status, 'not_assessable');
  const sessionRefusal = createInitialSession('student-1', 'guided');
  sessionRefusal.communication = '没什么好解释的，不需要说明。';
  const reportRefusal = buildReport(sessionRefusal, 'report-refusal-comm');
  const refusal = reportRefusal.evidence.find((item) => item.code === 'RUBRIC_COMMUNICATION');
  assert.equal(refusal?.status, 'not_assessable', '否定表述无可评价病例内容');
  assert.equal(refusal?.score, 0);
});

test('查体专项负例：仅操作点击不足以评价结果识别，EX_FINDINGS 记无法评价', () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  session.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2', 'EX_TEMP', 'EX_MOUTH'];
  const report = buildReport(session, 'report-exam-clicks');
  assert.equal(report.rubricId, 'rubric-focused-exam');
  assert.equal(report.rubricVersion, 2);
  const findings = report.evidence.find((item) => item.code === 'RUBRIC_EX_FINDINGS');
  assert.equal(findings?.status, 'not_assessable', '查体点击仅为过程证据，结果识别无法评价');
  assert.equal(findings?.score, 0);
  assert.equal(report.totalScore, Object.values(report.abilities).reduce((sum, value) => sum + value, 0), '总分=分项之和（不含无法评价项分）');
});

test('查体专项对照：观察提交锚定查体所见后结果识别可评价', () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  session.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2'];
  session.decision = { diagnosis: '肺炎', summary: '听诊双肺呼吸音粗，血氧 92%', diagnosisBasis: '听诊闻及湿啰音，静息血氧下降', differentials: '' };
  const report = buildReport(session, 'report-exam-observed');
  const findings = report.evidence.find((item) => item.code === 'RUBRIC_EX_FINDINGS');
  assert.equal(findings?.status, 'achieved', '观察提交锚定多项查体所见，结果识别可评价');
  assert.equal(findings?.score, 20);
});

test('沟通专项负例：仅礼貌词时各沟通项记无法评价；对照：含病例内容时礼貌词仅部分计分', () => {
  const polite = createInitialSession('student-1', 'practice', undefined, 'communication');
  polite.communication = '您放心，慢慢来，别紧张，辛苦了。';
  const politeReport = buildReport(polite, 'report-comm-polite');
  assert.equal(politeReport.rubricVersion, 2);
  for (const code of ['RUBRIC_CM_CONCERN_RESPONSE', 'RUBRIC_CM_PLAIN_EXPLANATION', 'RUBRIC_CM_UNDERSTANDING_CHECK', 'RUBRIC_CM_NEXT_STEPS', 'RUBRIC_CM_RESPECTFUL_TONE']) {
    assert.equal(politeReport.evidence.find((item) => item.code === code)?.status, 'not_assessable', `${code} 应记无法评价`);
  }
  assert.equal(politeReport.totalScore, 0, '无可评价沟通内容时不授予沟通质量分');
  assert.equal(politeReport.totalScore, Object.values(politeReport.abilities).reduce((sum, value) => sum + value, 0));

  const content = createInitialSession('student-1', 'practice', undefined, 'communication');
  content.communication = '我理解您担心。孩子目前呼吸和血氧有风险，我们先吸氧监测，下一步复查血氧。您明白吗？别担心，我们陪孩子一起。';
  const contentReport = buildReport(content, 'report-comm-content');
  const byCode = (code: string) => contentReport.evidence.find((item) => item.code === code);
  assert.equal(byCode('RUBRIC_CM_CONCERN_RESPONSE')?.status, 'partial', '共情候选词仅部分计分待复核');
  assert.equal(byCode('RUBRIC_CM_CONCERN_RESPONSE')?.score, 15);
  assert.equal(byCode('RUBRIC_CM_PLAIN_EXPLANATION')?.status, 'achieved');
  assert.equal(byCode('RUBRIC_CM_PLAIN_EXPLANATION')?.score, 25);
  assert.equal(byCode('RUBRIC_CM_UNDERSTANDING_CHECK')?.status, 'achieved');
  assert.equal(byCode('RUBRIC_CM_NEXT_STEPS')?.status, 'achieved');
  assert.equal(byCode('RUBRIC_CM_RESPECTFUL_TONE')?.status, 'partial', '安抚候选词仅部分计分待复核');
  assert.equal(byCode('RUBRIC_CM_RESPECTFUL_TONE')?.score, 6);
  assert.equal(contentReport.totalScore, 86, '总分=分项之和（15+25+20+20+6）');
  assert.equal(contentReport.totalScore, Object.values(contentReport.abilities).reduce((sum, value) => sum + value, 0));
});
