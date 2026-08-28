import assert from 'node:assert/strict';
import test from 'node:test';
import { APIError, NetworkError } from 'coze-coding-dev-sdk';
import { AIGatewayError, classifyAIError, invokeCozeAI } from '@/lib/coze-ai';

const messages = [{ role: 'user', content: '测试' }] as const;

test('classifyAIError 覆盖限流、权限、超时、服务端、网络与非法请求', () => {
  assert.deepEqual(
    { ...classifyAIError(new APIError('too many requests', 429)), detail: 'too many requests' },
    { kind: 'rate_limited', retryable: true, statusCode: 429, detail: 'too many requests' },
  );
  assert.equal(classifyAIError(new APIError('unauthorized', 401)).kind, 'auth');
  assert.equal(classifyAIError(new APIError('unauthorized', 401)).retryable, false);
  assert.equal(classifyAIError(new APIError('forbidden', 403)).kind, 'auth');
  assert.equal(classifyAIError(new APIError('bad request', 400)).kind, 'invalid_request');
  assert.equal(classifyAIError(new APIError('bad request', 400)).retryable, false);
  assert.equal(classifyAIError(new APIError('bad gateway', 502)).kind, 'server');
  assert.equal(classifyAIError(new APIError('bad gateway', 502)).retryable, true);
  assert.equal(classifyAIError(new APIError('opaque upstream error')).kind, 'server');
  assert.equal(classifyAIError(new NetworkError('socket hang up')).kind, 'network');
  assert.equal(classifyAIError(new NetworkError('socket hang up')).retryable, true);
  assert.equal(classifyAIError(new Error('COZE_AI_GATEWAY_TIMEOUT')).kind, 'timeout');
  assert.equal(classifyAIError(new Error('request timeout exceeded')).kind, 'timeout');
  assert.equal(classifyAIError(new Error('API key is required')).kind, 'config');
  assert.equal(classifyAIError(new Error('API key is required')).retryable, false);
});

test('invokeCozeAI 首次成功直接返回且不触发退避', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await invokeCozeAI(
    { messages: [...messages] },
    {
      invoke: async () => { calls += 1; return { content: 'ok' }; },
      sleep: async (ms) => { sleeps.push(ms); },
    },
  );
  assert.equal(result.content, 'ok');
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
  assert.equal(sleeps.length, 0);
});

test('invokeCozeAI 限流后按指数退避重试成功', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await invokeCozeAI(
    { messages: [...messages], maxAttempts: 3, retryBaseMs: 100 },
    {
      invoke: async () => {
        calls += 1;
        if (calls === 1) throw new APIError('rate limited', 429);
        return { content: 'recovered' };
      },
      sleep: async (ms) => { sleeps.push(ms); },
    },
  );
  assert.equal(result.content, 'recovered');
  assert.equal(result.attempts, 2);
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 100 && sleeps[0] < 300);
});

test('invokeCozeAI 重试耗尽后抛出带分类的 AIGatewayError', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  await assert.rejects(
    invokeCozeAI(
      { messages: [...messages], maxAttempts: 3, retryBaseMs: 50 },
      {
        invoke: async () => { calls += 1; throw new APIError('rate limited', 429); },
        sleep: async (ms) => { sleeps.push(ms); },
      },
    ),
    (error: unknown) => error instanceof AIGatewayError && error.info.kind === 'rate_limited' && error.attempts === 3,
  );
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
});

test('invokeCozeAI 认证异常不重试直接降级抛出', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  await assert.rejects(
    invokeCozeAI(
      { messages: [...messages], maxAttempts: 5, retryBaseMs: 50 },
      {
        invoke: async () => { calls += 1; throw new APIError('forbidden', 403); },
        sleep: async (ms) => { sleeps.push(ms); },
      },
    ),
    (error: unknown) => error instanceof AIGatewayError && error.info.kind === 'auth' && error.attempts === 1,
  );
  assert.equal(calls, 1);
  assert.equal(sleeps.length, 0);
});

test('invokeCozeAI 单次超时按超时分类并重试', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const result = await invokeCozeAI(
    { messages: [...messages], maxAttempts: 2, timeoutMs: 20, retryBaseMs: 10 },
    {
      invoke: () => {
        calls += 1;
        if (calls === 1) return new Promise(() => undefined);
        return Promise.resolve({ content: 'after-timeout' });
      },
      sleep: async (ms) => { sleeps.push(ms); },
    },
  );
  assert.equal(result.content, 'after-timeout');
  assert.equal(result.attempts, 2);
  assert.equal(sleeps.length, 1);
});

test('invokeCozeAI 尊重 Retry-After 提示的下限', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const rateLimited = new APIError('rate limited', 429, { headers: { 'retry-after': '2' } });
  await assert.rejects(
    invokeCozeAI(
      { messages: [...messages], maxAttempts: 2, retryBaseMs: 50 },
      {
        invoke: async () => { calls += 1; throw rateLimited; },
        sleep: async (ms) => { sleeps.push(ms); },
      },
    ),
    AIGatewayError,
  );
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 2000);
});
