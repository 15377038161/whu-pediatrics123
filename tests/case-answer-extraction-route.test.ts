import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';

import { POST } from '../src/app/api/teacher/case-answer-extraction/route';

const ENV_KEYS = ['CODER_SUPABASE_URL', 'CODER_SUPABASE_ANON_KEY', 'COZE_SUPABASE_URL', 'COZE_SUPABASE_ANON_KEY'];

/** 合成 Auth 上游：不触真实 Supabase、不签真实令牌、不做任何权限变更。 */
async function withSyntheticAuth(role: 'student' | 'teacher', run: () => Promise<void>): Promise<void> {
  const previous = ENV_KEYS.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.COZE_SUPABASE_URL = 'https://case-answer-extraction.invalid';
  process.env.COZE_SUPABASE_ANON_KEY = 'synthetic-test-key';
  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.ok(url.startsWith('https://case-answer-extraction.invalid/'), `unexpected upstream ${url}`);
    if (url.includes('/auth/v1/user')) {
      return Response.json({
        id: '00000000-0000-0000-0000-000000000003',
        email: 'synthetic-extraction@example.invalid',
        email_confirmed_at: '2026-01-01',
        app_metadata: { app: { role } },
        user_metadata: {},
      });
    }
    if (url.includes('/rpc/app_is_teacher')) return Response.json(role === 'teacher');
    throw new Error('Unexpected synthetic upstream path');
  };
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    ENV_KEYS.forEach((key, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

function post(body: unknown, authenticated: boolean): NextRequest {
  return new NextRequest('http://localhost/api/teacher/case-answer-extraction', {
    method: 'POST',
    headers: {
      ...(authenticated ? { authorization: 'Bearer synthetic-fixture' } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function bodyOf(response: Response): Promise<{ error?: { code?: string; message?: string } }> {
  return (await response.json()) as { error?: { code?: string; message?: string } };
}

test('标答抽取路由：匿名401、学生403、参数无效422、未知病例404（不触模型）', async () => {
  await withSyntheticAuth('student', async () => {
    const anonymous = await POST(post({ caseId: 'teacher-化脓性脑膜炎' }, false));
    assert.equal(anonymous.status, 401);

    const asStudent = await POST(post({ caseId: 'teacher-化脓性脑膜炎' }, true));
    assert.equal(asStudent.status, 403);
    assert.equal((await bodyOf(asStudent)).error?.code, 'FORBIDDEN');
  });

  await withSyntheticAuth('teacher', async () => {
    const invalid = await POST(post({ caseId: '' }, true));
    assert.equal(invalid.status, 422);
    assert.equal((await bodyOf(invalid)).error?.code, 'INVALID_REQUEST');

    const unknownVersion = await POST(post({ caseId: 'teacher-化脓性脑膜炎', version: 'not-a-fingerprint' }, true));
    assert.equal(unknownVersion.status, 422);

    const missing = await POST(post({ caseId: 'no-such-case' }, true));
    assert.equal(missing.status, 404);
    const detail = await bodyOf(missing);
    assert.equal(detail.error?.code, 'CASE_NOT_FOUND');
    assert.match(detail.error?.message ?? '', /未找到该病例的可核验原件/);

    const extraField = await POST(post({ caseId: 'no-such-case', unexpected: true }, true));
    assert.equal(extraField.status, 422, 'strict schema 拒绝多余字段');
  });
});
