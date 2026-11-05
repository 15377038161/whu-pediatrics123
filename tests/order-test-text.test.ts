import './fixtures/legacy-engine-catalog';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { getCase } from '@/domain/case';

/** 任务2：辅助检查自主文本申请（ORDER_TEST.requestedTests）引擎路径：
 *  文本匹配目录项返回结果、未匹配项 fail-closed 记「资料未提供」、同批去重、
 *  空申请拒绝、旧 testId 点选路径语义不变。 */

async function withSourceCase(): Promise<{ session: ReturnType<typeof createInitialSession>; temp: string; restore: () => Promise<void> }> {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'pediatrics-text-order-'));
  const oldRoot = process.env.PEDIATRICS_KNOWLEDGE_ROOT;
  const oldFixture = process.env.ENABLE_AI_FIXTURE;
  process.env.PEDIATRICS_KNOWLEDGE_ROOT = temp;
  process.env.ENABLE_AI_FIXTURE = 'true';
  const id = 'teacher-肾病综合征';
  await mkdir(path.join(temp, 'teaching-cases'));
  await writeFile(path.join(temp, 'teaching-cases', `${id}.json`), JSON.stringify({ caseId: id, sourceName: '肾病综合征', sourceDocument: '病例正文', age: '12岁', sex: '男', complaint: '水肿2周',
    sections: { history: '1.患儿，男，12岁；2.发现水肿2周。双下肢水肿。无血尿。', exam: 'T36.5℃，双肺呼吸音清，腹稍胀，移动浊音（+）。', tests: '尿常规：尿蛋白+++', diagnosis: '肾病综合征', plan: '测试用原病例诊疗经过，不作为真实医疗建议。' },
    vitals: { temperature: 36.5, heartRate: null, respiratoryRate: null, spo2: null }, documents: [] }));
  const session = createInitialSession('student-text', 'guided', id);
  return {
    session,
    temp,
    restore: async () => {
      if (oldRoot === undefined) delete process.env.PEDIATRICS_KNOWLEDGE_ROOT; else process.env.PEDIATRICS_KNOWLEDGE_ROOT = oldRoot;
      if (oldFixture === undefined) delete process.env.ENABLE_AI_FIXTURE; else process.env.ENABLE_AI_FIXTURE = oldFixture;
      await rm(temp, { recursive: true, force: true });
    },
  };
}

test('文本申请：匹配项返回真实结果，模型不可用时保留未匹配申请且不解锁假结果', async (t) => {
  const { session, restore } = await withSourceCase();
  t.after(() => void restore());
  const orderedId = session.caseOptions!.tests[0].id;
  const orderedLabel = session.caseOptions!.tests[0].label;

  const result = await runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: `${orderedLabel}、基因检测`, reason: '明确蛋白尿程度' } }, 'text-order-1');
  // 匹配项：结果消息返回（真实病例资料）
  assert.ok(result.newMessages.some((message) => message.content.includes('尿蛋白+++')), '匹配项应返回病例真实结果');
  // 未匹配项：明确「资料未提供」，不编造结果
  assert.ok(result.newMessages.some((message) => message.content.includes('基因检测') && message.content.includes('资料未提供')), '未匹配项应明确资料未提供');
  // 只解锁匹配项证据；未匹配项不产生证据（caseOptions.tests 无 evidenceCode，从病例目录取）
  const matchedCatalogTest = getCase(session.caseId).tests.find((item) => item.id === orderedId)!;
  assert.ok(session.unlockedEvidence.includes(matchedCatalogTest.evidenceCode));
  assert.deepEqual(session.orderedTests, [orderedId]);
  // 事件：一条匹配结果事件 + 一条未匹配事件
  const orderEvents = session.events.filter((event) => event.type === 'ORDER_TEST');
  assert.equal(orderEvents.length, 2);
  assert.ok(orderEvents.some((event) => event.summary.includes('资料未提供')));
  // trace：确定性匹配说明 + 申请理由
  assert.ok(result.trace.some((item) => item.label.includes('确定性别名匹配')));
  assert.ok(result.trace.some((item) => item.label.includes('明确蛋白尿程度')));
  assert.equal(session.stage, 'tests');
});

test('同批重复申请同一项目只处理一次；空申请（仅分隔符）被拒绝', async (t) => {
  const { session, restore } = await withSourceCase();
  t.after(() => void restore());
  const orderedLabel = session.caseOptions!.tests[0].label;
  const result = await runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: `${orderedLabel}，${orderedLabel}` } }, 'text-order-dup');
  assert.equal(result.newMessages.filter((message) => message.content.includes('尿蛋白')).length, 1, '重复申请只返回一次结果');
  assert.equal(session.events.filter((event) => event.type === 'ORDER_TEST').length, 1);

  await assert.rejects(
    () => runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: '、，；' } }, 'text-order-empty'),
    /TEST_REQUEST_EMPTY/,
  );
});

test('旧 testId 点选路径语义不变（兼容历史会话续答）', async (t) => {
  const { session, restore } = await withSourceCase();
  t.after(() => void restore());
  const target = session.caseOptions!.tests[0];
  const result = await runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: target.id } }, 'legacy-order-1');
  assert.ok(result.newMessages[0].content.includes('尿蛋白+++'));
  assert.deepEqual(session.orderedTests, [target.id]);
  await assert.rejects(
    () => runAgentTurn(session, { type: 'ORDER_TEST', data: { testId: 'not-exist' } }, 'legacy-order-missing'),
    /TEST_NOT_FOUND/,
  );
  assert.equal(getCase(session.caseId).tests.length > 0, true);
});

test('history 直接查看 tests 后开单：不得从 history 跨过 exam 推进业务阶段', async (t) => {
  const { session, restore } = await withSourceCase();
  t.after(() => void restore());
  await runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'history' } }, 'history-test-forward');
  const navigation = await runAgentTurn(session, { type: 'NAVIGATE_STAGE', data: { stage: 'tests' } }, 'history-test-view-tests');
  assert.equal(navigation.session.stage, 'history', '回看 tests 只改变 viewStage');
  assert.equal(navigation.session.viewStage, 'tests');

  const result = await runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: '血常规、C反应蛋白、CT' } }, 'history-test-order');
  assert.equal(result.session.stage, 'history', '不得触发 training_sessions_guard 的跨阶段拒绝');
  assert.match(result.feedback ?? '', /从当前问诊阶段进入查体/);
  assert.equal(result.session.events.filter((event) => event.type === 'ORDER_TEST').length, 0, '前置不足时不写入开单事件');
});

test('exam 无需完成查体操作即可一格开单；后续阶段回看开单不回退业务stage', async (t) => {
  const { session, restore } = await withSourceCase();
  t.after(() => void restore());
  session.stage = 'exam';
  session.viewStage = 'tests';
  const fromExam = await runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: '血常规' } }, 'exam-order-without-exam-action');
  assert.equal(fromExam.session.stage, 'tests');
  assert.equal(fromExam.session.events.some((event) => event.type === 'EXAM_ACTION'), false, '不得新增查体项目或数量门槛');

  session.stage = 'assessment';
  session.viewStage = 'tests';
  const fromLaterStage = await runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: 'C反应蛋白' } }, 'later-stage-order');
  assert.equal(fromLaterStage.session.stage, 'assessment', '后续阶段回看开单不得回退业务阶段');
  assert.equal(fromLaterStage.session.events.some((event) => event.type === 'ORDER_TEST' && event.summary.includes('C反应蛋白')), true);
});

test('跨次重复提交同一未匹配申请，不重复追加记录', async (t) => {
  const { session, restore } = await withSourceCase();
  t.after(() => void restore());
  const first = await runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: '基因检测' } }, 'dedupe-text-1');
  assert.ok(first.newMessages.some((item) => item.content.includes('资料未提供')), '首次提交应记录资料未提供');

  const second = await runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: '基因检测' } }, 'dedupe-text-2');
  assert.equal(session.events.filter((event) => event.type === 'ORDER_TEST').length, 1, '重复提交不得重复追加检查事件');
  assert.equal(session.messages.filter((item) => item.content.includes('基因检测')).length, 1, '重复提交不得重复追加系统消息');
  assert.equal(second.newMessages.length, 0, '重复提交不产生新的系统消息');
});

test('跨次重复提交同一「资料未提供」的目录项，不重复追加记录', async (t) => {
  const { session, restore } = await withSourceCase();
  t.after(() => void restore());
  const label = session.caseOptions!.tests[0].label;
  await runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: label } }, 'dedupe-result-1');
  const eventsAfterFirst = session.events.filter((event) => event.type === 'ORDER_TEST').length;
  await runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: label } }, 'dedupe-result-2');
  assert.equal(session.events.filter((event) => event.type === 'ORDER_TEST').length, eventsAfterFirst, '已出结果的检查重复申请不再追加事件');
});
