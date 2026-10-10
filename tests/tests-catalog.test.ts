import test from 'node:test';
import assert from 'node:assert/strict';
import { getSessionTestsCatalog, listCaseTests, getCaseTestResult, setSessionTestsCatalog } from '../src/lib/case-snapshot';

/** 辅助检查目录/结果分离（死锁修复）配套测试：
 *  会话作用域目录缓存（无答案，仅 id/label）与 RPC 封装的 fail-closed 行为。 */

test('目录缓存往返：set 后按 sessionId+version 命中', () => {
  setSessionTestsCatalog('session-catalog-a', 'v1', [{ id: 'source-test-0', label: '血常规' }, { id: 'source-test-1', label: '检查记录 2' }]);
  const items = getSessionTestsCatalog('teacher-x', 'v1', 'session-catalog-a');
  assert.equal(items?.length, 2);
  assert.equal(items?.[0]?.label, '血常规');
});

test('目录缓存版本不匹配返回 null（版本绑定校验）', () => {
  setSessionTestsCatalog('session-catalog-b', 'v1', [{ id: 'source-test-0', label: '血常规' }]);
  assert.equal(getSessionTestsCatalog('teacher-x', 'v2', 'session-catalog-b'), null);
  assert.equal(getSessionTestsCatalog('teacher-x', null, 'session-catalog-b'), null);
});

test('无 sessionId / 未注入目录返回 null', () => {
  assert.equal(getSessionTestsCatalog('teacher-x', 'v1', null), null);
  assert.equal(getSessionTestsCatalog('teacher-x', 'v1', 'session-not-exist'), null);
});

test('listCaseTests：无 accessToken（匿名/预览）fail-closed 返回 null，不编造目录', async () => {
  const result = await listCaseTests('teacher-x', 'v1', 'session-c', null);
  assert.equal(result, null);
});

test('getCaseTestResult：无 accessToken fail-closed 返回 null，不编造结果', async () => {
  const result = await getCaseTestResult('teacher-x', 'v1', 'session-c', null, 'source-test-0');
  assert.equal(result, null);
});
