import './fixtures/legacy-engine-catalog';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '../src/lib/agent-engine';

function decisionEvent(secondaryDiagnosis?: string[]) {
  return {
    type: 'SUBMIT_DECISION' as const,
    data: {
      diagnosis: '支气管肺炎',
      ...(secondaryDiagnosis ? { secondaryDiagnosis } : {}),
      summary: '患儿发热咳嗽，肺部可闻及细湿啰音，需要进一步评估。',
      diagnosisBasis: '发热咳嗽伴肺部细湿啰音，胸片提示斑片影。',
      differentials: '支气管哮喘',
    },
  };
}

test('提交诊断保存并列诊断，最多保留两条', async () => {
  const session = createInitialSession('student-secondary', 'guided');
  const result = await runAgentTurn(session, decisionEvent(['中度贫血', '营养不良', '佝偻病']), 'decision-secondary-limit');
  assert.deepEqual(result.session.decision?.secondaryDiagnosis, ['中度贫血', '营养不良']);
});

test('并列诊断去空格、去重，空数组不写入', async () => {
  const session = createInitialSession('student-secondary', 'guided');
  const result = await runAgentTurn(session, decisionEvent([' 中度贫血 ', '中度贫血', '营养不良']), 'decision-secondary-dedupe');
  assert.deepEqual(result.session.decision?.secondaryDiagnosis, ['中度贫血', '营养不良']);

  const emptySession = createInitialSession('student-secondary', 'guided');
  const empty = await runAgentTurn(emptySession, decisionEvent([]), 'decision-secondary-empty');
  assert.deepEqual(empty.session.decision?.secondaryDiagnosis, []);
});

test('历史提交不带并列诊断时保持 undefined，不影响旧链路', async () => {
  const session = createInitialSession('student-secondary', 'guided');
  const result = await runAgentTurn(session, decisionEvent(), 'decision-secondary-legacy');
  assert.equal(result.session.decision?.secondaryDiagnosis, undefined);
  assert.equal(result.session.decision?.diagnosis, '支气管肺炎');
});