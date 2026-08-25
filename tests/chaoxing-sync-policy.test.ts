import assert from 'node:assert/strict';
import test from 'node:test';
import { planSyncFailure } from '@/lib/chaoxing-sync-policy';

const now = Date.parse('2026-08-23T00:00:00.000Z');

test('网络错误与服务端错误按指数退避重试', () => {
  const network = planSyncFailure(0, null, now);
  const server = planSyncFailure(2, 503, now);
  assert.deepEqual(network, { status: 'retry', attemptCount: 1, nextAttemptAt: '2026-08-23T00:02:00.000Z' });
  assert.deepEqual(server, { status: 'retry', attemptCount: 3, nextAttemptAt: '2026-08-23T00:08:00.000Z' });
});

test('限流类4xx继续重试，凭据或字段类4xx直接失败', () => {
  assert.equal(planSyncFailure(0, 429, now).status, 'retry');
  assert.equal(planSyncFailure(0, 401, now).status, 'failed');
  assert.equal(planSyncFailure(0, 422, now).status, 'failed');
});

test('可重试错误最多尝试八次', () => {
  const final = planSyncFailure(7, 500, now);
  assert.equal(final.status, 'failed');
  assert.equal(final.attemptCount, 8);
  assert.equal(final.nextAttemptAt, '2026-08-23T00:00:00.000Z');
});
