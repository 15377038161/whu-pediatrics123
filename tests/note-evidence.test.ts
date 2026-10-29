import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReleasedEvidenceSummary } from '../src/lib/note-evidence';
import type { TrainingReport } from '../src/domain/agent';

/** 批次6·AI 审阅输入证据摘要（学生版报告投影后提取，不含答案参照）。 */

function makeReport(): TrainingReport {
  return {
    evidence: [
      { code: 'E1', label: '体温', detail: '38.5℃', status: 'achieved', maxScore: 5 },
      { code: 'E2', label: '咳嗽性质', detail: '未采集', status: 'missing', maxScore: 5 },
    ],
    collectionReview: [
      { area: 'history', label: '问诊要点', available: 8, collected: 6 },
      { area: 'tests', label: '辅助检查', available: 3, collected: 0 },
    ],
    studentSubmissions: {
      decision: { diagnosis: '急性支气管炎', summary: '对症', diagnosisBasis: '咳嗽', differentials: '肺炎' },
      plan: { priority: '抗感染', detail: '口服' },
      communication: '已沟通',
      historySummary: '发热2天',
      examObservation: { findings: '双肺呼吸音粗', interpretation: '炎症' },
    },
    studentDecision: { diagnosis: '急性支气管炎', summary: '对症', diagnosisBasis: '咳嗽', differentials: '肺炎' },
    strengths: ['问诊全面'],
    improvements: ['查体不全'],
  } as unknown as TrainingReport;
}

test('证据与采集覆盖映射（label/detail/status）', () => {
  const summary = buildReleasedEvidenceSummary(makeReport());
  assert.equal(summary.evidence.length, 2);
  assert.equal(summary.evidence[0].label, '体温');
  assert.equal(summary.evidence[0].detail, '38.5℃');
  assert.equal(summary.evidence[0].status, 'achieved');
  assert.equal(summary.evidence[1].status, 'missing');
  assert.equal(summary.collection.length, 2);
  assert.equal(summary.collection[0].collected, 6);
  assert.equal(summary.collection[1].area, 'tests');
});

test('学生最终提交提取：decision/plan/communication/history/exam', () => {
  const summary = buildReleasedEvidenceSummary(makeReport());
  assert.equal(summary.submissions.diagnosis, '急性支气管炎');
  assert.equal(summary.submissions.summary, '对症');
  assert.equal(summary.submissions.diagnosisBasis, '咳嗽');
  assert.equal(summary.submissions.differentials, '肺炎');
  assert.equal(summary.submissions.planPriority, '抗感染');
  assert.equal(summary.submissions.planDetail, '口服');
  assert.equal(summary.submissions.communication, '已沟通');
  assert.equal(summary.submissions.historySummary, '发热2天');
  assert.equal(summary.submissions.examFindings, '双肺呼吸音粗');
  assert.equal(summary.submissions.examInterpretation, '炎症');
  assert.deepEqual(summary.strengths, ['问诊全面']);
  assert.deepEqual(summary.improvements, ['查体不全']);
});

test('无 studentSubmissions 时回退 studentDecision（历史报告兼容）', () => {
  const report = makeReport();
  delete (report as { studentSubmissions?: unknown }).studentSubmissions;
  const summary = buildReleasedEvidenceSummary(report);
  assert.equal(summary.submissions.diagnosis, '急性支气管炎');
  assert.equal(summary.submissions.differentials, '肺炎');
  assert.equal(summary.submissions.planPriority, null, 'plan 仅存在于 studentSubmissions');
});

test('空证据/空采集不抛错', () => {
  const report = makeReport();
  (report as { evidence?: unknown }).evidence = undefined;
  (report as { collectionReview?: unknown }).collectionReview = undefined;
  (report as { strengths?: unknown }).strengths = undefined;
  (report as { improvements?: unknown }).improvements = undefined;
  const summary = buildReleasedEvidenceSummary(report);
  assert.deepEqual(summary.evidence, []);
  assert.deepEqual(summary.collection, []);
  assert.deepEqual(summary.strengths, []);
  assert.deepEqual(summary.improvements, []);
});
