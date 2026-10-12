import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { agentTurnSchema } from '@/lib/validation';
import { buildReport } from '@/lib/scoring';

/** 任务3：诊断依据 diagnosisBasis 必填——
 *  引擎守卫（缺字段/过短即拒绝）、Zod 契约（缺字段不通过）、
 *  历史会话兼容（无 diagnosisBasis 的旧 decision 不影响报告生成）。 */

const VALID_DECISION = {
  diagnosis: '社区获得性肺炎伴低氧',
  summary: '发热咳嗽伴气促和血氧下降，右下肺细湿啰音。',
  diagnosisBasis: '发热咳嗽2天伴气促，静息血氧92%，右下肺闻及细湿啰音，血常规提示感染，支持肺炎伴低氧诊断。',
  differentials: '病毒性肺炎、支原体肺炎',
};

test('引擎守卫：缺 diagnosisBasis 或依据过短（<10字）被拒绝', async () => {
  const missing = createInitialSession('student-basis', 'guided');
  await assert.rejects(
    () => runAgentTurn(missing, { type: 'SUBMIT_DECISION', data: { diagnosis: '肺炎', summary: '只有摘要没有依据', differentials: '' } } as never, 'basis-missing'),
    /DIAGNOSIS_BASIS_REQUIRED/,
  );
  const short = createInitialSession('student-basis', 'guided');
  await assert.rejects(
    () => runAgentTurn(short, { type: 'SUBMIT_DECISION', data: { diagnosis: '肺炎', summary: '依据过短应被拒绝', diagnosisBasis: '太短', differentials: '' } }, 'basis-short'),
    /DIAGNOSIS_BASIS_REQUIRED/,
  );
  assert.equal(missing.decision, null, '拒绝后不落任何决策状态');
});

test('提交成功：diagnosisBasis 完整保存进会话决策', async () => {
  const session = createInitialSession('student-basis', 'guided');
  const result = await runAgentTurn(session, { type: 'SUBMIT_DECISION', data: VALID_DECISION }, 'basis-ok');
  assert.ok(session.decision);
  assert.equal(session.decision.diagnosisBasis, VALID_DECISION.diagnosisBasis);
  assert.ok(result.feedback);
});

test('Zod 契约：缺 diagnosisBasis 的 SUBMIT_DECISION 不通过校验', () => {
  const base = { sessionId: crypto.randomUUID(), clientEventId: 'zod-basis-check' };
  const missing = agentTurnSchema.safeParse({ ...base, event: { type: 'SUBMIT_DECISION', data: { diagnosis: '肺炎', summary: '只有摘要没有依据内容', differentials: '' } } });
  assert.equal(missing.success, false, '缺 diagnosisBasis 应校验失败');
  const valid = agentTurnSchema.safeParse({ ...base, event: { type: 'SUBMIT_DECISION', data: VALID_DECISION } });
  assert.equal(valid.success, true);
});

test('历史兼容：无 diagnosisBasis 的旧 decision 仍可生成报告', () => {
  const session = createInitialSession('student-legacy', 'guided');
  session.decision = { diagnosis: '社区获得性肺炎伴低氧', summary: '发热咳嗽伴气促和血氧下降', differentials: '病毒性肺炎、支原体肺炎' };
  const report = buildReport(session);
  assert.ok(report, '旧会话报告生成不受影响');
});
