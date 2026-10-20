import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { buildReport } from '@/lib/scoring';
import { getOsceStation } from '@/domain/osce-stations';
import type { TrainingReport } from '@/domain/agent';

/**
 * 阶段 C 放行条件（方案 16 阶段 C）：普通病例、真实专项、OSCE 三条链均可产生正确类型报告；
 * 历史报告（无量表元数据）保留原口径，不追溯重写。
 */

test('普通病例链：完整接诊按旗舰量表生成 clinical_rubric 报告', () => {
  const session = createInitialSession('student-1', 'guided');
  session.askedIntents = ['onset', 'fever', 'danger'];
  session.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2'];
  session.decision = { diagnosis: '肺炎', summary: '发热咳嗽伴气促', diagnosisBasis: '发热咳嗽伴气促', differentials: '病毒性肺炎' };
  session.plan = { priority: '吸氧和生命体征监测', detail: '完善检查，必要时住院。' };
  session.communication = '我理解您担心。孩子呼吸有风险，我们先吸氧监测。';
  const report = buildReport(session, 'report-guided');
  assert.equal(report.rubricId, 'rubric-clinical-flagship');
  assert.equal(report.rubricVersion, 1);
  assert.equal(report.evaluationBasis, 'clinical_rubric');
  assert.equal(report.totalScore, Object.values(report.abilities).reduce((sum, value) => sum + value, 0), '总分=分项之和');
  assert.equal(report.evidence.reduce((sum, item) => sum + item.maxScore, 0), 100, '总满分=计分项满分之和');
  assert.ok(report.studentSubmissions, '报告保留原始提交快照');
  assert.equal(report.studentSubmissions?.decision?.diagnosis, '肺炎');
  assert.equal(report.studentSubmissions?.plan?.priority, '吸氧和生命体征监测');
});

test('专项链：practice 会话按 focus 选专项量表，不因未开放环节扣分', () => {
  const session = createInitialSession('student-1', 'practice', undefined, 'exam');
  assert.equal(session.practiceFocus, 'exam');
  assert.deepEqual(session.providedEvidence, ['HX_PROVIDED']);
  session.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2', 'EX_TEMP'];
  const report = buildReport(session, 'report-exam');
  assert.equal(report.rubricId, 'rubric-focused-exam');
  assert.equal(report.practiceFocus, 'exam');
  assert.equal(report.evaluationBasis, 'clinical_rubric');
  // 专项量表只含查体维度项：未提交诊断/处置/沟通不计负分，总分=查体专项得分
  assert.ok(report.abilities.examination > 0, '专项查体证据得分');
  assert.equal(report.abilities.history, 0, '专项量表不含问诊维度项');
  assert.equal(report.totalScore, report.abilities.examination);
  assert.equal(report.evidence.reduce((sum, item) => sum + item.maxScore, 0), 100, '专项量表满分 100');
  assert.ok(report.studentSubmissions);
  assert.equal(report.studentSubmissions?.decision, null, '未提交诊断保留为空快照');
});

test('OSCE 链：站点契约元数据 + 服务器计时 + 时间到拒绝新增操作', async () => {
  const session = createInitialSession('student-1', 'osce');
  const station = getOsceStation(session.caseId);
  assert.ok(station, '旗舰病例应命中站点契约');
  assert.equal(session.osceStation?.stationId, station!.stationId);
  assert.equal(session.osceStation?.timeLimitSeconds, station!.timeLimitSeconds);
  const remainingSeconds = (Date.parse(session.expiresAt!) - Date.now()) / 1000;
  assert.ok(remainingSeconds > 0 && remainingSeconds <= station!.timeLimitSeconds, '截止时间按站点时限设定');
  // 时间到后服务端拒绝新增临床操作（不只禁用按钮），FINISH_SESSION 仍可冻结提交
  session.expiresAt = new Date(Date.now() - 1_000).toISOString();
  await assert.rejects(
    () => runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '孩子精神怎么样？' } }, 'expired-question'),
    /SESSION_EXPIRED/,
  );
  const finish = await runAgentTurn(session, { type: 'FINISH_SESSION', data: {} }, 'expired-finish');
  assert.equal(finish.session.status, 'completed');
  const report = buildReport(finish.session, 'report-osce');
  assert.equal(report.rubricId, 'rubric-clinical-flagship');
  assert.equal(report.evaluationBasis, 'clinical_rubric');
});

test('历史报告兼容：无量表元数据的旧报告字段不追溯重写', () => {
  const legacy: TrainingReport = {
    id: 'legacy-report',
    sessionId: 'legacy-session',
    userId: 'student-1',
    caseId: 'peds-respiratory-001',
    mode: 'osce' as const,
    totalScore: 70,
    abilities: { history: 20, examination: 20, reasoning: 15, safety: 10, communication: 5, professionalism: 0 },
    evidence: [],
    strengths: [],
    improvements: [],
    recommendation: '历史报告',
    status: 'ready' as const,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
  assert.equal(legacy.rubricId, undefined, '历史报告无量表元数据时展示层降级（report-view 已处理）');
  assert.equal(legacy.studentSubmissions, undefined, '历史报告不回填原始提交快照');
});
