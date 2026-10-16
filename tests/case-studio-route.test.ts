import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST as document } from '../src/app/api/teacher/case-drafts/document/route';
import { GET as drafts } from '../src/app/api/teacher/case-drafts/route';

test('病例工作室真实路由 + 合成Auth上游：匿名/学生/白名单失败拒绝，教师上传与详情允许', async () => {
  const keys = [
    'CODER_SUPABASE_URL',
    'CODER_SUPABASE_ANON_KEY',
    'COZE_SUPABASE_URL',
    'COZE_SUPABASE_ANON_KEY',
  ];
  const previous = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  let role = 'student',
    whitelist = false,
    dbReads = 0;
  keys.forEach((key) => delete process.env[key]);
  process.env.COZE_SUPABASE_URL = 'https://case-studio.invalid';
  process.env.COZE_SUPABASE_ANON_KEY = 'synthetic-test-key';
  // Local mock only: no real token, sign-up, privilege change, or external network.
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith('https://case-studio.invalid/'));
    if (url.includes('/auth/v1/user'))
      return Response.json({
        id: '00000000-0000-0000-0000-000000000001',
        email: 'synthetic@example.invalid',
        email_confirmed_at: '2026-01-01',
        app_metadata: { app: { role } },
        user_metadata: {},
      });
    if (url.includes('/rpc/app_is_teacher')) return Response.json(whitelist);
    if (url.includes('/case_draft_imports')) {
      dbReads++;
      assert.equal(init?.method ?? 'GET', 'GET');
      return Response.json(null);
    }
    throw new Error('Unexpected synthetic upstream path');
  };
  const upload = (authenticated = true) => {
    const form = new FormData();
    form.set(
      'file',
      new File(['主诉：发热2天\n性别：女\n年龄：3岁'], '教学.txt'),
    );
    return new NextRequest(
      'http://localhost/api/teacher/case-drafts/document',
      {
        method: 'POST',
        headers: authenticated
          ? { authorization: 'Bearer synthetic-fixture' }
          : {},
        body: form,
      },
    );
  };
  const detail = () =>
    new NextRequest(
      'http://localhost/api/teacher/case-drafts?id=00000000-0000-0000-0000-000000000001',
      { headers: { authorization: 'Bearer synthetic-fixture' } },
    );
  try {
    assert.equal((await document(upload(false))).status, 401);
    assert.equal((await document(upload())).status, 403);
    assert.equal((await drafts(detail())).status, 403);
    role = 'teacher';
    assert.equal((await document(upload())).status, 403);
    assert.equal(dbReads, 0);
    whitelist = true;
    const response = await document(upload());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = (await response.json()).data;
    assert.equal(data.payload.sex, '女');
    assert.equal(data.payload.age, '3岁');
    assert.equal(data.payload.complaint, '发热2天');
    assert.equal(dbReads, 0, '预览不得写入或查询草稿正文');
    assert.equal((await drafts(detail())).status, 404);
    assert.equal(dbReads, 1);
    const bad = new NextRequest(
      'http://localhost/api/teacher/case-drafts?id=invalid',
      { headers: { authorization: 'Bearer synthetic-fixture' } },
    );
    assert.equal((await drafts(bad)).status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
  }
});
