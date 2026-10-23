import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { buildReport } from '@/lib/scoring';
import { findRubricForReport, isUnscoredReport, unscoredReasonForDisplay } from '@/domain/training-rubric';
import { agentTurnSchema } from '@/lib/validation';

test('沟通专项不向所有病例添加肺部感染、低氧和已经氧疗的既定事实', () => {
  const session = createInitialSession('student-neutral-briefing', 'practice', undefined, 'communication');
  const briefing = session.messages.filter(message => message.actor === 'system').map(message => message.content).join('\n');
  assert.ok(briefing.includes('没有提供的内容应说明待核实'));
  assert.ok(!briefing.includes('初步考虑肺部感染伴低氧风险，已开始氧疗'));
  assert.equal(session.scenarioVersion, 4);
});

test('查体观察可提交十项以上的结果关联，仍限制请求规模', () => {
  const request = (count: number) => ({ sessionId: '11111111-1111-4111-8111-111111111111', clientEventId: 'source-links',
    event: { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '本次完整查体结果的观察记录', linkedEvidence: Array.from({ length: count }, (_, i) => `SOURCE_EX_${i}`) } } });
  assert.equal(agentTurnSchema.safeParse(request(18)).success, true);
  assert.equal(agentTurnSchema.safeParse(request(33)).success, false);
});

test('来源病例查体证据可关联观察，仍拒绝无原事件或未解锁的来源证据', async () => {
  const session = createInitialSession('student-source-observation', 'practice', undefined, 'exam');
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'source-prep');
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'source-exam');
  // Controlled event fixture reproduces the actual teacher-case code namespace.
  const original = session.events.find(event => event.clientEventId === 'source-exam');
  assert.ok(original?.correct && original.evidenceCodes.length);
  const previousCode = original.evidenceCodes[0];
  original.evidenceCodes = ['SOURCE_EX_CHEST'];
  session.unlockedEvidence = session.unlockedEvidence.map(code => code === previousCode ? 'SOURCE_EX_CHEST' : code);
  await runAgentTurn(session, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '记录本次获得的查体结果', linkedEvidence: ['SOURCE_EX_CHEST'] } }, 'source-observation');
  assert.deepEqual(session.examObservation?.linkedEventIds, [original.id]);
  session.unlockedEvidence.push('SOURCE_EX_FORGED');
  await assert.rejects(runAgentTurn(session, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '伪造关联', linkedEvidence: ['SOURCE_EX_FORGED'] } }, 'source-forged'), /EXAM_EVIDENCE_NOT_OBTAINED/);
  session.unlockedEvidence = session.unlockedEvidence.filter(code => code !== 'SOURCE_EX_CHEST');
  await assert.rejects(runAgentTurn(session, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '未解锁关联', linkedEvidence: ['SOURCE_EX_CHEST'] } }, 'source-locked'), /EXAM_EVIDENCE_NOT_OBTAINED/);
});

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
  // C-评分补验-03（量表 v4）：沟通项整项按不可评价处理——下一步表述降为过程反馈不计分，
  // 整项（含质量 7 分）排除出计分与适用满分，待教师结合提交原文复核。
  assert.equal(report.rubricVersion, 4, '旗舰量表升级 v4');
  const communication = report.evidence.find((item) => item.code === 'RUBRIC_COMMUNICATION');
  assert.equal(communication?.status, 'not_assessable', '沟通项整项记无法评价');
  assert.equal(communication?.score, 0, '下一步表述仅过程反馈，不伪装能力分');
  assert.equal(report.abilities.communication, 0, '沟通维度不得能力分');
  assert.ok(communication?.detail.includes('过程反馈'), '过程反馈写入说明待教师复核');
  // C-观察与报告-04：可评价满分持久化（与前端展示同源）——沟通项排除出计分与适用满分
  assert.equal(report.assessableMaxScore, 90, '可评价满分=适用计分项满分之和（排除无法评价的沟通项 10 分）');
  assert.equal(report.unscored, undefined, '未评分标记仅在记未评分时持久化');
  assert.equal(isUnscoredReport(report), false, '存在可评价项不记未评分');
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

test('通用词堆砌负例：沟通项整项无法评价，不给沟通能力分', () => {
  const session = createInitialSession('student-1', 'guided');
  session.communication = '理解 担心 检查 复查 监测 观察 处置 病情';
  const report = buildReport(session, 'report-word-stuffing');
  const communication = report.evidence.find((item) => item.code === 'RUBRIC_COMMUNICATION');
  assert.equal(communication?.status, 'not_assessable', '通用词堆砌整项记无法评价，不进适用满分');
  assert.equal(communication?.score, 0, '下一步通用词仅过程反馈，不给能力分');
  assert.ok(communication?.detail.includes('过程反馈'), '过程反馈写入说明待教师复核');
  assert.equal(report.abilities.communication, 0);
  assert.equal(report.totalScore, Object.values(report.abilities).reduce((sum, value) => sum + value, 0), '总分=分项之和');
});

test('查体专项负例：仅操作点击不足以评价结果识别，EX_FINDINGS 记无法评价', () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  session.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2', 'EX_TEMP', 'EX_MOUTH'];
  const report = buildReport(session, 'report-exam-clicks');
  assert.equal(report.rubricId, 'rubric-focused-exam');
  // C-观察与报告-04（量表 v5）：提交通道已开放但未提交时，点击仅为过程证据，结果识别无法评价
  assert.equal(report.rubricVersion, 5, '查体专项量表升级 v5');
  const findings = report.evidence.find((item) => item.code === 'RUBRIC_EX_FINDINGS');
  assert.equal(findings?.status, 'not_assessable', '未提交观察时结果识别记无法评价（提交通道已开放，无专业审核判据）');
  assert.equal(findings?.score, 0);
  assert.equal(report.assessableMaxScore, 80, '可评价满分排除无法评价的结果识别项（20 分）');
  assert.equal(report.totalScore, Object.values(report.abilities).reduce((sum, value) => sum + value, 0), '总分=分项之和（不含无法评价项分）');
});

test('查体专项提交入口实证：SUBMIT_DECISION 不在 allowedActions，服务端拒绝', async () => {
  // 评分层 EX_FINDINGS「恒不可评价」的前提实证（v5）：查体专项已开放观察/解释提交
  // （SUBMIT_EXAM_OBSERVATION，见下方正例链），但诊断通道仍关闭——学生不能经 API 直接
  // 提交 decision（服务端事件门控，不依赖前端隐藏）；观察提交不做结果识别计分。
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  await assert.rejects(
    () => runAgentTurn(session, { type: 'SUBMIT_DECISION', data: { diagnosis: '肺炎', summary: '发热咳嗽伴气促', diagnosisBasis: '听诊呼吸音粗', differentials: '' } }, 'exam-decision-rejected'),
    /PRACTICE_EVENT_FORBIDDEN/,
  );
  assert.ok(!session.decision, '拒绝后无诊断提交，评分层不存在可评价的观察文本');
});

test('查体专项负例：直改 decision（异常路径）也不得分，EX_FINDINGS 恒无法评价', () => {
  // C-评分补验-03：删除直改 decision 的核对计分支路（原「一致 achieved / 否定 incorrect」
  // 三分支测试为伪业务通过路径——生产路径无观察/推理提交通道，服务端门控见上方实证测试，
  // 该支路仅测试直改数据可触达，保留等于「绕过门控反而可得分」）。按真实门控，
  // 无论会话是否存在 decision 或观察提交，本项恒记无法评价；观察/解释提交已开放（v5）
  // 但缺少专业审核判据，机器不对提交文本做结果识别计分，待教师结合查体记录与提交原文复核。
  const tampered = createInitialSession('student-1', 'practice', undefined, 'exam');
  tampered.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2'];
  tampered.events.push({
    id: 'ev-exam-tampered',
    clientEventId: 'ce-exam-tampered',
    type: 'EXAM_ACTION',
    stage: 'exam',
    summary: '肺部听诊：双侧呼吸音粗，右下肺可闻及细湿啰音',
    correct: true,
    evidenceCodes: ['EX_RESP'],
    createdAt: new Date().toISOString(),
  });
  tampered.decision = { diagnosis: '肺炎', summary: '听诊双肺呼吸音粗，右下肺闻及湿啰音', diagnosisBasis: '呼吸音粗伴湿啰音', differentials: '' };
  const report = buildReport(tampered, 'report-exam-tampered');
  const findings = report.evidence.find((item) => item.code === 'RUBRIC_EX_FINDINGS');
  assert.equal(findings?.status, 'not_assessable', '即使异常路径存在提交文本，结果识别仍恒无法评价（计分支路已删除）');
  assert.equal(findings?.score, 0, '不因直改数据给结果识别能力分');
  assert.ok(!report.improvements.includes('结果识别'), '无法评价项不列为重点改进');
});

test('沟通专项：质量项记无法评价+候选证据；可验证项按否定守卫计分', () => {
  const polite = createInitialSession('student-1', 'practice', undefined, 'communication');
  polite.communication = '您放心，慢慢来，别紧张，辛苦了。';
  const politeReport = buildReport(polite, 'report-comm-polite');
  assert.equal(politeReport.rubricVersion, 4);
  for (const code of ['RUBRIC_CM_CONCERN_RESPONSE', 'RUBRIC_CM_PLAIN_EXPLANATION', 'RUBRIC_CM_UNDERSTANDING_CHECK', 'RUBRIC_CM_NEXT_STEPS', 'RUBRIC_CM_RESPECTFUL_TONE']) {
    assert.equal(politeReport.evidence.find((item) => item.code === code)?.status, 'not_assessable', `${code} 应记无法评价`);
  }
  assert.equal(politeReport.totalScore, 0, '无可评价沟通内容时不授予沟通质量分');
  assert.equal(politeReport.totalScore, Object.values(politeReport.abilities).reduce((sum, value) => sum + value, 0));

  const content = createInitialSession('student-1', 'practice', undefined, 'communication');
  content.communication = '我理解您担心。孩子目前呼吸和血氧有风险，我们先吸氧监测，下一步复查血氧。您明白吗？别担心，我们陪孩子一起。';
  const contentReport = buildReport(content, 'report-comm-content');
  const byCode = (code: string) => contentReport.evidence.find((item) => item.code === code);
  // C-评分补验-03（量表 v4）：沟通专项全项不可评价口径——质量项（回应顾虑/通俗解释/尊重表达）
  // 命中仅记候选证据；可验证项（核实理解/后续安排）因表述真实性无法可靠区分（长距离否定/
  // 前后矛盾可满分）取消词命中计分，命中仅记过程反馈；五项均恒 not_assessable 0 分。
  assert.equal(byCode('RUBRIC_CM_CONCERN_RESPONSE')?.status, 'not_assessable', '回应顾虑为质量项，记无法评价待教师复核');
  assert.equal(byCode('RUBRIC_CM_CONCERN_RESPONSE')?.score, 0);
  assert.ok(byCode('RUBRIC_CM_CONCERN_RESPONSE')?.detail.includes('候选证据'), '候选证据写入说明');
  assert.equal(byCode('RUBRIC_CM_PLAIN_EXPLANATION')?.status, 'not_assessable', '通俗解释为质量项，不再关键词命中即满分');
  assert.equal(byCode('RUBRIC_CM_PLAIN_EXPLANATION')?.score, 0);
  assert.ok(byCode('RUBRIC_CM_PLAIN_EXPLANATION')?.detail.includes('候选证据'), '候选证据写入说明');
  assert.equal(byCode('RUBRIC_CM_UNDERSTANDING_CHECK')?.status, 'not_assessable', '核实理解表述真实性不可靠区分，记无法评价');
  assert.equal(byCode('RUBRIC_CM_UNDERSTANDING_CHECK')?.score, 0);
  assert.ok(byCode('RUBRIC_CM_UNDERSTANDING_CHECK')?.detail.includes('过程反馈'), '核实理解命中记过程反馈');
  assert.equal(byCode('RUBRIC_CM_NEXT_STEPS')?.status, 'not_assessable', '后续安排表述真实性不可靠区分，记无法评价');
  assert.equal(byCode('RUBRIC_CM_NEXT_STEPS')?.score, 0);
  assert.ok(byCode('RUBRIC_CM_NEXT_STEPS')?.detail.includes('过程反馈'), '后续安排命中记过程反馈');
  assert.equal(byCode('RUBRIC_CM_RESPECTFUL_TONE')?.status, 'not_assessable', '尊重表达为质量项，记无法评价待教师复核');
  assert.equal(byCode('RUBRIC_CM_RESPECTFUL_TONE')?.score, 0);
  assert.equal(contentReport.totalScore, 0, '沟通专项 v4 全项不可评价，不给能力分、不进适用满分');
  assert.equal(contentReport.totalScore, Object.values(contentReport.abilities).reduce((sum, value) => sum + value, 0));
  assert.ok(contentReport.studentSubmissions?.communication, '沟通原文保留在报告快照供教师复核');
});

test('沟通专项负例：长距离否定与前后矛盾表述不得能力分（全项不可评价口径）', () => {
  // C-评分补验-03（量表 v4）：长距离否定（句首肯定、词前否定，前三字守卫不可靠）与
  // 前后矛盾表述无法机器可靠区分，取消词命中计分后本类文本不再可能得能力分——
  // 表述命中仅记候选/过程反馈，全项恒不可评价、不进适用满分。
  const session = createInitialSession('student-1', 'practice', undefined, 'communication');
  session.communication = '孩子病情稳定，我们需要复查监测处理，不过其实不需要复查，也不用监测，您明白吗？也不用明白，下一步先观察吧但暂时不做任何处理。';
  const report = buildReport(session, 'report-comm-contradictory');
  const nextSteps = report.evidence.find((item) => item.code === 'RUBRIC_CM_NEXT_STEPS');
  const understanding = report.evidence.find((item) => item.code === 'RUBRIC_CM_UNDERSTANDING_CHECK');
  assert.equal(nextSteps?.status, 'not_assessable', '前后矛盾的后续安排表述不得能力分');
  assert.equal(nextSteps?.score, 0);
  assert.equal(understanding?.status, 'not_assessable', '长距离否定的核实理解表述不得能力分');
  assert.equal(understanding?.score, 0);
  assert.equal(report.totalScore, 0, '全项不可评价 → 不给能力分');
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
  assert.equal(findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 4 })?.version, 4, '当前报告命中当前版本');
  assert.equal(findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 3 })?.version, 3, 'v3 历史报告命中 v3 冻结定义');
  assert.equal(findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 2 })?.version, 2, 'v2 历史报告命中 v2 冻结定义');
  assert.equal(findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 1 })?.version, 1, 'v1 历史报告命中 v1 冻结定义');
  const v1Comm = findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 1 })?.items.find((item) => item.itemId === 'COMMUNICATION');
  assert.ok(v1Comm?.evidenceRule.includes('共情 3 分'), 'v1 规则文本冻结不漂移，不套用 v4 解释');
  const v3Comm = findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 3 })?.items.find((item) => item.itemId === 'COMMUNICATION');
  assert.ok(v3Comm?.evidenceRule.includes('3 分'), 'v3 规则文本冻结不漂移，不套用 v4 整项不可评价解释');
  const v3NextSteps = findRubricForReport({ rubricId: 'rubric-focused-communication', rubricVersion: 3 })?.items.find((item) => item.itemId === 'CM_NEXT_STEPS');
  assert.ok(v3NextSteps?.evidenceRule.includes('否定表述不计'), 'communication v3 冻结文本不套用 v4 全项不可评价口径');
  const v3Findings = findRubricForReport({ rubricId: 'rubric-focused-exam', rubricVersion: 3 })?.items.find((item) => item.itemId === 'EX_FINDINGS');
  assert.ok(v3Findings?.evidenceRule.includes('可靠核对'), 'exam v3 冻结文本保留防御核对规则原文');
  assert.equal(findRubricForReport({ rubricId: 'rubric-focused-communication', rubricVersion: 4 })?.version, 4, '沟通专项 v4 当前版本精确命中');
  assert.equal(findRubricForReport({ rubricId: 'rubric-focused-exam', rubricVersion: 5 })?.version, 5, '查体专项 v5 当前版本精确命中');
  const v4Findings = findRubricForReport({ rubricId: 'rubric-focused-exam', rubricVersion: 4 })?.items.find((item) => item.itemId === 'EX_FINDINGS');
  assert.ok(v4Findings?.evidenceRule.includes('未开放观察/推理提交入口'), 'exam v4 冻结文本不套用 v5 提交已开口径');
  const v2Findings = findRubricForReport({ rubricId: 'rubric-focused-exam', rubricVersion: 2 })?.items.find((item) => item.itemId === 'EX_FINDINGS');
  assert.ok(v2Findings?.evidenceRule.includes('≥2 项'), 'exam v2 规则文本冻结，不套用新解释');
  assert.equal(findRubricForReport({ rubricId: 'rubric-focused-communication', rubricVersion: 1 })?.version, 1);
  assert.equal(findRubricForReport({ rubricId: 'rubric-focused-communication', rubricVersion: 2 })?.version, 2);
  assert.equal(findRubricForReport({ rubricId: 'rubric-clinical-flagship', rubricVersion: 99 }), undefined, '未存档版本明确缺失，不回退当前量表');
  assert.equal(findRubricForReport({}), undefined, '无量表元数据的历史报告返回 undefined（展示层降级）');
});

// C-观察与报告-04 回归：查体专项观察/解释提交链（真实引擎事件入口，客户端不自报得分或解锁事实）。
test('查体观察提交正例：真实引擎入口解锁查体证据后保存提交与关联定位符，修订/幂等与快照回放', async () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  assert.equal(session.scenarioVersion, 6, '会话创建时冻结配置版本（C-关联与验收-05 升级 v6）');
  // 真实事件解锁查体证据（不直改 unlockedEvidence）
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'obs-prep');
  const lung = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'obs-lung');
  assert.ok(session.unlockedEvidence.includes('EX_PREP'));
  assert.ok(session.unlockedEvidence.includes('EX_RESP'));
  const lungEvent = lung.session.events.filter((event) => event.type === 'EXAM_ACTION').at(-1);
  assert.ok(lungEvent, '肺部听诊事件入事件链');
  const submitted = await runAgentTurn(
    session,
    { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '双肺呼吸音对称，右下肺可闻及细湿啰音。', interpretation: '局部湿啰音提示肺实质病变可能。', linkedEvidence: ['EX_RESP'] } },
    'obs-submit-1',
  );
  assert.equal(submitted.session.examObservation?.findings, '双肺呼吸音对称，右下肺可闻及细湿啰音。');
  assert.equal(submitted.session.examObservation?.interpretation, '局部湿啰音提示肺实质病变可能。');
  // 关联定位符（服务端核验产物）：关联码去重、锚定本会话原查体事件 id、冻结病例绑定版本与提交时间
  assert.deepEqual(submitted.session.examObservation?.linkedEvidence, ['EX_RESP'], '关联码按提交声明保存');
  assert.ok(submitted.session.examObservation?.linkedEventIds.includes(lungEvent.id), '关联锚定本会话真实肺部听诊事件');
  assert.equal(submitted.session.examObservation?.caseVersion, session.caseVersion, '病例版本取会话绑定版本');
  assert.ok(submitted.session.examObservation?.submittedAt, '提交时间随快照保存');
  assert.equal(submitted.session.events.filter((event) => event.type === 'SUBMIT_EXAM_OBSERVATION').length, 1, '提交事件入事件链');
  assert.ok(submitted.session.events.filter((event) => event.type === 'SUBMIT_EXAM_OBSERVATION').every((event) => event.summary.includes('EX_RESP')), '事件摘要记录关联项定位符');
  // 序列化保存恢复：examObservation 含关联定位符/事件锚定整体序列化，JSON 往返后字段一致
  const restored = JSON.parse(JSON.stringify(submitted.session)) as typeof submitted.session;
  assert.deepEqual(restored.examObservation?.linkedEvidence, ['EX_RESP'], '序列化往返关联码一致');
  assert.deepEqual(restored.examObservation?.linkedEventIds, submitted.session.examObservation?.linkedEventIds, '序列化往返关联事件锚定一致');
  assert.equal(restored.examObservation?.caseVersion, submitted.session.examObservation?.caseVersion, '序列化往返病例版本一致');
  assert.equal(restored.examObservation?.findings, submitted.session.examObservation?.findings, '序列化往返原文一致');
  // 修订重交：新幂等键覆盖 examObservation；事件链保留每次提交的发生与关联项记录（不存全文，最终原文冻结在快照）
  const revised = await runAgentTurn(
    submitted.session,
    { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '修订：右下肺细湿啰音，双肺呼吸音对称，无哮鸣音。', linkedEvidence: ['EX_RESP'] } },
    'obs-submit-2',
  );
  assert.equal(revised.session.examObservation?.findings, '修订：右下肺细湿啰音，双肺呼吸音对称，无哮鸣音。');
  assert.equal(revised.session.examObservation?.interpretation, null, '重交未带解释时保存为空');
  assert.equal(revised.session.events.filter((event) => event.type === 'SUBMIT_EXAM_OBSERVATION').length, 2, '事件链保留全部提交记录');
  // 幂等：重复幂等键忽略，不覆盖已保存提交
  const duplicate = await runAgentTurn(
    revised.session,
    { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '重复事件不得覆盖已保存提交。', linkedEvidence: ['EX_RESP'] } },
    'obs-submit-2',
  );
  assert.equal(duplicate.session.examObservation?.findings, '修订：右下肺细湿啰音，双肺呼吸音对称，无哮鸣音。');
  assert.equal(duplicate.session.events.filter((event) => event.type === 'SUBMIT_EXAM_OBSERVATION').length, 2, '幂等键重复不加事件');
  // 报告回放：最终提交与关联定位符冻结进快照，EX_FINDINGS 恒无法评价但证据可回放
  const report = buildReport(revised.session, 'report-exam-observation');
  assert.equal(report.rubricVersion, 5);
  assert.equal(report.studentSubmissions?.examObservation?.findings, '修订：右下肺细湿啰音，双肺呼吸音对称，无哮鸣音。');
  assert.deepEqual(report.studentSubmissions?.examObservation?.linkedEvidence, ['EX_RESP'], '报告快照回放关联定位符');
  assert.ok(report.studentSubmissions?.examObservation?.linkedEventIds.includes(lungEvent.id), '报告快照回放原查体事件锚定');
  assert.equal(report.studentSubmissions?.examObservation?.caseVersion, revised.session.caseVersion, '报告快照回放病例绑定版本');
  const findings = report.evidence.find((item) => item.code === 'RUBRIC_EX_FINDINGS');
  assert.equal(findings?.status, 'not_assessable', '无专业审核判据，已提交仍恒无法评价');
  assert.equal(findings?.score, 0);
  assert.ok(findings?.detail.includes('已收到查体观察/解释提交'), '提交事实写入过程反馈');
  assert.ok((findings?.eventIds.length ?? 0) >= 1, 'EX_FINDINGS 关联提交事件可回放');
  assert.ok(!report.improvements.includes('结果识别'), '无法评价项不列为重点改进');
  assert.equal(report.assessableMaxScore, 80, 'EX_FINDINGS 排除出可评价满分');
  assert.equal(report.unscored, undefined, '未评分标记仅在记未评分时持久化');
  assert.equal(isUnscoredReport(report), false, '存在可评价项不记未评分');
});

test('查体观察提交负例：未完成任何查体操作时拒绝（EXAM_EVIDENCE_REQUIRED）', async () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  // provided 病史不算已解锁查体证据：凭空观察提交（哪怕伪造关联码）被服务端拒绝
  assert.ok(!session.unlockedEvidence.some((code) => code.startsWith('EX_')));
  await assert.rejects(
    () => runAgentTurn(session, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '未做任何查体就编造观察结果。', linkedEvidence: ['EX_RESP'] } }, 'obs-no-evidence'),
    /EXAM_EVIDENCE_REQUIRED/,
  );
  assert.ok(!session.examObservation, '拒绝后不保存观察提交');
  assert.ok(!session.events.some((event) => event.type === 'SUBMIT_EXAM_OBSERVATION'), '拒绝后无提交事件');
});

test('查体观察提交负例：仅完成准备动作（无结果项）拒绝（EXAM_EVIDENCE_REQUIRED）', async () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  // C-关联与验收-05 缺口修正回归：EX_PREP 属准备动作而非临床所见，仅手卫生不足以关联观察
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'prep-only-1');
  assert.ok(session.unlockedEvidence.includes('EX_PREP'));
  await assert.rejects(
    () => runAgentTurn(session, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '仅完成手卫生就声称有观察所见。', linkedEvidence: ['EX_PREP'] } }, 'prep-only-submit'),
    /EXAM_EVIDENCE_REQUIRED/,
  );
  assert.ok(!session.examObservation, '准备项不得作为观察关联锚点');
});

test('查体观察提交负例：关联定位符核验失败拒绝（伪造未获得/准备/系统提供项）', async () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'link-prep');
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'link-lung');
  // 伪造未获得的查体项码：服务端按原查体事件与解锁结果核验，不信任客户端自报
  await assert.rejects(
    () => runAgentTurn(session, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '伪造关联未做过的口腔检查结果。', linkedEvidence: ['EX_MOUTH'] } }, 'link-forged'),
    /EXAM_EVIDENCE_NOT_OBTAINED/,
  );
  // 准备项（EX_PREP）与系统提供项（EX_PROVIDED）非学生获得的临床所见，不得作为关联定位符
  await assert.rejects(
    () => runAgentTurn(session, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '把准备动作当临床所见锚定观察。', linkedEvidence: ['EX_PREP'] } }, 'link-prep-claim'),
    /EXAM_EVIDENCE_NOT_OBTAINED/,
  );
  await assert.rejects(
    () => runAgentTurn(session, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '把系统提供项当自己获得的所见锚定。', linkedEvidence: ['EX_PROVIDED'] } }, 'link-provided-claim'),
    /EXAM_EVIDENCE_NOT_OBTAINED/,
  );
  assert.ok(!session.examObservation, '核验失败不保存提交');
  assert.ok(!session.events.some((event) => event.type === 'SUBMIT_EXAM_OBSERVATION'), '核验失败无提交事件');
});

test('查体观察提交负例：关联定位符缺失或为空拒绝（EXAM_OBSERVATION_LINK_REQUIRED）', async () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'empty-link-prep');
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'empty-link-lung');
  // schema 之外的引擎级第二道防线：直调引擎（空数组）同样拒绝无关联泛化提交
  await assert.rejects(
    () => runAgentTurn(session, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '不声明任何关联的泛化观察提交。', linkedEvidence: [] } }, 'empty-link-submit'),
    /EXAM_OBSERVATION_LINK_REQUIRED/,
  );
  assert.ok(!session.examObservation, '无关联提交不保存');
});

test('查体观察提交负例：旧配置/未版本化会话拒绝（SCENARIO_VERSION_MISMATCH）', async () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'ver-prep');
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'ver-lung');
  session.scenarioVersion = 4; // 旧配置会话（v4 未定义关联契约）：不借新配置解释旧会话、不静默升级
  await assert.rejects(
    () => runAgentTurn(session, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '旧配置会话提交观察内容。', linkedEvidence: ['EX_RESP'] } }, 'ver-submit'),
    /SCENARIO_VERSION_MISMATCH/,
  );
  assert.ok(!session.examObservation, '版本不符拒绝后不保存提交');
  // C-关联与验收-05 缺口修正回归：scenarioVersion 缺失（早于版本化的历史会话）同样明确拒绝
  const legacy = createInitialSession('student-1', 'practice', undefined, 'exam');
  await runAgentTurn(legacy, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'ver-legacy-prep');
  await runAgentTurn(legacy, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'ver-legacy-lung');
  legacy.scenarioVersion = undefined;
  await assert.rejects(
    () => runAgentTurn(legacy, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '未版本化历史会话提交观察内容。', linkedEvidence: ['EX_RESP'] } }, 'ver-legacy-submit'),
    /SCENARIO_VERSION_MISMATCH/,
  );
  assert.ok(!legacy.examObservation, '未版本化会话拒绝后不保存提交');
});

test('查体观察提交负例：跨专项/OSCE/引导模式均拒绝（服务端门控）', async () => {
  const history = createInitialSession('student-1', 'practice', undefined, 'history');
  await assert.rejects(
    () => runAgentTurn(history, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '病史采集专项不允许查体提交。', linkedEvidence: ['EX_RESP'] } }, 'x-history'),
    /PRACTICE_EVENT_FORBIDDEN/,
  );
  assert.ok(!history.examObservation);
  const osce = createInitialSession('student-1', 'osce');
  await assert.rejects(
    () => runAgentTurn(osce, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: 'OSCE 模拟站不开放专项提交。', linkedEvidence: ['EX_RESP'] } }, 'x-osce'),
    /OSCE_EVENT_STAGE_FORBIDDEN/,
  );
  // 引导模式事件-阶段门控不拦截（自由探索），由引擎归属门控纵深防御拒绝
  const guided = createInitialSession('student-1', 'guided');
  await assert.rejects(
    () => runAgentTurn(guided, { type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '引导模式同样不允许提交。', linkedEvidence: ['EX_RESP'] } }, 'x-guided'),
    /EXAM_OBSERVATION_FORBIDDEN/,
  );
  assert.ok(!guided.examObservation, '拒绝后不保存提交');
});

test('查体观察提交 schema：过短观察/缺失关联/自报得分或解锁字段拒绝，合法提交通过', () => {
  const payload = (data: unknown) => ({
    sessionId: '11111111-1111-4111-8111-111111111111',
    clientEventId: 'obs-schema-check',
    event: { type: 'SUBMIT_EXAM_OBSERVATION', data },
  });
  assert.ok(!agentTurnSchema.safeParse(payload({ findings: '太短' })).success, '观察少于 10 字拒绝');
  assert.ok(!agentTurnSchema.safeParse(payload({ findings: '合格的观察文本长度。', score: 20 })).success, 'strict：客户端不得自报得分字段');
  assert.ok(!agentTurnSchema.safeParse(payload({ findings: '合格的观察文本长度。', unlockedEvidence: ['EX_RESP'] })).success, 'strict：客户端不得自报解锁事实');
  // C-关联与验收-05：linkedEvidence 必填——缺失/空数组/非数组/空串元素均拒绝（语义核验在引擎层）
  assert.ok(!agentTurnSchema.safeParse(payload({ findings: '合格的观察文本长度。' })).success, '缺失关联定位符拒绝');
  assert.ok(!agentTurnSchema.safeParse(payload({ findings: '合格的观察文本长度。', linkedEvidence: [] })).success, '空关联数组拒绝');
  assert.ok(!agentTurnSchema.safeParse(payload({ findings: '合格的观察文本长度。', linkedEvidence: 'EX_RESP' })).success, '关联定位符须为数组');
  assert.ok(!agentTurnSchema.safeParse(payload({ findings: '合格的观察文本长度。', linkedEvidence: [''] })).success, '空串关联码拒绝');
  assert.ok(agentTurnSchema.safeParse(payload({ findings: '双肺呼吸音对称，右下肺闻及细湿啰音。', interpretation: '提示肺实质病变。', linkedEvidence: ['EX_RESP'] })).success, '合法提交通过');
});

// C-观察与报告-04 回归：未评分口径——全部计分项无法评价的报告不得以 0 分进入趋势统计。
test('未评分口径：全部计分项无法评价时持久化未评分与原因，同步事件记 null', () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'communication');
  const report = buildReport(session, 'report-unscored-communication');
  assert.equal(report.unscored, true, '沟通专项全项不可评价 → 报告记未评分');
  assert.ok(report.unscoredReason?.includes('未评分'), '未评分原因持久化');
  assert.ok(report.unscoredReason?.includes('不代表能力 0 分'), '明确总分 0 不代表能力 0 分');
  assert.equal(report.assessableMaxScore, 0, '可评价满分 0');
  assert.equal(report.totalScore, 0);
  assert.equal(isUnscoredReport(report), true, '未评分判定与持久化字段同源');
  // finish 路由同步事件口径：未评分报告 score 记 null（isUnscoredReport 为唯一判定源）
  assert.equal(isUnscoredReport(report) ? null : report.totalScore, null, '同步事件 score null');
  assert.equal(unscoredReasonForDisplay(report), report.unscoredReason, '展示原因读持久化字段，不重算');
});

test('未评分口径：历史报告无 unscored 字段时按快照推导，仅分类展示不重算', () => {
  const unscored = buildReport(createInitialSession('student-1', 'practice', undefined, 'communication'), 'r-legacy-unscored');
  // 模拟本口径之前生成的历史报告：无 unscored/unscoredReason 字段，evidence 带状态快照
  const legacyUnscored = { evidence: unscored.evidence };
  assert.equal(isUnscoredReport(legacyUnscored), true, '全不可评价快照推导为未评分（不进趋势统计）');
  assert.ok(unscoredReasonForDisplay(legacyUnscored).includes('无法评价'), '推导原因说明缺少判据');
  // 方案 4.4 之前的报告 evidence 无 status 字段：undefined 不满足全不可评价，按可计分处理
  const legacyNoStatus = { evidence: [{ code: 'RUBRIC_SAFETY', label: '安全', achieved: true, score: 15, maxScore: 15, detail: '', eventIds: [] }] };
  assert.equal(isUnscoredReport(legacyNoStatus), false, '无状态历史报告不误标未评分');
  assert.equal(isUnscoredReport({ evidence: [] }), false, '空 evidence（过程分）不标未评分');
});

test('趋势隔离：未评分报告不进平均分/最好成绩统计（函数层口径）', () => {
  // C-关联与验收-05 口径标注：本测试仅覆盖函数层 isUnscoredReport 过滤（报告列表页/教师端趋势
  // 共用该口径）；报告列表页与教师端真实 HTTP 展示属阶段 D 待验收范围，本测试不构成页面层证据。
  const scoredSession = createInitialSession('student-1', 'practice', undefined, 'exam');
  scoredSession.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2'];
  const scored = buildReport(scoredSession, 'report-trend-scored');
  const unscored = buildReport(createInitialSession('student-1', 'practice', undefined, 'communication'), 'report-trend-unscored');
  assert.ok(scored.totalScore > 0);
  // 报告列表页/教师端趋势共用 isUnscoredReport 过滤口径（评分快照与前端展示同源）
  const reports = [scored, unscored];
  const scoredReports = reports.filter((item) => !isUnscoredReport(item));
  assert.equal(scoredReports.length, 1, '未评分报告排除出趋势统计');
  const average = scoredReports.reduce((sum, item) => sum + item.totalScore, 0) / scoredReports.length;
  const naiveAverage = reports.reduce((sum, item) => sum + item.totalScore, 0) / reports.length;
  assert.notEqual(average, naiveAverage, '未评分 0 分若混入将拉低平均分');
  assert.equal(average, scored.totalScore, '平均分只按可评分报告计算');
  assert.equal(Math.max(...scoredReports.map((item) => item.totalScore)), scored.totalScore, '最好成绩不受未评分 0 分影响');
});
