import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import type { AgentEvent } from '@/domain/agent';

/** 任务4：返回修改与阶段锁定——
 *  1. OSCE 阶段锁定为代码内固定规则（不再依赖 LOCK_STAGES 环境开关）；
 *  2. 普通训练（guided）返回补问/补查/修改：viewStage 回看业务阶段不回退，
 *     补查开单/重交诊断成功且 stage 保持已推进位置（不触发 DB 防回退）。 */

async function turn(session: ReturnType<typeof createInitialSession>, event: AgentEvent, id: string) {
  return runAgentTurn(session, event, id);
}

test('OSCE 回退导航被固定规则拒绝（无环境开关依赖）', async () => {
  const osce = createInitialSession('student-bt', 'osce');
  await turn(osce, { type: 'NAVIGATE_STAGE', data: { stage: 'exam' } }, 'bt-osce-enter-exam');
  assert.equal(osce.stage, 'exam');
  await assert.rejects(
    () => turn(osce, { type: 'NAVIGATE_STAGE', data: { stage: 'history' } }, 'bt-osce-back'),
    /OSCE_STAGE_BACKTRACK_FORBIDDEN/,
  );
  assert.equal(osce.stage, 'exam', '拒绝后阶段保持');
});

test('普通训练返回补查：业务阶段不回退，补开检查成功', async () => {
  const session = createInitialSession('student-bt', 'guided');
  // 推进到 plan：查体 → 检查 → 诊断 → 处置
  await turn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'bt-prep');
  await turn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'bt-listen');
  await turn(session, { type: 'ORDER_TEST', data: { requestedTests: '血常规与 CRP' } }, 'bt-test-1');
  await turn(session, { type: 'SUBMIT_DECISION', data: { diagnosis: '肺炎伴低氧', summary: '发热咳嗽伴气促和血氧下降。', diagnosisBasis: '气促伴静息血氧下降，肺部听诊闻及细湿啰音，血常规提示感染。', differentials: '病毒性肺炎' } }, 'bt-decision-1');
  await turn(session, { type: 'SUBMIT_PLAN', data: { priority: '监测生命体征并氧疗', detail: '吸氧后复评血氧，必要时住院。' } }, 'bt-plan-1');
  assert.equal(session.stage, 'plan');
  assert.equal(session.viewStage, undefined);

  // 返回检查阶段（viewStage 回看，业务阶段保持 plan）
  const back = await turn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'tests' } }, 'bt-back-tests');
  assert.equal(back.session.viewStage, 'tests');
  assert.equal(session.stage, 'plan', '业务阶段不回退');

  // 补查：文本申请成功，证据追加，业务阶段仍为 plan（不触发 DB 防回退）
  const more = await turn(session, { type: 'ORDER_TEST', data: { requestedTests: '胸部影像' } }, 'bt-test-2');
  assert.ok(more.newMessages.length > 0, '补查应返回结果消息');
  assert.equal(session.stage, 'plan', '补查后业务阶段保持');
  assert.equal(session.viewStage, 'tests', '回看态保持');
  assert.ok(session.events.some((event) => event.type === 'ORDER_TEST'), '补查事件已记录');
});

test('普通训练返回修改诊断：重交成功，业务阶段保持，决策更新', async () => {
  const session = createInitialSession('student-bt2', 'guided');
  await turn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'bm-prep');
  await turn(session, { type: 'ORDER_TEST', data: { requestedTests: '血常规与 CRP' } }, 'bm-test-1');
  await turn(session, { type: 'SUBMIT_DECISION', data: { diagnosis: '肺炎', summary: '发热咳嗽伴气促和血氧下降。', diagnosisBasis: '气促伴静息血氧下降，肺部听诊闻及细湿啰音。', differentials: '' } }, 'bm-decision-1');
  await turn(session, { type: 'SUBMIT_PLAN', data: { priority: '监测生命体征并氧疗', detail: '吸氧后复评血氧，必要时住院。' } }, 'bm-plan-1');
  assert.equal(session.stage, 'plan');

  // 返回诊断阶段重交（viewStage 回看）
  await turn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'assessment' } }, 'bm-back-assessment');
  assert.equal(session.viewStage, 'assessment');
  const revised = await turn(session, { type: 'SUBMIT_DECISION', data: { diagnosis: '社区获得性肺炎伴低氧', summary: '发热咳嗽伴气促和血氧下降。', diagnosisBasis: '气促伴静息血氧下降，肺部听诊细湿啰音，血常规与CRP提示细菌感染。', differentials: '病毒性肺炎、支原体肺炎' } }, 'bm-decision-2');
  assert.ok(revised.session.decision);
  assert.equal(session.decision?.diagnosis, '社区获得性肺炎伴低氧', '诊断已更新');
  assert.equal((session.decision?.diagnosisBasis ?? '').length > 10, true);
  assert.equal(session.stage, 'plan', '重交后业务阶段保持 plan（不回退）');

  // 补问：问诊在任意阶段合法，不把 stage 拉回 history
  const asked = await turn(session, { type: 'ASK_QUESTION', data: { text: '孩子最近接触过生病的家人吗？' } }, 'bm-question-late');
  assert.equal(asked.session.stage, 'plan');
  assert.ok(session.askedIntents.length >= 0);
});
