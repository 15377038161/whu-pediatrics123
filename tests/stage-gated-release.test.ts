import './fixtures/legacy-engine-catalog';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { FLAGSHIP_CASE } from '@/domain/case';
import { STAGE_ORDER, stageReached, type Stage } from '@/domain/agent';

process.env.ENABLE_AI_FIXTURE = 'true';

/** 分时点事实释放（补充单 §5 共性缺口根治）：
 *  - HistoryIntent/ExamRule/AuxiliaryTest.availableFromStage：事实/体征/检查结果的最早释放阶段；
 *  - 未到释放时点：问诊不泄露、查体不可执行、检查只记单待回报——均不解锁证据；
 *  - 缺省（undefined）不限制，全部既有病例行为不变（向后兼容）。 */

test('stageReached：阶段顺序门控（含未知阶段 fail-closed）', () => {
  assert.deepEqual(STAGE_ORDER, ['triage', 'history', 'exam', 'tests', 'assessment', 'plan', 'communication', 'report']);
  assert.equal(stageReached('triage', 'triage'), true);
  assert.equal(stageReached('history', 'triage'), true);
  assert.equal(stageReached('triage', 'history'), false);
  assert.equal(stageReached('assessment', 'tests'), true);
  assert.equal(stageReached('exam', 'tests'), false);
  assert.equal(stageReached('report', 'communication'), true);
  assert.equal(stageReached('unknown-stage' as Stage, 'history'), false, '未知当前阶段按未达到处理');
  assert.equal(stageReached('history', 'unknown-stage' as Stage), false, '未知目标阶段按未达到处理');
});

test('问诊事实未到释放阶段：不泄露、不解锁证据、不计入已问意图；到达后正常释放', async (t) => {
  const exposure = FLAGSHIP_CASE.history.find((item) => item.id === 'exposure')!;
  exposure.availableFromStage = 'exam';
  t.after(() => { delete exposure.availableFromStage; });

  const session = createInitialSession('student-gated-hx', 'guided');
  const early = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '幼儿园同学最近有类似症状吗？' } }, 'gated-hx-early');
  assert.equal(early.session.unlockedEvidence.includes('HX_EXPOSURE'), false, '未到释放时点不得解锁证据');
  assert.equal(early.session.askedIntents.includes('exposure'), false, '未到释放时点不计入已问意图');
  assert.equal(early.session.behavior.hiddenExposureRevealed, false, '隐藏接触史不得提前揭示');
  assert.ok(early.newMessages.some((message) => message.content.includes('说不好')), '应回应现阶段说不好，不泄露事实内容');
  const earlyEvent = early.session.events.find((event) => event.clientEventId === 'gated-hx-early')!;
  assert.equal(earlyEvent.correct, null, '提前询问不判临床错误');
  assert.deepEqual(earlyEvent.evidenceCodes, []);

  // 推进到 exam 阶段（history → exam 前进一步）
  await runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'exam' } }, 'gated-hx-nav');
  assert.equal(session.stage, 'exam');
  const later = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '幼儿园同学最近有类似症状吗？' } }, 'gated-hx-later');
  assert.ok(later.session.unlockedEvidence.includes('HX_EXPOSURE'), '到达释放阶段后正常解锁');
  assert.ok(later.session.askedIntents.includes('exposure'));
  assert.equal(later.session.behavior.hiddenExposureRevealed, true);
});

test('查体项目未到释放阶段：阻止执行且不解锁体征；到达后可执行', async (t) => {
  const respiratory = FLAGSHIP_CASE.exams.find((item) => item.id === 'respiratory')!;
  respiratory.availableFromStage = 'tests';
  t.after(() => { delete respiratory.availableFromStage; });

  const session = createInitialSession('student-gated-ex', 'guided');
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'gated-ex-prep');
  assert.ok(session.unlockedEvidence.includes('EX_PREP'));
  assert.equal(session.stage, 'exam');

  const blocked = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'gated-ex-blocked');
  assert.equal(blocked.session.unlockedEvidence.includes('EX_RESP'), false, '未到释放时点不得解锁体征');
  assert.ok((blocked.feedback ?? '').includes('暂不可执行'));
  const blockedEvent = blocked.session.events.find((event) => event.clientEventId === 'gated-ex-blocked')!;
  assert.equal(blockedEvent.correct, false);

  await runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'tests' } }, 'gated-ex-nav');
  assert.equal(session.stage, 'tests');
  const allowed = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } }, 'gated-ex-allowed');
  assert.ok(allowed.session.unlockedEvidence.includes('EX_RESP'), '到达释放阶段后正常解锁');
  assert.ok(allowed.newMessages.some((message) => message.content.includes('湿啰音')));
});

test('检查结果未到回报时点：只记单待回报不泄露数值；到达后再次开单得真实结果', async (t) => {
  const cbc = FLAGSHIP_CASE.tests.find((item) => item.id === 'cbc-crp')!;
  cbc.availableFromStage = 'assessment';
  cbc.resultDelayNote = '标本送检，约 2 小时后回报。';
  t.after(() => { delete cbc.availableFromStage; delete cbc.resultDelayNote; });

  const session = createInitialSession('student-gated-test', 'guided');
  const ordered = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'cbc-crp' } }, 'gated-test-pending');
  assert.ok(ordered.newMessages.some((message) => message.content.includes('2 小时')), '应展示延迟回报说明');
  assert.equal(ordered.newMessages.some((message) => message.content.includes('白细胞12.6')), false, '未到回报时点不得泄露数值');
  assert.equal(ordered.session.unlockedEvidence.includes('TEST_CBC'), false, '待回报不解锁证据');
  assert.deepEqual(ordered.session.orderedTests, ['cbc-crp'], '开单应被记录');

  await runAgentTurn(session, {
    type: 'SUBMIT_DECISION',
    data: { diagnosis: '支气管肺炎', summary: '发热咳嗽 3 天，右下肺湿啰音。', diagnosisBasis: '发热咳嗽伴右下肺湿啰音，结合胸片浸润影', differentials: '需与喘息性支气管炎鉴别' },
  }, 'gated-test-decision');
  assert.equal(session.stage, 'assessment');

  const released = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'cbc-crp' } }, 'gated-test-released');
  assert.ok(released.newMessages.some((message) => message.content.includes('白细胞12.6')), '到达回报阶段后应返回真实结果');
  assert.ok(released.session.unlockedEvidence.includes('TEST_CBC'));
});

test('教师病例 testRelease 元数据：经 schema 解析、createSourceCase 应用并门控回报（全链路）', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pediatrics-gated-src-'));
  const oldRoot = process.env.PEDIATRICS_KNOWLEDGE_ROOT;
  process.env.PEDIATRICS_KNOWLEDGE_ROOT = temp;
  t.after(async () => {
    if (oldRoot === undefined) delete process.env.PEDIATRICS_KNOWLEDGE_ROOT; else process.env.PEDIATRICS_KNOWLEDGE_ROOT = oldRoot;
    await rm(temp, { recursive: true, force: true });
  });
  const id = 'teacher-肾病综合征';
  await mkdir(path.join(temp, 'teaching-cases'));
  // 合成夹具（非真实病例）：验证 testRelease 元数据链路，不代表真实教学病例内容。
  await writeFile(path.join(temp, 'teaching-cases', `${id}.json`), JSON.stringify({
    caseId: id, sourceName: '肾病综合征', sourceDocument: '合成夹具', age: '12岁', sex: '男', complaint: '水肿2周',
    sections: { history: '1.患儿，男，12岁；2.发现水肿2周。双下肢水肿。无血尿。', exam: 'T36.5℃，双肺呼吸音清，腹稍胀，移动浊音（+）。', tests: '尿常规：尿蛋白+++', diagnosis: '肾病综合征', plan: '合成夹具，不作为真实医疗建议。' },
    vitals: { temperature: 36.5, heartRate: null, respiratoryRate: null, spo2: null }, documents: [],
    testRelease: [{ testId: 'source-test-0', availableFromStage: 'assessment', resultDelayNote: '标本外送，次日回报。' }],
  }));

  const session = createInitialSession('student-gated-src', 'guided', id);
  const ordered = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'source-test-0' } }, 'gated-src-pending');
  assert.ok(ordered.newMessages.some((message) => message.content.includes('次日回报')), '应展示外送延迟说明');
  assert.equal(ordered.newMessages.some((message) => message.content.includes('尿蛋白')), false, '未到回报时点不得泄露结果');
  assert.equal(ordered.session.unlockedEvidence.includes('SOURCE_TEST_0'), false);
  assert.deepEqual(ordered.session.orderedTests, ['source-test-0']);

  await runAgentTurn(session, {
    type: 'SUBMIT_DECISION',
    data: { diagnosis: '肾病综合征', summary: '水肿 2 周。', diagnosisBasis: '水肿 2 周伴移动性浊音阳性，待尿蛋白结果确认', differentials: '需与急性肾炎鉴别' },
  }, 'gated-src-decision');
  assert.equal(session.stage, 'assessment');

  const released = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'source-test-0' } }, 'gated-src-released');
  assert.ok(released.newMessages.some((message) => message.content.includes('尿蛋白+++')), '到达回报阶段后应返回真实结果');
  assert.ok(released.session.unlockedEvidence.includes('SOURCE_TEST_0'));
});

test('缺省不设置 availableFromStage：既有病例行为不变（向后兼容）', async () => {
  const session = createInitialSession('student-ungated', 'guided');
  const exposure = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '幼儿园同学最近有类似症状吗？' } }, 'ungated-hx');
  assert.ok(exposure.session.unlockedEvidence.includes('HX_EXPOSURE'), '未设释放阶段的问诊事实任何阶段可问出');
  const cbc = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'cbc-crp' } }, 'ungated-test');
  assert.ok(cbc.newMessages.some((message) => message.content.includes('白细胞12.6')), '未设回报阶段的检查开单即回报');
});
