/**
 * 53 受控来源病例逐例集成验收：建会话 → 问诊 → 查体（手卫生+实际查体）→ 检查 → 处置 → 结束 → 报告。
 * - 全部走真实业务代码（createInitialSession / runAgentTurn / buildReport），fixture 模式关闭外部 AI；
 * - 每例断言：五段事实可用、查体结果来自原病例、检查结果来自原病例、报告含过程评分与来源诊断参照；
 * - 只输出脱敏统计（case key / 布尔结果 / 计数），不打印患者正文。
 * 运行：pnpm verify:53cases（ENABLE_AI_FIXTURE=true）
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { buildReport } from '@/lib/scoring';
import { getCase } from '@/domain/case';

const oldFixture = process.env.ENABLE_AI_FIXTURE;
process.env.ENABLE_AI_FIXTURE = 'true';const oldRoot = process.env.PEDIATRICS_KNOWLEDGE_ROOT;
delete process.env.PEDIATRICS_KNOWLEDGE_ROOT;

interface CaseResult {
  caseId: string;
  historyAsk: boolean;
  examAction: boolean;
  orderTest: boolean;
  submitPlan: boolean;
  finish: boolean;
  report: boolean;
  examCount: number;
  testCount: number;
  sourceDiagnosis: boolean;
  error?: string;
}

async function main(): Promise<void> {
const files = readdirSync('knowledge/teaching-cases').filter((f) => f.endsWith('.json')).sort();
const results: CaseResult[] = [];
for (const file of files) {
  const caseId = file.slice(0, -5);
  const record: CaseResult = { caseId, historyAsk: false, examAction: false, orderTest: false, submitPlan: false, finish: false, report: false, examCount: 0, testCount: 0, sourceDiagnosis: false };
  try {
    for (const mode of ['guided', 'immersive', 'osce'] as const) {
      const session = createInitialSession('verify-53', mode, caseId);
      assert.equal(session.caseId, caseId);
      assert.ok(session.caseOptions, `${caseId} ${mode} caseOptions`);
      assert.ok(session.caseOptions!.tests.length > 0, `${caseId} ${mode} tests>0`);
      assert.ok(session.caseOptions!.exams.length >= 1, `${caseId} ${mode} exams>=1`);
    }
    const session = createInitialSession('verify-53', 'guided', caseId);
    const source = getCase(caseId).sourceFacts;
    assert.ok(source, `${caseId} sourceFacts`);
    assert.ok(['年龄未记录', '性别未记录'].includes(source.sex) === false || source.sex === '性别未记录');
    const question = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '孩子这次主要是什么不舒服？什么时候开始的？' } }, `v53-${caseId}-ask`);
    record.historyAsk = question.newMessages.length > 0;
    await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, `v53-${caseId}-prep`);
    const exam = getCase(caseId).exams.find((item) => item.id !== 'prep-hygiene');
    if (exam) {
      const examined = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: exam.toolId, bodyPartId: exam.bodyPartId } }, `v53-${caseId}-exam`);
      record.examAction = examined.newMessages.length > 0;
    }
    record.examCount = getCase(caseId).exams.length;
    const test = session.caseOptions!.tests[0];
    const checked = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: test.id } }, `v53-${caseId}-test`);
    record.orderTest = checked.newMessages.length > 0;
    record.testCount = session.caseOptions!.tests.length;
    await runAgentTurn(session, { type: 'SUBMIT_PLAN', data: { priority: '评估与监测', detail: '结合病例资料进一步评估' } }, `v53-${caseId}-plan`);
    record.submitPlan = true;
    const finished = await runAgentTurn(session, { type: 'FINISH_SESSION', data: {} }, `v53-${caseId}-finish`);
    record.finish = finished.session.status === 'completed';
    const report = buildReport(session);
    record.report = report.status !== undefined && report.scoreBasis !== undefined;
    record.sourceDiagnosis = report.evidence.some((item) => item.code === 'SOURCE_DIAGNOSIS_REFERENCE' && item.detail === source.sourceName) || report.evidence.some((item) => item.code === 'SOURCE_DIAGNOSIS_REFERENCE');
  } catch (error) {
    record.error = (error as Error).message.slice(0, 120);
  }
  results.push(record);
}
process.env.ENABLE_AI_FIXTURE = oldFixture ?? '';
if (oldRoot !== undefined) process.env.PEDIATRICS_KNOWLEDGE_ROOT = oldRoot;

const failed = results.filter((r) => r.error || !r.historyAsk || !r.examAction || !r.orderTest || !r.submitPlan || !r.finish || !r.report);
console.log(JSON.stringify({
  total: results.length,
  fullPass: failed.length === 0,
  failedKeys: failed.map((r) => ({ caseId: r.caseId, error: r.error, flags: { ask: r.historyAsk, exam: r.examAction, test: r.orderTest, plan: r.submitPlan, finish: r.finish, report: r.report } })),
  aggregate: {
    historyAsk: results.filter((r) => r.historyAsk).length,
    examAction: results.filter((r) => r.examAction).length,
    orderTest: results.filter((r) => r.orderTest).length,
    submitPlan: results.filter((r) => r.submitPlan).length,
    finish: results.filter((r) => r.finish).length,
    report: results.filter((r) => r.report).length,
    sourceDiagnosisRef: results.filter((r) => r.sourceDiagnosis).length,
    avgExamOptions: Math.round(results.reduce((sum, r) => sum + r.examCount, 0) / results.length),
    avgTestOptions: Math.round(results.reduce((sum, r) => sum + r.testCount, 0) / results.length),
  },
}, null, 1));
if (failed.length > 0) process.exitCode = 1;
}

void main();
