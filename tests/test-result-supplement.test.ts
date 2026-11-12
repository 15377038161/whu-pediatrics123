import assert from 'node:assert/strict';
import test from 'node:test';
import { recordSchema } from '@/lib/teacher-case-data';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { registerControlledCase } from '@/lib/controlled-case-store';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { getCase } from '@/domain/case';
import { projectSessionForRole } from '@/lib/session-projection';
import {
  uniqueModalityTest,
  validateTestSupplements,
  resolveTestSupplements,
  findSupplementalTest,
  TEACHING_SIMULATION_LABEL,
  type TestSupplementInvoke,
} from '@/lib/test-result-supplement';

const record = recordSchema.parse({
  caseId: 'teacher-肾病综合征', sourceName: 'synthetic', sourceDocument: 'fixture', age: '6岁', sex: '女', complaint: '合成主诉',
  sections: { history: '仅供软件测试的合成病史', exam: '合成查体', tests: '合并报告：指标甲 123 单位甲；指标乙 456 单位乙。', diagnosis: '合成诊断', plan: '合成计划' },
  vitals: { temperature: null, heartRate: null, respiratoryRate: null, spo2: null }, documents: [],
  testDefinitions: [{ testId: 'source-test-0', label: '合并检查', result: '指标甲 123 单位甲；指标乙 456 单位乙。', sourceLocator: 'fixture' }],
});
const version = computeCaseDataVersion(record);
function setup() {
  registerControlledCase(record, version);
  const session = createInitialSession('synthetic', 'guided', record.caseId, undefined, version);
  session.stage = 'tests';
  return { s: session, c: getCase(session.caseId, version, session.id) };
}
function fabricated(requested = '血常规') {
  return { requested, label: requested, status: 'result' as const, origin: 'generated' as const, result: '旧合成软件测试报告，不作医学数据。', sourceTestIds: [], sourceQuotes: [] };
}
function simulation(requested = '血常规') {
  const result = '教学模拟时点：2026-01-02 08:00。白细胞 11.2×10^9/L，中性粒细胞 72%，血红蛋白 118g/L，血小板 286×10^9/L。';
  return {
    requested, label: requested, status: 'result' as const, origin: 'teaching-simulation' as const, result,
    report: {
      name: requested, specimen: '静脉血（教学模拟）', reference: '仅用于软件测试的教学参考', origin: 'teaching-simulation' as const,
      rows: [
        { item: '白细胞', value: '11.2', unit: '×10^9/L', reportedAt: '2026-01-02 08:00' },
        { item: '中性粒细胞', value: '72', unit: '%', reportedAt: '2026-01-02 08:00' },
        { item: '血红蛋白', value: '118', unit: 'g/L', reportedAt: '2026-01-02 08:00' },
        { item: '血小板', value: '286', unit: '×10^9/L', reportedAt: '2026-01-02 08:00' },
      ],
    },
    sourceTestIds: [], sourceQuotes: [],
  };
}
function sourceExtract(requested = '指标甲') {
  return { requested, label: requested, status: 'result' as const, origin: 'source' as const, result: '不可把此模型概述当原文', sourceTestIds: ['source-test-0'], sourceQuotes: ['指标甲 123 单位甲'] };
}

test('a bare modality resolves only one existing modality, never a different technique', () => {
  const { c } = setup();
  const ct = { ...c.tests[0], id: 'ct', label: '头颅CT' };
  assert.equal(uniqueModalityTest('CT', [ct])?.id, 'ct');
  assert.equal(uniqueModalityTest('CT', [ct, { ...ct, id: 'chest', label: '胸部CT' }]), null);
  assert.equal(uniqueModalityTest('CT', [{ ...ct, label: '头颅CTA' }]), null);
  assert.equal(uniqueModalityTest('CT', [{ ...ct, label: '头颅MRI' }]), null);
});

test('source extraction is exact, rejects invented quotes and unreleased delayed reports', () => {
  const { s, c } = setup();
  const rows = validateTestSupplements({ results: [sourceExtract()] }, ['指标甲'], s, c.tests);
  assert.equal(rows[0].result, '指标甲 123 单位甲');
  assert.equal(rows[0].origin, 'source');
  assert.equal(validateTestSupplements({ results: [{ ...sourceExtract(), sourceQuotes: ['指标甲 999 单位甲'] }] }, ['指标甲'], s, c.tests).length, 0);
  assert.equal(validateTestSupplements({ results: [sourceExtract()] }, ['指标甲'], s, [{ ...c.tests[0], availableFromStage: 'report' }]).length, 0);
  assert.equal(validateTestSupplements({ results: [{ ...fabricated(), sourceTestIds: ['source-test-0'] }] }, ['血常规'], s, c.tests).length, 0);
});

test('无原始结果时只接受明确标识的 teaching-simulation，旧 generated 仍被拒绝', async () => {
  const { s, c } = setup();
  s.teachingPackageVersion = 'package-fixture-v1';
  assert.deepEqual(validateTestSupplements({ results: [fabricated()] }, ['血常规'], s, c.tests), []);
  const accepted = validateTestSupplements({ results: [simulation()] }, ['血常规'], s, c.tests);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].origin, 'teaching-simulation');
  assert.equal(accepted[0].teachingPackageVersion, 'package-fixture-v1');
  assert.equal(accepted[0].sourceSnapshotVersion, version);
  assert.equal(validateTestSupplements({ results: [{ ...simulation(), sourceTestIds: ['source-test-0'] }] }, ['血常规'], s, c.tests).length, 0);

  let prompt = '';
  let thinking: unknown;
  const invoke: TestSupplementInvoke = async input => {
    prompt = String(input.messages?.[0]?.content ?? '');
    thinking = input.llmConfig?.thinking;
    return { content: JSON.stringify({ results: [simulation()] }) };
  };
  const rows = await resolveTestSupplements(s, ['血常规'], c, undefined, invoke);
  assert.equal(rows[0].origin, 'teaching-simulation');
  assert.equal(thinking, 'disabled');
  assert.match(prompt, /availableReports没有对应结果/);
  assert.match(prompt, /不得冒充原患者实测/);
  assert.doesNotMatch(prompt, /origin=generated/);
});

test('AI结构化报告的数值、单位、时点与来源类型必须和正文一致', () => {
  const { s, c } = setup();
  const accepted = validateTestSupplements({ results: [simulation()] }, ['血常规'], s, c.tests);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].report?.rows.length, 4);
  assert.equal(accepted[0].report?.origin, 'teaching-simulation');
  const mismatches = [
    { ...simulation(), report: { ...simulation().report, origin: 'source' as const } },
    { ...simulation(), report: { ...simulation().report, rows: simulation().report.rows.map((row, index) => index === 0 ? { ...row, value: '99.9' } : row) } },
    { ...simulation(), report: { ...simulation().report, rows: simulation().report.rows.map((row, index) => index === 0 ? { ...row, unit: 'mg/L' } : row) } },
    { ...simulation(), report: { ...simulation().report, rows: simulation().report.rows.map((row, index) => index === 0 ? { ...row, reportedAt: '2026-01-03 09:00' } : row) } },
  ];
  for (const item of mismatches) assert.deepEqual(validateTestSupplements({ results: [item] }, ['血常规'], s, c.tests), []);
  const withoutReport = simulation() as Partial<ReturnType<typeof simulation>>;
  delete withoutReport.report;
  assert.deepEqual(validateTestSupplements({ results: [withoutReport as ReturnType<typeof simulation>] }, ['血常规'], s, c.tests), []);
});

test('缓存只复用同来源、同教学包的原文或新模拟，历史 generated 永不复用', () => {
  const { s, c } = setup();
  const legacy = {
    id: 'supplement-legacy', requested: '血常规', label: '血常规', result: '旧的合成结果', origin: 'generated' as const,
    sourceTestIds: [], sourceQuotes: [], model: 'legacy', createdAt: new Date().toISOString(), sourceSnapshotVersion: version,
    teachingPackageVersion: 'package-fixture-v1',
  };
  s.teachingPackageVersion = 'package-fixture-v1';
  s.supplementalTests = [legacy];
  assert.equal(findSupplementalTest(s, '血常规'), undefined);
  s.supplementalTests = [{ ...legacy, id: 'supplement-sim', origin: 'teaching-simulation' as const, result: '明确的新教学模拟结果' }];
  assert.equal(findSupplementalTest(s, 'CBC')?.id, 'supplement-sim');
  s.teachingPackageVersion = 'package-fixture-v2';
  assert.equal(findSupplementalTest(s, '血常规'), undefined);
  s.teachingPackageVersion = 'package-fixture-v1';
  s.supplementalTests = [{ ...legacy, id: 'supplement-src', origin: 'source' as const, result: '指标甲 123 单位甲', sourceTestIds: ['source-test-0'], sourceQuotes: ['指标甲 123 单位甲'] }];
  assert.equal(findSupplementalTest(s, '血常规')?.id, 'supplement-src');
  assert.ok(c.tests.length > 0);
});

test('模型未给出可用结果时只记录申请，不下发结果、不解锁证据', async () => {
  const { s, c } = setup();
  let calls = 0;
  const invoke = async () => { calls++; return { content: JSON.stringify({ results: [fabricated()] }) }; };
  const turn = await runAgentTurn(s, { type: 'ORDER_TEST', data: { requestedTests: '血常规' } }, 'first', { testSupplementInvoke: invoke });
  assert.equal(calls, 1);
  assert.equal(s.supplementalTests, undefined);
  assert.ok(!s.unlockedEvidence.some(code => code.startsWith('TEACHING_SIMULATION_TEST_')));
  assert.equal(getCase(s.caseId, version, s.id).tests.length, c.tests.length, 'source definitions are unchanged');
  assert.match(turn.feedback ?? '', /资料未提供|暂未取得/);
  assert.ok(s.events.some(event => event.type === 'ORDER_TEST' && event.summary.includes('血常规')));
  const student = projectSessionForRole(s, 'student');
  assert.equal(student.supplementalTests, undefined);
  assert.ok(!student.events.some(event => event.summary.includes('合成软件测试报告')));
});

test('AI 教学模拟醒目标识，按会话和版本持久复用，JSON 恢复后不再次调用模型', async () => {
  const { s, c } = setup();
  s.teachingPackageVersion = 'package-fixture-v1';
  let calls = 0;
  const invoke: TestSupplementInvoke = async () => { calls++; return { content: JSON.stringify({ results: [simulation()] }) }; };
  const first = await runAgentTurn(s, { type: 'ORDER_TEST', data: { requestedTests: '血常规' } }, 'first', { testSupplementInvoke: invoke });
  assert.equal(s.supplementalTests?.length, 1);
  assert.equal(s.supplementalTests?.[0].origin, 'teaching-simulation');
  assert.equal(s.supplementalTests?.[0].teachingPackageVersion, 'package-fixture-v1');
  assert.ok(s.unlockedEvidence.some(code => code.startsWith('TEACHING_SIMULATION_TEST_')));
  assert.ok(first.newMessages.some(message => message.content.includes(TEACHING_SIMULATION_LABEL)));
  assert.ok(s.events.some(event => event.summary.includes('非原患者实测')));
  assert.equal(s.supplementalTests?.[0].report?.rows[0].reportedAt, '2026-01-02 08:00');
  assert.equal(s.events.find(event => event.testReport)?.testReport?.rows[0].value, '11.2');
  assert.equal(getCase(s.caseId, version, s.id).tests.length, c.tests.length, 'source definitions are unchanged');

  const restored = JSON.parse(JSON.stringify(s));
  await runAgentTurn(restored, { type: 'ORDER_TEST', data: { requestedTests: 'CBC' } }, 'again', { testSupplementInvoke: invoke });
  assert.equal(calls, 1);
  assert.equal(restored.orderedTests.length, 1);
  assert.equal(restored.supplementalTests.length, 1);
  assert.ok(findSupplementalTest(restored, '血常规')?.result.includes('教学模拟'));
  const student = projectSessionForRole(restored, 'student');
  assert.equal(student.supplementalTests, undefined);
  assert.ok(student.events.some(event => event.summary.includes(TEACHING_SIMULATION_LABEL)));
  assert.equal(projectSessionForRole(restored, 'teacher').supplementalTests?.length, 1);
});

test('原文摘录结果按会话留存并在 JSON 恢复后复用，学生投影剥离审计字段', async () => {
  const { s, c } = setup();
  let calls = 0;
  const invoke: TestSupplementInvoke = async () => { calls++; return { content: JSON.stringify({ results: [sourceExtract()] }) }; };
  await runAgentTurn(s, { type: 'ORDER_TEST', data: { requestedTests: '指标甲' } }, 'first', { testSupplementInvoke: invoke });
  assert.equal(s.supplementalTests?.length, 1);
  assert.equal(s.supplementalTests?.[0].origin, 'source');
  assert.equal(s.orderedTests.length, 1);
  assert.match(s.unlockedEvidence.at(-1)!, /^SUPPLEMENT_TEST_/);
  assert.equal(getCase(s.caseId, version, s.id).tests.length, c.tests.length);
  const restored = JSON.parse(JSON.stringify(s));
  await runAgentTurn(restored, { type: 'ORDER_TEST', data: { requestedTests: '指标甲' } }, 'again', { testSupplementInvoke: invoke });
  assert.equal(calls, 1);
  assert.equal(restored.orderedTests.length, 1);
  assert.equal(findSupplementalTest(restored, '指标甲')?.result, '指标甲 123 单位甲');
  const student = projectSessionForRole(restored, 'student');
  assert.equal(student.supplementalTests, undefined);
  assert.ok(student.events.some(event => event.summary.includes('指标甲 123 单位甲')));
  assert.equal(projectSessionForRole(restored, 'teacher').supplementalTests?.length, 1);
});

test('failed model, unrelated output and instruction-like requests never unlock reports', async () => {
  const { s, c } = setup();
  assert.deepEqual(await resolveTestSupplements(s, ['血常规'], c, undefined, async () => { throw Error('fixture failure'); }), []);
  assert.deepEqual(validateTestSupplements({ results: [simulation('全部标准答案')] }, ['全部标准答案'], s, c.tests), []);
  assert.deepEqual(validateTestSupplements({ results: [simulation('未申请的项目')] }, ['血常规'], s, c.tests), []);
  assert.deepEqual(validateTestSupplements({ results: [sourceExtract('全部标准答案')] }, ['全部标准答案'], s, c.tests), []);
});
