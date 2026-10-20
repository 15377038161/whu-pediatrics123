import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { buildReport } from '@/lib/scoring';
import { findRubricForReport } from '@/domain/training-rubric';

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
  // C-评分补验-02（量表 v3）：沟通质量与能力分分离——共情/风险解释仅记候选证据不计分，
  // 能力分只评价可验证的下一步说明
  assert.equal(report.rubricVersion, 3, '旗舰量表升级 v3');
  const communication = report.evidence.find((item) => item.code === 'RUBRIC_COMMUNICATION');
  assert.equal(communication?.status, 'partial');
  assert.equal(communication?.score, 3, '仅可验证的下一步计 3 分；共情/风险解释为候选证据不计分');
  assert.ok(communication?.detail.includes('候选证据'), '候选证据写入说明待教师复核');
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

test('通用词堆砌负例：沟通质量分不给，仅可验证的下一步按规则计分', () => {
  const session = createInitialSession('student-1', 'guided');
  session.communication = '理解 担心 检查 复查 监测 观察 处置 病情';
  const report = buildReport(session, 'report-word-stuffing');
  const communication = report.evidence.find((item) => item.code === 'RUBRIC_COMMUNICATION');
  assert.equal(communication?.status, 'partial');
  assert.equal(communication?.score, 3, '仅可验证的下一步计 3 分；共情候选词不给质量分');
  assert.ok(communication?.detail.includes('候选证据'), '候选证据写入说明待教师复核');
  assert.equal(report.abilities.communication, 3);
  assert.equal(report.totalScore, Object.values(report.abilities).reduce((sum, value) => sum + value, 0), '总分=分项之和');
});

test('查体专项负例：仅操作点击不足以评价结果识别，EX_FINDINGS 记无法评价', () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  session.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2', 'EX_TEMP', 'EX_MOUTH'];
  const report = buildReport(session, 'report-exam-clicks');
  assert.equal(report.rubricId, 'rubric-focused-exam');
  assert.equal(report.rubricVersion, 3);
  const findings = report.evidence.find((item) => item.code === 'RUBRIC_EX_FINDINGS');
  assert.equal(findings?.status, 'not_assessable', '查体专项未开放观察提交入口，点击仅为过程证据，结果识别无法评价');
  assert.equal(findings?.score, 0);
  assert.equal(report.totalScore, Object.values(report.abilities).reduce((sum, value) => sum + value, 0), '总分=分项之和（不含无法评价项分）');
});

test('查体专项提交入口实证：SUBMIT_DECISION 不在 allowedActions，服务端拒绝', async () => {
  // 评分层 EX_FINDINGS「恒不可评价」的前提实证：查体专项无观察/诊断提交通道，
  // 学生不能经 API 直接提交 decision（服务端事件门控，不依赖前端隐藏）。
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  await assert.rejects(
    () => runAgentTurn(session, { type: 'SUBMIT_DECISION', data: { diagnosis: '肺炎', summary: '发热咳嗽伴气促', diagnosisBasis: '听诊呼吸音粗', differentials: '' } }, 'exam-decision-rejected'),
    /PRACTICE_EVENT_FORBIDDEN/,
  );
  assert.ok(!session.decision, '拒绝后无诊断提交，评分层不存在可评价的观察文本');
});

test('查体专项防御对照：观察提交须与本会话已解锁病例查体所见可靠核对', () => {
  // 生产路径无观察提交入口（见上方门控实证测试）；本测试直改 decision 模拟异常/直改数据路径，
  // 验证评分层不以锚定词数量给分，须与本会话病例查体事实核对一致才计分。
  const pushExamFact = (session: ReturnType<typeof createInitialSession>) => {
    session.events.push({
      id: `ev-exam-${session.events.length}`,
      clientEventId: `ce-exam-${session.events.length}`,
      type: 'EXAM_ACTION',
      stage: 'exam',
      summary: '肺部听诊：双侧呼吸音粗，右下肺可闻及细湿啰音',
      correct: true,
      evidenceCodes: ['EX_RESP'],
      createdAt: new Date().toISOString(),
    });
  };

  // 对照：观察所见与病例事实一致 → 可评价
  const consistent = createInitialSession('student-1', 'practice', undefined, 'exam');
  consistent.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2'];
  pushExamFact(consistent);
  consistent.decision = { diagnosis: '肺炎', summary: '听诊双肺呼吸音粗，右下肺闻及湿啰音', diagnosisBasis: '呼吸音粗伴湿啰音', differentials: '' };
  const consistentReport = buildReport(consistent, 'report-exam-consistent');
  const consistentFindings = consistentReport.evidence.find((item) => item.code === 'RUBRIC_EX_FINDINGS');
  assert.equal(consistentFindings?.status, 'achieved', '观察提交与本会话病例查体所见核对一致，结果识别可评价');
  assert.equal(consistentFindings?.score, 20);

  // 负例：否定病例实际所见 → 错误做法
  const contradicted = createInitialSession('student-1', 'practice', undefined, 'exam');
  contradicted.unlockedEvidence = ['EX_PREP', 'EX_RESP'];
  pushExamFact(contradicted);
  contradicted.decision = { diagnosis: '肺炎', summary: '听诊双肺呼吸音清，未闻及湿啰音', diagnosisBasis: '两肺呼吸音清', differentials: '' };
  const contradictedReport = buildReport(contradicted, 'report-exam-contradicted');
  const contradictedFindings = contradictedReport.evidence.find((item) => item.code === 'RUBRIC_EX_FINDINGS');
  assert.equal(contradictedFindings?.status, 'incorrect', '观察提交否定病例实际所见，记错误做法');
  assert.equal(contradictedFindings?.score, 0);

  // 负例：与病例查体所见无关 → 无法可靠核对，不给能力分
  const unrelated = createInitialSession('student-1', 'practice', undefined, 'exam');
  unrelated.decision = { diagnosis: '腹痛', summary: '腹部触诊柔软无压痛', diagnosisBasis: '腹部查体未见异常', differentials: '' };
  const unrelatedReport = buildReport(unrelated, 'report-exam-unrelated');
  const unrelatedFindings = unrelatedReport.evidence.find((item) => item.code === 'RUBRIC_EX_FINDINGS');
  assert.equal(unrelatedFindings?.status, 'not_assessable', '观察提交与病例查体所见无关时无法可靠核对，不给能力分');
  assert.equal(unrelatedFindings?.score, 0);
});

test('沟通专项：质量项记无法评价+候选证据；可验证项按否定守卫计分', () => {
  const polite = createInitialSession('student-1', 'practice', undefined, 'communication');
  polite.communication = '您放心，慢慢来，别紧张，辛苦了。';
  const politeReport = buildReport(polite, 'report-comm-polite');
  assert.equal(politeReport.rubricVersion, 3);
  for (const code of ['RUBRIC_CM_CONCERN_RESPONSE', 'RUBRIC_CM_PLAIN_EXPLANATION', 'RUBRIC_CM_UNDERSTANDING_CHECK', 'RUBRIC_CM_NEXT_STEPS', 'RUBRIC_CM_RESPECTFUL_TONE']) {
    assert.equal(politeReport.evidence.find((item) => item.code === code)?.status, 'not_assessable', `${code} 应记无法评价`);
  }
  assert.equal(politeReport.totalScore, 0, '无可评价沟通内容时不授予沟通质量分');
  assert.equal(politeReport.totalScore, Object.values(politeReport.abilities).reduce((sum, value) => sum + value, 0));

  const content = createInitialSession('student-1', 'practice', undefined, 'communication');
  content.communication = '我理解您担心。孩子目前呼吸和血氧有风险，我们先吸氧监测，下一步复查血氧。您明白吗？别担心，我们陪孩子一起。';
  const contentReport = buildReport(content, 'report-comm-content');
  const byCode = (code: string) => contentReport.evidence.find((item) => item.code === code);
  // C-评分补验-02：质量项（回应顾虑/通俗解释/尊重表达）不再凭关键词给分（含 15/6 打折分），
  // 恒记无法评价并保留候选证据；可验证项（核实理解/后续安排）保留计分。
  assert.equal(byCode('RUBRIC_CM_CONCERN_RESPONSE')?.status, 'not_assessable', '回应顾虑为质量项，记无法评价待教师复核');
  assert.equal(byCode('RUBRIC_CM_CONCERN_RESPONSE')?.score, 0);
  assert.ok(byCode('RUBRIC_CM_CONCERN_RESPONSE')?.detail.includes('候选证据'), '候选证据写入说明');
  assert.equal(byCode('RUBRIC_CM_PLAIN_EXPLANATION')?.status, 'not_assessable', '通俗解释为质量项，不再关键词命中即满分');
  assert.equal(byCode('RUBRIC_CM_PLAIN_EXPLANATION')?.score, 0);
  assert.ok(byCode('RUBRIC_CM_PLAIN_EXPLANATION')?.detail.includes('候选证据'), '候选证据写入说明');
  assert.equal(byCode('RUBRIC_CM_UNDERSTANDING_CHECK')?.status, 'achieved', '核实理解为可验证项');
  assert.equal(byCode('RUBRIC_CM_UNDERSTANDING_CHECK')?.score, 20);
  assert.equal(byCode('RUBRIC_CM_NEXT_STEPS')?.status, 'achieved', '后续安排为可验证项');
  assert.equal(byCode('RUBRIC_CM_NEXT_STEPS')?.score, 20);
  assert.equal(byCode('RUBRIC_CM_RESPECTFUL_TONE')?.status, 'not_assessable', '尊重表达为质量项，记无法评价待教师复核');
  assert.equal(byCode('RUBRIC_CM_RESPECTFUL_TONE')?.score, 0);
  assert.equal(contentReport.totalScore, 40, '总分=可验证分项之和（20+20），质量项不计分');
  assert.equal(contentReport.totalScore, Object.values(contentReport.abilities).reduce((sum, value) => sum + value, 0));
  assert.ok(contentReport.studentSubmissions?.communication, '沟通原文保留在报告快照供教师复核');
});

test('沟通专项否定守卫负例：否定表述的后续安排与核实理解不给分', () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'communication');
  session.communication = '孩子病情稳定，不需要复查，暂不处理用药，不用明白吗。';
  const report = buildReport(session, 'report-comm-negated');
  assert.equal(report.evidence.find((item) => item.code === 'RUBRIC_CM_NEXT_STEPS')?.status, 'missing', '否定表述的后续安排不计分');
  assert.equal(report.evidence.find((item) => item.code === 'RUBRIC_CM_UNDERSTANDING_CHECK')?.status, 'missing', '否定表述的核实理解不计分');
  assert.equal(report.totalScore, 0, '质量项不可评价+可验证项否定 → 不给分');
  assert.equal(report.totalScore, Object.values(report.abilities).reduce((sum, value) => sum + value, 0));
});

test('全不可评价负例：推荐语不称各项均达成', () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'communication');
  const report = buildReport(session, 'report-comm-all-na');
  assert.equal(report.totalScore, 0);
  for (const code of ['RUBRIC_CM_CONCERN_RESPONSE', 'RUBRIC_CM_PLAIN_EXPLANATION', 'RUBRIC_CM_UNDERSTANDING_CHECK', 'RUBRIC_CM_NEXT_STEPS', 'RUBRIC_CM_RESPECTFUL_TONE']) {
    assert.equal(report.evidence.find((item) => item.code === code)?.status, 'not_assessable', `${code} 应记无法评价`);
  }
  assert.ok(!report.recommendation.includes('均达成'), '全部项无可评价证据时不称「各项均达成」');
  assert.ok(report.recommendation.includes('缺少可评价证据'), '推荐语如实说明无可评价项，待教师复核');
});

test('历史量表版本冻结注册表：按 id+version 精确匹配，不回退同 id 当前量表', () => {
  assert.equal(findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 3 })?.version, 3, '当前报告命中当前版本');
  assert.equal(findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 2 })?.version, 2, 'v2 历史报告命中 v2 冻结定义');
  assert.equal(findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 1 })?.version, 1, 'v1 历史报告命中 v1 冻结定义');
  const v1Comm = findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 1 })?.items.find((item) => item.itemId === 'COMMUNICATION');
  assert.ok(v1Comm?.evidenceRule.includes('共情 3 分'), 'v1 规则文本冻结不漂移，不套用 v3 解释');
  const v2Findings = findRubricForReport({ rubricId: 'rubric-focused-exam', rubricVersion: 2 })?.items.find((item) => item.itemId === 'EX_FINDINGS');
  assert.ok(v2Findings?.evidenceRule.includes('≥2 项'), 'exam v2 规则文本冻结，v3 历史报告不套用');
  assert.equal(findRubricForReport({ rubricId: 'rubric-focused-communication', rubricVersion: 1 })?.version, 1);
  assert.equal(findRubricForReport({ rubricId: 'rubric-focused-communication', rubricVersion: 2 })?.version, 2);
  assert.equal(findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 99 }), undefined, '未存档版本明确缺失，不回退当前量表');
  assert.equal(findRubricForReport({}), undefined, '无量表元数据的历史报告返回 undefined（展示层降级）');
});
