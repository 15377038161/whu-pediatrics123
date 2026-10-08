import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { CASE_CATALOG } from '@/domain/case-catalog';
import { getCase } from '@/domain/case';
import { buildReport } from '@/lib/scoring';

process.env.ENABLE_AI_FIXTURE = 'true';

test('动态问诊按问题意图选择回答者，且不提前泄露隐藏接触史', async () => {
  const session = createInitialSession('student-1', 'guided');
  const onset = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '什么时候开始发热咳嗽的？' } }, 'event-onset');
  assert.ok(onset.session.askedIntents.includes('onset'));
  assert.ok(onset.session.askedIntents.includes('fever'));
  assert.equal(onset.session.behavior.hiddenExposureRevealed, false);
  assert.ok(onset.newMessages.some((message) => message.actor === 'child'));
  assert.ok(onset.newMessages.some((message) => message.actor === 'parent'));

  const exposure = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '幼儿园同学最近有类似症状吗？' } }, 'event-exposure');
  assert.equal(exposure.session.behavior.hiddenExposureRevealed, true);
  assert.ok(exposure.session.unlockedEvidence.includes('HX_EXPOSURE'));
});

test('一轮复合问题可以解锁多个明确问诊意图', async () => {
  const session = createInitialSession('student-1', 'guided');
  const result = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '什么时候开始气促？嘴唇有没有青紫？' } }, 'event-compound');
  assert.ok(result.session.askedIntents.includes('onset'));
  assert.ok(result.session.askedIntents.includes('danger'));
  assert.ok(result.session.unlockedEvidence.includes('HX_DANGER'));
});

test('医生干预改变家长插话和患儿情绪状态', async () => {
  const session = createInitialSession('student-1', 'guided');
  await runAgentTurn(session, { type: 'DOCTOR_INTERVENTION', data: { action: 'pause_parent' } }, 'event-pause');
  assert.equal(session.parentInterruption, 'paused');
  const result = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '最高体温是多少？' } }, 'event-fever');
  assert.equal(result.newMessages.some((message) => message.actor === 'parent'), false);
  await runAgentTurn(session, { type: 'DOCTOR_INTERVENTION', data: { action: 'comfort_child' } }, 'event-comfort');
  assert.equal(session.childEmotion, 'calm');
  assert.ok(session.behavior.cooperation > 35);
});

test('学生说出的沟通干预可被自然语言识别并保留原话', async () => {
  const session = createInitialSession('student-1', 'guided');
  const pauseText = '家长先不要补充，我想先听孩子说。';
  const paused = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: pauseText } }, 'event-spoken-pause');
  assert.equal(paused.session.parentInterruption, 'paused');
  assert.equal(paused.newMessages[0].content, pauseText);
  assert.equal(paused.newMessages[1].actor, 'parent');

  const comfortText = '小朋友别紧张，慢慢说，我会陪着你。';
  const comforted = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: comfortText } }, 'event-spoken-comfort');
  assert.equal(comforted.session.childEmotion, 'calm');
  assert.equal(comforted.newMessages[0].content, comfortText);
  assert.equal(comforted.newMessages[1].actor, 'child');
});

test('同一句安抚与临床追问会同时更新患儿状态并解锁问诊事实', async () => {
  const session = createInitialSession('student-1', 'guided');
  const result = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '小朋友别紧张，慢慢告诉我什么时候开始咳嗽的？' } }, 'event-spoken-combined');
  assert.equal(result.session.childEmotion, 'calm');
  assert.ok(result.session.askedIntents.includes('onset'));
  assert.ok(result.session.askedIntents.includes('cough'));
  assert.ok(result.session.events.at(-1)?.evidenceCodes.includes('COMM_INTERVENTION'));
});

test('查体必须同时满足准备动作、器材和部位', async () => {
  const session = createInitialSession('student-1', 'guided');
  const blocked = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'event-blocked');
  assert.equal(blocked.session.unlockedEvidence.includes('EX_RESP'), false);
  assert.match(blocked.feedback ?? '', /手卫生|必要准备/);

  const mismatch = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'thermometer', bodyPartId: 'chest' } }, 'event-mismatch');
  assert.equal(mismatch.session.events.at(-1)?.correct, false);
  assert.equal(mismatch.newMessages.length, 0);

  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'event-hygiene');
  const success = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'event-lung');
  assert.ok(success.session.unlockedEvidence.includes('EX_RESP'));
  assert.match(success.newMessages[0].content, /右下肺/);
});

test('相同 clientEventId 按幂等规则忽略', async () => {
  const session = createInitialSession('student-1', 'guided');
  await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '精神和吃饭怎么样？' } }, 'same-event');
  const eventCount = session.events.length;
  const duplicate = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '精神和吃饭怎么样？' } }, 'same-event');
  assert.equal(session.events.length, eventCount);
  assert.equal(duplicate.newMessages.length, 0);
});

test('OSCE 模式隐藏提示并允许阶段自由导航', async () => {
  const session = createInitialSession('student-1', 'osce');
  const question = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '你哪里不舒服？' } }, 'event-open');
  assert.equal(question.feedback, null);
  await runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'exam' } }, 'event-forward');
  const back = await runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'history' } }, 'event-back');
  assert.equal(back.session.stage, 'history');
});

test('训练模式把家长沟通留在会话中心并允许查体后继续问诊', async () => {
  const session = createInitialSession('student-1', 'guided');
  await runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'exam' } }, 'conversation-exam');
  const returned = await runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'history' } }, 'conversation-return');
  assert.equal(returned.session.stage, 'history');

  const communicated = await runAgentTurn(session, { type: 'SEND_COMMUNICATION', data: { text: '我理解您很担心，孩子目前呼吸和血氧有风险，我们先监测处理，再告诉您下一步。' } }, 'conversation-explain');
  assert.equal(communicated.session.stage, 'history');
  assert.ok(communicated.session.unlockedEvidence.includes('COMMUNICATION'));
  assert.equal(communicated.newMessages.at(-1)?.actor, 'parent');
});

test('OSCE 沟通复用会话并允许阶段自由导航', async () => {
  const session = createInitialSession('student-1', 'osce');
  const communicated = await runAgentTurn(session, { type: 'SEND_COMMUNICATION', data: { text: '我理解您担心，我们先处理呼吸和血氧风险，再说明下一步检查。' } }, 'osce-communication');
  assert.equal(communicated.session.stage, 'communication');
  const back = await runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'history' } }, 'osce-conversation-back');
  assert.equal(back.session.stage, 'history');
});

test('女童病例使用独立病例版本、应答事实与查体结果', async () => {
  const session = createInitialSession('student-1', 'guided', 'peds-wheeze-002');
  assert.equal(session.caseId, 'peds-wheeze-002');
  assert.equal(session.vitals.temperature, 38.1);
  assert.match(session.messages[1].content, /呼呼响/);

  await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '以前有没有喘息或过敏？' } }, 'female-hx-001');
  assert.ok(session.askedIntents.includes('allergy'));
  assert.match(session.messages.at(-1)?.content ?? '', /喘息|过敏性鼻炎/);

  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'female-exam-001');
  const result = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'female-exam-002');
  assert.match(result.newMessages[0].content, /哮鸣音/);
});

test('专项训练会话保留明确训练重点', () => {
  const session = createInitialSession('student-1', 'practice', 'peds-respiratory-001', 'communication');
  assert.equal(session.mode, 'practice');
  assert.equal(session.practiceFocus, 'communication');
});

test('沉浸式会话保留统一病例内核并初始化场景状态', () => {
  const session = createInitialSession('student-1', 'immersive');
  assert.equal(session.mode, 'immersive');
  assert.equal(session.immersive?.scene, 'arrival');
  assert.deepEqual(session.immersive?.visitedScenes, ['arrival']);
  assert.equal(session.expiresAt, null);
});

test('全部教师病例均可创建训练、沉浸式与OSCE会话', () => {
  const teacherCases = CASE_CATALOG.filter((item) => item.id.startsWith('teacher-'));
  assert.equal(teacherCases.length, 70);
  for (const item of teacherCases) {
    assert.equal(getCase(item.id).id, item.id);
    for (const mode of ['guided', 'immersive', 'osce'] as const) {
      const session = createInitialSession('student-1', mode, item.id);
      assert.equal(session.caseId, item.id);
      assert.equal(session.mode, mode);
      assert.ok(session.caseOptions);
    }
  }
});

test('历史占位会话升级后清理肺炎事实，并采用过程记录报告', async () => {
  const legacy = createInitialSession('student-1', 'guided');
  legacy.caseId = 'teacher-支气管哮喘';
  legacy.askedIntents = ['danger'];
  legacy.unlockedEvidence = ['EX_RESP', 'EX_SPO2'];
  const result = await runAgentTurn(legacy, { type: 'FINISH_SESSION', data: {} }, 'legacy-finish');
  assert.equal(result.session.status, 'completed');
  assert.equal(result.session.caseVersion, 2);
  assert.deepEqual(result.session.askedIntents, []);
  assert.equal(result.session.unlockedEvidence.includes('EX_SPO2'), false);
  const report = buildReport(legacy);
  assert.equal(report.scoreBasis, 'process');
  assert.equal(report.abilities.examination, 0);
  assert.equal(report.evidence.some((item) => item.code === 'RUBRIC_SAFETY'), false);
});

test('教师病例处置不会统一改善血氧，缺资料病种不编造问诊事实', async () => {
  const session = createInitialSession('student-1', 'guided', 'teacher-新生儿脑梗死');
  assert.deepEqual(session.vitals, { temperature: null, heartRate: null, respiratoryRate: null, spo2: null });
  const question = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '什么时候开始发烧？' } }, 'missing-source-question');
  assert.ok(question.newMessages.some((message) => message.content.includes('说不清楚')));
  assert.deepEqual(question.session.askedIntents, []);
  await runAgentTurn(session, { type: 'SUBMIT_PLAN', data: { priority: '吸氧监测', detail: '结合资料进一步评估' } }, 'source-plan');
  assert.equal(session.vitals.spo2, null);
  assert.equal(session.events.find((event) => event.type === 'SUBMIT_PLAN')?.correct, null);
});

test('真实问诊可识别咳嗽特点与院前用药', async () => {
  const session = createInitialSession('student-1', 'guided');
  const result = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '孩子咳嗽有痰吗？在家吃过什么药？' } }, 'event-cough-treatment');
  assert.ok(result.session.askedIntents.includes('cough'));
  assert.ok(result.session.askedIntents.includes('treatment'));
  assert.match(result.newMessages.map((item) => item.content).join(''), /干咳|退热药/);
});
