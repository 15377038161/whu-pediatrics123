import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';

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

test('OSCE 模式隐藏提示并禁止阶段回退', async () => {
  const session = createInitialSession('student-1', 'osce');
  const question = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '你哪里不舒服？' } }, 'event-open');
  assert.equal(question.feedback, null);
  await runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'exam' } }, 'event-forward');
  await assert.rejects(() => runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'history' } }, 'event-back'), /OSCE_STAGE_BACKTRACK_FORBIDDEN/);
});
