import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRepository } from '@/lib/repository';
import { runAgentTurn, createInitialSession } from '@/lib/agent-engine';
import { buildReport } from '@/lib/scoring';
import type { SessionState, SyncEventV1, TrainingReport, UserContext } from '@/domain/agent';

/**
 * 注入式回归：reference=null（学生收紧后 RPC 一律 null）时合法 finish→报告生成→再读报告全链路。
 * 全程走内存 Repository（provider='preview'），不碰外部服务、不伪造 JWT/cookie。
 * 断言：报告无诊断/处置标准答案回填；评分仅来自明确的过程证据；正式评分语义（对照缺失）如实降级。
 */

type Actor = UserContext & { accessToken: string | null };

function makeActor(id: string, role: 'student' | 'teacher'): Actor {
  return { id, role, displayName: `测试${id}`, studentNo: null, provider: 'preview', chaoxingUid: null, accessToken: null };
}

/** 模拟 finish 路由的业务逻辑（reference 恒为 null 的学生路径），与 route.ts 同构。 */
async function finishSessionLikeRoute(repo: AgentRepository, session: SessionState): Promise<TrainingReport> {
  if (session.reportId) return repo.getReport(session.reportId);
  if (session.status === 'active') {
    await runAgentTurn(session, { type: 'FINISH_SESSION', data: {} }, `finish-${session.id}`);
  }
  session.updatedAt = new Date().toISOString();
  await repo.saveSession(session);
  // 学生路径收紧后 reference 一律 null（RPC 仅教师返回）
  const reference = null as null;
  const report = buildReport(session, session.id, reference ?? undefined);
  session.reportId = report.id;
  session.stage = 'report';
  session.updatedAt = new Date().toISOString();
  const event: SyncEventV1 = {
    schemaVersion: 1,
    eventId: `report-${report.id}`,
    recordType: 'learning_report',
    student: { userId: session.userId, studentNo: null, displayName: `测试${session.userId}` },
    case: { caseId: session.caseId, caseVersion: session.caseVersion, sessionId: session.id, mode: session.mode, stage: 'report' },
    studentInput: session.decision?.summary ?? null,
    agentFeedback: report.recommendation,
    score: report.totalScore,
    evidenceSummary: report.evidence.map((item) => `${item.label}:${item.score}/${item.maxScore}`).join('；'),
    finalReport: JSON.stringify(report),
    submittedAt: report.createdAt,
  };
  await repo.saveReport(report, event);
  await repo.saveSession(session);
  return report;
}

test('reference=null 合法finish：报告生成与再读取无标准答案回填', async () => {
  const actorA = makeActor('inject-stu-a', 'student');
  const repoA = new AgentRepository(actorA);
  // 学生 A 构造有过程证据的会话
  const session = createInitialSession(actorA.id, 'osce');
  session.askedIntents = ['onset', 'fever', 'danger', 'general', 'exposure', 'vaccination'];
  session.unlockedEvidence = ['EX_PREP', 'EX_RESP', 'EX_SPO2', 'EX_TEMP'];
  session.orderedTests = ['cbc-crp'];
  session.decision = { diagnosis: '社区获得性肺炎伴低氧', summary: '发热咳嗽伴气促和血氧下降', differentials: '病毒性肺炎、支原体肺炎' };
  session.plan = { priority: '吸氧和生命体征监测', detail: '吸氧后复评，完善检查，必要时住院。' };
  session.communication = '我理解您担心。孩子目前呼吸和血氧有风险，先吸氧监测，及时告知下一步。';
  await repoA.saveSession(session);

  // 1) 合法 finish（reference=null 收紧语义）
  const report = await finishSessionLikeRoute(repoA, session);
  assert.ok(report.id, '报告应生成');
  assert.equal(report.caseId, session.caseId);

  // 2) 无标准答案回填：报告不含 reference 对照字段（诊断对照/处置对照留空）
  const reportAny = report as unknown as Record<string, unknown>;
  assert.equal(reportAny.reference ?? reportAny.diagnosisReference ?? reportAny.answerReference, undefined,
    '收紧后报告不得回填诊断/处置标准答案');
  // 建议与改进不包含「参考答案/标准答案/对照」字样的模板性回填
  assert.ok(!/标准(诊断|答案)|参考(诊断|答案|治疗)/.test(`${report.recommendation ?? ''}${JSON.stringify(report.improvements ?? [])}`),
    '过程反馈不得出现标准答案字样');

  // 3) 评分仅来自明确过程证据：总分严格等于六维分项之和
  const abilitySum = Object.values(report.abilities).reduce((sum, v) => sum + v, 0);
  assert.equal(report.totalScore, abilitySum, '总分应等于分项之和（过程证据）');
  assert.ok(report.evidence.length > 0, '过程证据列表非空');
  for (const item of report.evidence) {
    assert.ok(typeof item.label === 'string' && item.label.length > 0, `证据 ${item.code} 有明确标签`);
    assert.ok(item.score <= item.maxScore, `证据 ${item.code} 得分不超过上限`);
  }

  // 4) 再读取报告：学生读自己报告成功且内容一致
  const reread = await repoA.getReport(report.id);
  assert.equal(reread.id, report.id);
  assert.equal(reread.totalScore, report.totalScore);
  assert.deepEqual(reread.evidence.map((e) => e.code), report.evidence.map((e) => e.code));
  // 再读取同样无答案回填
  const rereadAny = reread as unknown as Record<string, unknown>;
  assert.equal(rereadAny.reference ?? rereadAny.diagnosisReference ?? rereadAny.answerReference, undefined);

  // 5) 会话完成后幂等：二次 finish 不重建报告
  const again = await finishSessionLikeRoute(repoA, session);
  assert.equal(again.id, report.id, '二次 finish 应返回既有报告（幂等）');
});

test('reference=null 过程分语义：无过程证据的学生只得过程反馈低分', async () => {
  const actorB = makeActor('inject-stu-b', 'student');
  const repoB = new AgentRepository(actorB);
  const session = createInitialSession(actorB.id, 'osce');
  session.decision = { diagnosis: '随便猜的病', summary: '没有问诊直接猜', differentials: '' };
  await repoB.saveSession(session);
  const report = await finishSessionLikeRoute(repoB, session);
  // 无过程证据：查体/检查维度为 0 分
  assert.equal(report.abilities.examination, 0, '无查体证据应 0 分');
  const testAbility = (report.abilities as unknown as Record<string, number>).investigation ?? 0;
  assert.equal(testAbility, 0, '无检查证据应 0 分');
  assert.ok(report.totalScore < 50, '无证据过程分应显著低于满分');
});

test('内存隔离：学生 B 不得读学生 A 的报告', async () => {
  const actorA = makeActor('inject-stu-a', 'student');
  const repoA = new AgentRepository(actorA);
  const session = createInitialSession(actorA.id, 'osce');
  session.decision = { diagnosis: 'x', summary: 'y', differentials: '' };
  await repoA.saveSession(session);
  const report = await finishSessionLikeRoute(repoA, session);

  const actorB = makeActor('inject-stu-b', 'student');
  const repoB = new AgentRepository(actorB);
  await assert.rejects(() => repoB.getReport(report.id), /FORBIDDEN|REPORT_NOT_FOUND/,
    '学生 B 读 A 的报告必须被拒');
});
