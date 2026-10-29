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

test('文本申请：匹配项返回真实结果，未匹配项明确「尚未识别」不编造', async (t) => {
  const { session, restore } = await withSourceCase();
  t.after(() => void restore());
  const orderedId = session.caseOptions!.tests[0].id;
  const orderedLabel = session.caseOptions!.tests[0].label;

  const result = await runAgentTurn(session, { type: 'ORDER_TEST', data: { requestedTests: `${orderedLabel}、基因检测`, reason: '明确蛋白尿程度' } }, 'text-order-1');
  // 匹配项：结果消息返回（真实病例资料）
  assert.ok(result.newMessages.some((message) => message.content.includes('尿蛋白+++')), '匹配项应返回病例真实结果');
  // 未匹配项：明确「资料未提供」，不编造结果
  assert.ok(result.newMessages.some((message) => message.content.includes('基因检测') && message.content.includes('尚未识别')), '未匹配项应明确资料未提供');
  // 只解锁匹配项证据；未匹配项不产生证据（caseOptions.tests 无 evidenceCode，从病例目录取）
  const matchedCatalogTest = getCase(session.caseId).tests.find((item) => item.id === orderedId)!;
  assert.ok(session.unlockedEvidence.includes(matchedCatalogTest.evidenceCode));
  assert.deepEqual(session.orderedTests, [orderedId]);
  // 事件：一条匹配结果事件 + 一条未匹配事件
  const orderEvents = session.events.filter((event) => event.type === 'ORDER_TEST');
  assert.equal(orderEvents.length, 2);
  assert.ok(orderEvents.some((event) => event.summary.includes('尚未识别')));
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
