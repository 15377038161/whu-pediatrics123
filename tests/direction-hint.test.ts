import './fixtures/legacy-engine-catalog';
import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest, NextResponse } from 'next/server';
import type { Message } from 'coder-coding-dev-sdk';
import type { SessionState } from '@/domain/agent';
import {
  generateDirectionHint,
  getDirectionHintQuota,
  parseDirectionHint,
  type DirectionHintInsert,
  type DirectionHintRecordRow,
  type DirectionHintStore,
} from '@/lib/direction-hint';
import { POST as createSession } from '@/app/api/sessions/route';
import { GET as hintQuota } from '@/app/api/sessions/[id]/direction-hint/route';
import { setPreviewCookie } from '@/lib/preview-auth';

class MemoryHintStore implements DirectionHintStore {
  readonly rows: Array<DirectionHintRecordRow & { sessionId: string; requestId: string }> = [];
  async list(sessionId: string) {
    return this.rows.filter((row) => row.sessionId === sessionId).map((row) => ({ clientEventId: row.clientEventId, trace: structuredClone(row.trace) }));
  }
  async insert(input: DirectionHintInsert): Promise<'inserted' | 'conflict'> {
    if (this.rows.some((row) => row.sessionId === input.sessionId && row.clientEventId === input.clientEventId)) return 'conflict';
    this.rows.push({
      sessionId: input.sessionId,
      requestId: input.requestId,
      clientEventId: input.clientEventId,
      trace: [{ kind: 'direction_hint', requestId: input.requestId, stage: input.stage, hint: input.hint }],
    });
    return 'inserted';
  }
}

function session(id = 'session-1'): Pick<SessionState, 'id' | 'stage' | 'vitals' | 'events' | 'messages'> {
  return { id, stage: 'history', vitals: { temperature: null, heartRate: null, respiratoryRate: null, spo2: null }, events: [], messages: [] };
}

const model = (content = '{"hint":"可继续补充询问症状开始时间与变化过程。"}') =>
  async (_messages: Message[]) => ({ content, model: 'test-model' });

test('三次成功占满固定槽，第四次在调用模型前拒绝', async () => {
  const store = new MemoryHintStore();
  let calls = 0;
  const generate = async (messages: Message[]) => { calls += 1; return model()(messages); };
  for (const requestId of ['r1', 'r2', 'r3']) {
    const result = await generateDirectionHint(session(), requestId, { store, generate });
    assert.equal(result.hint.includes('补充询问'), true);
  }
  assert.deepEqual(await getDirectionHintQuota(store, 'session-1'), { used: 3, remaining: 0 });
  await assert.rejects(() => generateDirectionHint(session(), 'r4', { store, generate }), /HINT_QUOTA_EXHAUSTED/);
  assert.equal(calls, 3);
  assert.equal(store.rows.length, 3);
});

test('同请求标记重试返回原提示，不重复占槽；跨阶段复用被拒绝', async () => {
  const store = new MemoryHintStore();
  let calls = 0;
  const generate = async (messages: Message[]) => { calls += 1; return model()(messages); };
  const first = await generateDirectionHint(session(), 'same-request', { store, generate });
  const retry = await generateDirectionHint(session(), 'same-request', { store, generate });
  assert.deepEqual(retry, first);
  assert.equal(store.rows.length, 1);
  assert.equal(calls, 1);
  await assert.rejects(() => generateDirectionHint({ ...session(), stage: 'exam' }, 'same-request', { store, generate }), /HINT_REQUEST_CONFLICT/);
});

test('模型失败、结构失败和答案越界均不落额度', async () => {
  const store = new MemoryHintStore();
  await assert.rejects(() => generateDirectionHint(session(), 'failed-model', {
    store,
    generate: async () => { throw new Error('model unavailable'); },
  }), /model unavailable/);
  await assert.rejects(() => generateDirectionHint(session(), 'bad-json', { store, generate: model('not-json') }), /HINT_INVALID_RESPONSE/);
  await assert.rejects(() => generateDirectionHint(session(), 'answer-leak', { store, generate: model('{"hint":"最可能诊断是肺炎，立即给予抗生素。"}') }), /HINT_INVALID_RESPONSE/);
  assert.equal(store.rows.length, 0);
  assert.deepEqual(await getDirectionHintQuota(store, 'session-1'), { used: 0, remaining: 3 });
  assert.throws(() => parseDirectionHint('{"hint":"诊断是肺炎"}'), /HINT_INVALID_RESPONSE/);
});

test('不同请求并发最多三次成功；同请求并发只占一个槽', async () => {
  const store = new MemoryHintStore();
  const generate = async (messages: Message[]) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    return model()(messages);
  };
  const results = await Promise.allSettled(['a', 'b', 'c', 'd', 'e'].map((requestId) => generateDirectionHint(session(), requestId, { store, generate })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 3);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 2);
  assert.equal(store.rows.length, 3);
  assert.deepEqual(await getDirectionHintQuota(store, 'session-1'), { used: 3, remaining: 0 });

  const sameStore = new MemoryHintStore();
  const same = await Promise.all([
    generateDirectionHint(session('same-session'), 'same-id', { store: sameStore, generate }),
    generateDirectionHint(session('same-session'), 'same-id', { store: sameStore, generate }),
  ]);
  assert.deepEqual(same[0], same[1]);
  assert.equal(sameStore.rows.length, 1);
});

test('额度按会话隔离，路由匿名/教师/OSCE 均 fail-closed', async () => {
  const store = new MemoryHintStore();
  await generateDirectionHint(session('owner-session'), 'owner-r1', { store, generate: model() });
  assert.deepEqual(await getDirectionHintQuota(store, 'other-session'), { used: 0, remaining: 3 });

  const saved = process.env.ENABLE_UI_PREVIEW;
  process.env.ENABLE_UI_PREVIEW = 'true';
  try {
    const anonymous = await hintQuota(new NextRequest('http://localhost/api/sessions/x/direction-hint'), { params: Promise.resolve({ id: 'x' }) });
    assert.equal(anonymous.status, 401);

    const studentResponse = NextResponse.json({});
    setPreviewCookie(studentResponse, 'student');
    const studentCookie = studentResponse.cookies.get('luojia_peds_preview_student')!;
    const requestFor = (cookie: string, body?: unknown) => new NextRequest('http://localhost/api/sessions', {
      method: body ? 'POST' : 'GET',
      headers: { cookie, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const created = await createSession(requestFor(`${studentCookie.name}=${studentCookie.value}`, { mode: 'osce', caseId: 'peds-respiratory-001', clientRequestId: crypto.randomUUID() }));
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    const sessionId = createdBody.data.id as string;
    const disabled = await hintQuota(requestFor(`${studentCookie.name}=${studentCookie.value}`), { params: Promise.resolve({ id: sessionId }) });
    assert.equal(disabled.status, 403);
    assert.equal((await disabled.json()).error.code, 'HINT_DISABLED');

    const teacherResponse = NextResponse.json({});
    setPreviewCookie(teacherResponse, 'teacher');
    const teacherCookie = teacherResponse.cookies.get('luojia_peds_preview_teacher')!;
    const forbidden = await hintQuota(requestFor(`${teacherCookie.name}=${teacherCookie.value}`), { params: Promise.resolve({ id: sessionId }) });
    assert.equal(forbidden.status, 403);
  } finally {
    if (saved === undefined) delete process.env.ENABLE_UI_PREVIEW; else process.env.ENABLE_UI_PREVIEW = saved;
  }
});


test('后续提示包含此前方向，避免三次机会重复同一建议', async () => {
  const store = new MemoryHintStore();
  const first = await generateDirectionHint(session(), 'first', { store, generate: model() });
  await generateDirectionHint(session(), 'second', { store, generate: async messages => {
    const context = JSON.parse(messages[1].content as string);
    assert.deepEqual(context.previousHints, [first.hint]);
    assert.match(messages[0].content as string, /不要重复previousHints/);
    return model('{"hint":"可以继续了解患儿既往就诊与处理后的变化。"}')(messages);
  } });
});
