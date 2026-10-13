import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent } from '@/domain/agent';
import { __setTestOrderRpcForTests, createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { setSessionTestsCatalog } from '@/lib/case-snapshot';
import { errorFromUnknown } from '@/lib/api-result';

/** 503 路径注入失败验证（缺口B）——开单链路 record/get 失败时的会话一致性：
 *  1) record 网络/权限失败（TEST_ORDER_RPC_FAILED）：回合失败，不新增下单、不解锁证据、不记事件；
 *  2) record 守卫拒绝（返回 null → TEST_ORDER_REJECTED）：同上，不伪记下单；
 *  3) record 成功 + get 网络失败（TEST_RESULT_RPC_FAILED）：回合失败，不记「资料缺失」、不解锁评分证据；
 *  4) record 成功 + get 返回 null（守卫竞态/数据异常 → TEST_RESULT_UNAVAILABLE）：
 *     不落入「资料未提供」分支——不记资料缺失、不解锁证据；可重试且 record 幂等；
 *  5) 成功路径与重试幂等：失败重试后正常记单解锁；同一项目重复开单 orderedTests 去重。
 *  场景构造：目录内 teacher 病例 + 唯一假版本（readTeacherCaseData 版本不匹配且无缓存 → 资料不足），
 *  会话作用域目录缓存注入 result 为空的目录项 → handleTest 走 record/get RPC 路径。 */

const CASE_ID = 'teacher-川崎病';
const TOKEN = 'token-503-test';

function buildSession(sessionId: string, version: string) {
  // createInitialSession 的 session.id 恒为新 UUID（sessionId 参数仅用于 getCase 预载），
  // 目录缓存键须与 runAgentTurn 内 findTest 实际使用的 session.id 一致
  const session = createInitialSession('user-503', 'guided', CASE_ID, undefined, version, sessionId);
  session.sourceSnapshotVersion = version;
  setSessionTestsCatalog(session.id, version, [{ id: 'source-test-0', label: '血常规' }]);
  return session;
}

function orderEvent(testId: string): AgentEvent {
  return { type: 'ORDER_TEST', data: { testId } };
}

function assertSessionUntouched(session: ReturnType<typeof buildSession>, baselineMessages: number) {
  assert.deepEqual(session.orderedTests, [], '失败回合不得新增下单');
  assert.deepEqual(session.unlockedEvidence, [], '失败回合不得解锁证据');
  assert.equal(session.events.length, 0, '失败回合不得记临床事件');
  assert.equal(session.messages.length, baselineMessages, '失败回合不得新增消息（不伪记资料未提供）');
}

test('record 网络/权限失败：回合失败，不新增下单/证据/事件', async () => {
  __setTestOrderRpcForTests({ record: async () => { throw new Error('TEST_ORDER_RPC_FAILED'); } });
  try {
    const session = buildSession('sess-503-rec-net', 'v-503-rec-net');
    await assert.rejects(
      runAgentTurn(session, orderEvent('source-test-0'), 'evt-rec-net', { accessToken: TOKEN }),
      /TEST_ORDER_RPC_FAILED/,
    );
    assertSessionUntouched(session, 2);
  } finally {
    __setTestOrderRpcForTests(null);
  }
});

test('record 守卫拒绝（null）：TEST_ORDER_REJECTED，不伪记下单', async () => {
  __setTestOrderRpcForTests({ record: async () => null });
  try {
    const session = buildSession('sess-503-rec-rej', 'v-503-rec-rej');
    await assert.rejects(
      runAgentTurn(session, orderEvent('source-test-0'), 'evt-rec-rej', { accessToken: TOKEN }),
      /TEST_ORDER_REJECTED/,
    );
    assertSessionUntouched(session, 2);
  } finally {
    __setTestOrderRpcForTests(null);
  }
});

test('record 成功 + get 网络失败：TEST_RESULT_RPC_FAILED，不记资料缺失/不解锁评分', async () => {
  __setTestOrderRpcForTests({
    record: async () => ['source-test-0'],
    getResult: async () => { throw new Error('TEST_RESULT_RPC_FAILED'); },
  });
  try {
    const session = buildSession('sess-503-get-net', 'v-503-get-net');
    await assert.rejects(
      runAgentTurn(session, orderEvent('source-test-0'), 'evt-get-net', { accessToken: TOKEN }),
      /TEST_RESULT_RPC_FAILED/,
    );
    assertSessionUntouched(session, 2);
    assert.equal(session.messages.some((item) => item.content.includes('资料未提供')), false, '不得伪记资料未提供');
  } finally {
    __setTestOrderRpcForTests(null);
  }
});

test('record 成功 + get 返回 null：TEST_RESULT_UNAVAILABLE，不落入「资料未提供」分支', async () => {
  __setTestOrderRpcForTests({
    record: async () => ['source-test-0'],
    getResult: async () => null,
  });
  try {
    const session = buildSession('sess-503-get-null', 'v-503-get-null');
    await assert.rejects(
      runAgentTurn(session, orderEvent('source-test-0'), 'evt-get-null', { accessToken: TOKEN }),
      /TEST_RESULT_UNAVAILABLE/,
    );
    assertSessionUntouched(session, 2);
    assert.equal(session.unlockedEvidence.includes('SOURCE_TEST_0'), false, '不得解锁评分证据');
    assert.equal(session.messages.some((item) => item.content.includes('资料未提供')), false, '不得把读取 null 当真缺资料');
  } finally {
    __setTestOrderRpcForTests(null);
  }
});

test('失败重试后成功记单解锁；同项目重复开单幂等（orderedTests 去重）', async () => {
  let getAttempts = 0;
  __setTestOrderRpcForTests({
    record: async () => ['source-test-0'],
    getResult: async () => {
      getAttempts += 1;
      if (getAttempts === 1) throw new Error('TEST_RESULT_RPC_FAILED');
      return { id: 'source-test-0', label: '血常规', result: 'WBC 12.3×10^9/L，N 78%' };
    },
  });
  try {
    const session = buildSession('sess-503-retry', 'v-503-retry');
    // 第一次：record 成功、get 503 → 回合失败，无状态变更（DB 侧 orderedTests 已落，SQL 幂等）
    await assert.rejects(
      runAgentTurn(session, orderEvent('source-test-0'), 'evt-retry-1', { accessToken: TOKEN }),
      /TEST_RESULT_RPC_FAILED/,
    );
    assert.deepEqual(session.orderedTests, []);
    // 重试：record 幂等（重复调用不重复记单），get 成功 → 正常记单解锁
    const retried = await runAgentTurn(session, orderEvent('source-test-0'), 'evt-retry-2', { accessToken: TOKEN });
    assert.deepEqual(retried.session.orderedTests, ['source-test-0']);
    assert.ok(retried.session.unlockedEvidence.includes('SOURCE_TEST_0'));
    assert.ok(retried.session.events.some((item) => item.type === 'ORDER_TEST' && item.evidenceCodes.includes('SOURCE_TEST_0')));
    assert.ok(retried.newMessages.some((item) => item.content.includes('WBC 12.3×10^9/L')));
    // 同项目再次开单：orderedTests 去重仍为单条
    const again = await runAgentTurn(session, orderEvent('source-test-0'), 'evt-retry-3', { accessToken: TOKEN });
    assert.deepEqual(again.session.orderedTests, ['source-test-0']);
    assert.equal(again.session.events.filter((item) => item.type === 'ORDER_TEST').length, 1, '已有结果重复申请不新增证据');
  } finally {
    __setTestOrderRpcForTests(null);
  }
});

test('错误映射：三类开单失败均映射 RPC_UNAVAILABLE（503 可重试）', () => {
  for (const code of ['TEST_ORDER_RPC_FAILED', 'TEST_RESULT_RPC_FAILED', 'TEST_RESULT_UNAVAILABLE']) {
    const mapped = errorFromUnknown(new Error(code));
    assert.equal(mapped.code, 'RPC_UNAVAILABLE', `${code} 应映射 RPC_UNAVAILABLE`);
    assert.equal(mapped.retryable, true, `${code} 应可重试`);
  }
  const rejected = errorFromUnknown(new Error('TEST_ORDER_REJECTED'));
  assert.equal(rejected.code, 'TEST_ORDER_REJECTED');
  assert.equal(rejected.retryable, false);
});

test('预览内存模式（无 accessToken）：不经 RPC，保留既有「资料未提供」fail-closed 语义', async () => {
  const session = buildSession('sess-503-preview', 'v-503-preview');
  const result = await runAgentTurn(session, orderEvent('source-test-0'), 'evt-preview');
  assert.deepEqual(result.session.orderedTests, ['source-test-0']);
  assert.equal(result.session.unlockedEvidence.includes('SOURCE_TEST_0'), false, '无结果不解锁检查证据');
  assert.ok(result.newMessages.some((item) => item.content.includes('资料未提供')));
});
