import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET as caseIndexRoute } from '../src/app/api/teacher/case-index/route';
import {
  buildTeacherCaseIndex,
  getTeacherCaseIndexEntry,
  resolveTeacherCaseIndexEntry,
} from '../src/lib/teacher-case-index';
import { TEACHER_CASE_CATALOG } from '../src/domain/teacher-case-catalog';
import { CASE_PUBLIC_IDS } from '../src/lib/case-identity';
import admissionSummaries from '../src/domain/admission-summaries.json';

const summaries = admissionSummaries as Record<string, { age: string; sex: string; complaint: string }>;

test('教师端统一索引视图：67条、顺序一致、编号+诊断+完整主诉三要素齐全（批次2）', () => {
  const entries = buildTeacherCaseIndex();
  assert.equal(entries.length, TEACHER_CASE_CATALOG.length);
  assert.equal(entries.length, 67);
  entries.forEach((entry, index) => {
    const item = TEACHER_CASE_CATALOG[index];
    assert.ok(item);
    assert.equal(entry.id, item.id, '顺序与教师目录一致');
    assert.equal(entry.diagnosis, item.name, '诊断=目录病名');
    assert.ok(entry.diagnosis && entry.diagnosis.trim() !== '', '病名非空');
    assert.equal(typeof entry.indexNumber, 'number', '编号齐全');
    const publicId = CASE_PUBLIC_IDS[item.id];
    assert.ok(publicId, '映射覆盖');
    assert.equal(entry.complaint, summaries[publicId]?.complaint ?? null);
    assert.ok(entry.complaint && entry.complaint.trim() !== '', '主诉完整（当前数据无待核验）');
  });
});

test('67 个入口编号唯一，保留已退出入口的 62、64、65 空号', () => {
  const numbers = buildTeacherCaseIndex()
    .map((entry) => entry.indexNumber)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  assert.deepEqual(
    numbers,
    [...Array.from({ length: 61 }, (_, index) => index + 1), 63, 66, 67, 68, 69, 70],
  );
});

test('「诊断待确认」回退规则：三槽位独立失联回退（纯函数负测）', () => {
  const base = TEACHER_CASE_CATALOG[0];
  assert.ok(base);
  const noName = resolveTeacherCaseIndexEntry({ ...base, name: '   ' }, '发热2天');
  assert.equal(noName.diagnosis, null, '病名空白 → 诊断待确认');
  assert.equal(noName.complaint, '发热2天');

  const noComplaint = resolveTeacherCaseIndexEntry(base, '   ');
  assert.equal(noComplaint.complaint, null, '主诉空白 → 主诉待补充');
  const nullComplaint = resolveTeacherCaseIndexEntry(base, null);
  assert.equal(nullComplaint.complaint, null, '映射失联 → 主诉待补充');

  const normal = resolveTeacherCaseIndexEntry(base, '发热2天');
  assert.equal(normal.diagnosis, base.name);
  assert.equal(normal.complaint, '发热2天');
  assert.equal(typeof normal.indexNumber, 'number');
});

test('getTeacherCaseIndexEntry：命中返回条目，未知id返回null', () => {
  const first = TEACHER_CASE_CATALOG[0];
  assert.ok(first);
  const hit = getTeacherCaseIndexEntry(first.id);
  assert.ok(hit);
  assert.equal(hit.id, first.id);
  assert.equal(hit.complaint, buildTeacherCaseIndex()[0]?.complaint ?? null);
  assert.equal(getTeacherCaseIndexEntry('teacher-不存在的病种'), null);
});

test('下发条目不含 case-uuid（防透题映射不外泄）', () => {
  const uuidLike = /case-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
  for (const entry of buildTeacherCaseIndex()) {
    assert.ok(!uuidLike.test(JSON.stringify(entry)), `条目 ${entry.id} 不得携带公开病例id`);
  }
});

test('case-index路由：匿名401/学生403/教师200（合成Auth上游）', async () => {
  const keys = ['CODER_SUPABASE_URL', 'CODER_SUPABASE_ANON_KEY', 'COZE_SUPABASE_URL', 'COZE_SUPABASE_ANON_KEY'];
  const previous = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  let role = 'student';
  let whitelist = false;
  keys.forEach((key) => delete process.env[key]);
  process.env.COZE_SUPABASE_URL = 'https://case-index.invalid';
  process.env.COZE_SUPABASE_ANON_KEY = 'synthetic-test-key';
  // Local mock only: no real token, privilege change, or external network.
  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.ok(url.startsWith('https://case-index.invalid/'));
    if (url.includes('/auth/v1/user')) {
      return Response.json({
        id: '00000000-0000-0000-0000-000000000002',
        email: 'synthetic-index@example.invalid',
        email_confirmed_at: '2026-01-01',
        app_metadata: { app: { role } },
        user_metadata: {},
      });
    }
    if (url.includes('/rpc/app_is_teacher')) return Response.json(whitelist);
    throw new Error('Unexpected synthetic upstream path');
  };
  const request = (authenticated = true) =>
    new NextRequest('http://localhost/api/teacher/case-index', {
      headers: authenticated ? { authorization: 'Bearer synthetic-fixture' } : {},
    });
  try {
    assert.equal((await caseIndexRoute(request(false))).status, 401, '匿名 → 401');
    assert.equal((await caseIndexRoute(request())).status, 403, '学生 → 403');
    role = 'teacher';
    const response = await caseIndexRoute(request());
    assert.equal(response.status, 200, '教师 → 200');
    const body = (await response.json()) as { ok: boolean; data: Array<{ id: string; complaint: string | null }> };
    assert.equal(body.ok, true);
    assert.equal(body.data.length, 67);
    assert.ok(body.data[0]?.complaint, '教师可见完整主诉');
    whitelist = true;
    role = 'student';
    assert.equal((await caseIndexRoute(request())).status, 200, '白名单教师（学生角色）经RPC提升放行');
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
  }
});
