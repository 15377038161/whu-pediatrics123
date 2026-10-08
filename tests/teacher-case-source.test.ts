import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { buildReport } from '@/lib/scoring';
import { getCase } from '@/domain/case';

test('非呼吸系统病例按自身事实问诊、查体、检查和复盘，保留关键阴性信息', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pediatrics-source-'));
  const oldRoot = process.env.PEDIATRICS_KNOWLEDGE_ROOT;
  const oldFixture = process.env.ENABLE_AI_FIXTURE;
  process.env.PEDIATRICS_KNOWLEDGE_ROOT = temp;
  process.env.ENABLE_AI_FIXTURE = 'true';
  const id = 'teacher-肾病综合征';
  try {
    await mkdir(path.join(temp, 'teaching-cases'));
    await writeFile(path.join(temp, 'teaching-cases', `${id}.json`), JSON.stringify({ caseId: id, sourceName: '肾病综合征', sourceDocument: '病例正文', age: '12岁', sex: '男', complaint: '水肿2周',
      sections: { history: '1.患儿，男，12岁；2.发现水肿2周。双下肢水肿。无血尿，无尿频尿急尿痛。', exam: 'T36.5℃，双肺呼吸音清，腹稍胀，无压痛，移动浊音（+），肝脾无肿大。', tests: '尿常规：尿蛋白+++', diagnosis: '肾病综合征', plan: '测试用原病例诊疗经过，不作为真实医疗建议。' },
      vitals: { temperature: 36.5, heartRate: null, respiratoryRate: null, spo2: null }, documents: [] }));
    const session = createInitialSession('student-1', 'guided', id);
    const question = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '水肿多久了？有没有血尿？' } }, 'source-question');
    assert.ok(question.newMessages.some((message) => message.content.includes('无血尿')));
    const exam = getCase(id).exams.find((item) => item.bodyPartId === 'abdomen')!;
    const blocked = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: exam.toolId, bodyPartId: exam.bodyPartId } }, 'source-exam-blocked');
    assert.equal(blocked.newMessages.length, 0);
    await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'source-prep');
    const examined = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: exam.toolId, bodyPartId: exam.bodyPartId } }, 'source-exam');
    assert.ok(examined.newMessages[0].content.includes('无压痛'));
    assert.ok(examined.newMessages[0].content.includes('移动浊音（+）'));
    const checked = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: session.caseOptions!.tests[0].id } }, 'source-test');
    assert.ok(checked.newMessages[0].content.includes('尿蛋白+++'));
    assert.equal(session.events.find((event) => event.type === 'ORDER_TEST')?.correct, null);
    await runAgentTurn(session, { type: 'SUBMIT_PLAN', data: { priority: '监测病情', detail: '进一步评估和复评' } }, 'source-plan');
    assert.equal(session.vitals.spo2, null);
    const report = buildReport(session);
    assert.equal(report.scoreBasis, 'process');
    assert.equal(report.status, 'pending_review');
    assert.ok(report.evidence.some((item) => item.code === 'SOURCE_DIAGNOSIS_REFERENCE' && item.detail === '肾病综合征'));
    assert.equal(report.evidence.some((item) => item.code === 'RUBRIC_EXAM_OXYGEN'), false);
  } finally {
    if (oldRoot === undefined) delete process.env.PEDIATRICS_KNOWLEDGE_ROOT; else process.env.PEDIATRICS_KNOWLEDGE_ROOT = oldRoot;
    if (oldFixture === undefined) delete process.env.ENABLE_AI_FIXTURE; else process.env.ENABLE_AI_FIXTURE = oldFixture;
    await rm(temp, { recursive: true, force: true });
  }
});
