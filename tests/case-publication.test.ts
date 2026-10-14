import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  getUnpublishedCaseIds,
  assertCasePublishedForNewSession,
  getCasePublicationOverview,
  setCasePublication,
} from '../src/lib/case-publication';
import { eligibleAdmissions, selectAdmission } from '../src/lib/case-admission';
import { TEACHER_CASE_CATALOG } from '../src/domain/teacher-case-catalog';


/**
 * 病例发布管理（单例上下架）测试：
 * - folder=null（catalog-only，缺少原始接诊资料）条目可上下架；未知 ID 拒绝；
 * - 学生新建会话守卫 CASE_UNPUBLISHED（教师/白名单豁免，非 teacher- 病例放行）；
 * - 学生目录过滤与随机/下一病例抽取不包含已下架病例（保留同源去重）；
 * - 历史读取（getSession）不校验发布状态（源码契约，下架不拦截既有会话恢复）；
 * - 教师写入接口身份门禁（应用层教师角色 AND 数据库白名单；源码契约）。
 *
 * DB 路径通过本地 PostgREST 模拟服务验证；每份测试文件由 node:test 以独立进程运行，
 * env 覆盖（CODER_SUPABASE_URL → 127.0.0.1 模拟服务）不会泄漏到其他测试。
 */

const UNPUBLISHED_THREE = ['teacher-新生儿脑梗死', 'teacher-支气管肺炎', 'teacher-格林巴利综合征'] as const;

const here = dirname(fileURLToPath(import.meta.url));
function readSource(relative: string): string {
  return readFileSync(join(here, relative), 'utf8');
}

interface MockSupabaseOptions {
  unpublishedRows?: Array<{ case_id: string }>;
  allRows?: Array<Record<string, unknown>>;
  isTeacher?: boolean;
}

interface MockSupabase {
  url: string;
  upserts: Array<Record<string, unknown>>;
  close(): Promise<void>;
}

function startMockSupabase(options: MockSupabaseOptions = {}): Promise<MockSupabase> {
  const upserts: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/rest/v1/rpc/app_is_teacher') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(options.isTeacher ?? false));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/rest/v1/case_publication') {
      const select = url.searchParams.get('select') ?? '';
      res.writeHead(200, { 'content-type': 'application/json' });
      // getUnpublishedCaseIds: select=case_id（published=eq.false 过滤）；overview: 全字段 select。
      if (select === 'case_id') {
        res.end(JSON.stringify(options.unpublishedRows ?? []));
      } else {
        res.end(JSON.stringify(options.allRows ?? []));
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/rest/v1/case_publication') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
      req.on('end', () => {
        const payload = JSON.parse(body) as Record<string, unknown>;
        upserts.push(payload);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify([payload]));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        upserts,
        close: () => new Promise<void>((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}

function overrideSupabaseEnv(url: string): void {
  process.env.CODER_SUPABASE_URL = url;
  process.env.CODER_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.CODER_SUPABASE_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID ?? 'test-tenant';
}

function clearSupabaseEnv(): void {
  delete process.env.CODER_SUPABASE_URL;
  delete process.env.COZE_SUPABASE_URL;
  delete process.env.CODER_SUPABASE_ANON_KEY;
  delete process.env.COZE_SUPABASE_ANON_KEY;
}

test('前置：三个目标病例均为目录 folder=null 条目（catalog-only，缺原始资料）', () => {
  for (const caseId of UNPUBLISHED_THREE) {
    const item = TEACHER_CASE_CATALOG.find((entry) => entry.id === caseId);
    assert.ok(item, `目录应包含 ${caseId}`);
    assert.equal(item.folder, null);
    assert.equal(item.status, 'catalog-only');
  }
});

test('未知病例 ID：setCasePublication 在目录校验处拒绝 CASE_NOT_FOUND（不触达数据库）', async () => {
  clearSupabaseEnv(); // 无 DB 配置下仍应先抛 CASE_NOT_FOUND，证明目录校验先于 DB 写入
  await assert.rejects(
    setCasePublication('token', 'teacher-x', 'teacher-不存在的病例', false, ''),
    /CASE_NOT_FOUND/,
  );
});

test('folder=null 病例：目录校验通过并可下架/重新上架（missingSource=true，保留审计字段）', async () => {
  const mock = await startMockSupabase();
  overrideSupabaseEnv(mock.url);
  try {
    const reason = '缺少原始接诊资料，暂时下架；资料补齐并审核后恢复';
    const down = await setCasePublication('token', 'teacher-x', 'teacher-新生儿脑梗死', false, reason);
    assert.equal(down.caseId, 'teacher-新生儿脑梗死');
    assert.equal(down.published, false);
    assert.equal(down.reason, reason);
    assert.equal(down.missingSource, true);
    assert.equal(mock.upserts.length, 1);
    assert.equal(mock.upserts[0]?.case_id, 'teacher-新生儿脑梗死');
    assert.equal(mock.upserts[0]?.published, false);
    assert.equal(mock.upserts[0]?.updated_by, 'teacher-x');

    const up = await setCasePublication('token', 'teacher-x', 'teacher-新生儿脑梗死', true, '');
    assert.equal(up.published, true);
    assert.equal(up.missingSource, true);
    assert.equal(mock.upserts.length, 2);
  } finally {
    await mock.close();
    clearSupabaseEnv();
  }
});

test('学生新建守卫：已下架病例抛 CASE_UNPUBLISHED', async () => {
  const mock = await startMockSupabase({
    unpublishedRows: UNPUBLISHED_THREE.map((case_id) => ({ case_id })),
    isTeacher: false,
  });
  overrideSupabaseEnv(mock.url);
  try {
    for (const caseId of UNPUBLISHED_THREE) {
      await assert.rejects(
        assertCasePublishedForNewSession(caseId, 'student', 'student-token'),
        /CASE_UNPUBLISHED/,
      );
    }
  } finally {
    await mock.close();
    clearSupabaseEnv();
  }
});

test('教师豁免：应用层教师角色直接放行（仍可预览复核已下架病例）', async () => {
  const mock = await startMockSupabase({
    unpublishedRows: UNPUBLISHED_THREE.map((case_id) => ({ case_id })),
  });
  overrideSupabaseEnv(mock.url);
  try {
    await assertCasePublishedForNewSession('teacher-支气管肺炎', 'teacher', 'teacher-token');
  } finally {
    await mock.close();
    clearSupabaseEnv();
  }
});

test('白名单教师豁免：数据库 app_is_teacher=true 时学生角色也放行', async () => {
  const mock = await startMockSupabase({
    unpublishedRows: UNPUBLISHED_THREE.map((case_id) => ({ case_id })),
    isTeacher: true,
  });
  overrideSupabaseEnv(mock.url);
  try {
    await assertCasePublishedForNewSession('teacher-支气管肺炎', 'student', 'whitelist-teacher-token');
  } finally {
    await mock.close();
    clearSupabaseEnv();
  }
});

test('非 teacher- 病例与无令牌预览态：不触发发布守卫（fail-open 仅限预览语义）', async () => {
  await assertCasePublishedForNewSession('demo-case-1', 'student', null);
  clearSupabaseEnv(); // 预览态（无 DB 配置）返回空下架集合
  await assertCasePublishedForNewSession('teacher-支气管肺炎', 'student', null);
});

test('教师发布状态对照：包含 folder=null 条目并标记 missingSource（含已下架状态与理由）', async () => {
  const mock = await startMockSupabase({
    allRows: [
      { case_id: 'teacher-支气管肺炎', published: false, updated_at: '2026-10-14T03:00:00Z', updated_by: 'teacher-x', reason: '缺少原始接诊资料，暂时下架' },
    ],
  });
  overrideSupabaseEnv(mock.url);
  try {
    const overview = await getCasePublicationOverview('teacher-token');
    assert.equal(overview.length, TEACHER_CASE_CATALOG.length);
    const down = overview.find((row) => row.caseId === 'teacher-支气管肺炎');
    assert.ok(down);
    assert.equal(down.published, false);
    assert.equal(down.missingSource, true);
    assert.equal(down.reason, '缺少原始接诊资料，暂时下架');
    assert.equal(down.updatedBy, 'teacher-x');
    const normal = overview.find((row) => row.caseId === 'teacher-新生儿呼吸窘迫综合征');
    assert.ok(normal);
    assert.equal(normal.published, true); // 无行 = 已发布缺省开放
    assert.equal(normal.missingSource, false);
    for (const caseId of UNPUBLISHED_THREE) {
      assert.equal(overview.find((row) => row.caseId === caseId)?.missingSource, true);
    }
  } finally {
    await mock.close();
    clearSupabaseEnv();
  }
});

test('目录过滤：eligibleAdmissions 剔除三例已下架病例，其余已发布条目保留', () => {
  const unpublished = new Set<string>(UNPUBLISHED_THREE);
  const candidates = eligibleAdmissions(unpublished);
  for (const caseId of UNPUBLISHED_THREE) {
    assert.ok(!candidates.some((item) => item.caseId === caseId), `${caseId} 不应进入候选池`);
  }
  assert.ok(candidates.length > 0, '其余已发布病例仍应可选');
  // 同源去重保留：候选池按 sourceId 去重，无重复源。
  const sourceIds = candidates.map((item) => item.sourceId);
  assert.equal(new Set(sourceIds).size, sourceIds.length);
});

test('随机/下一病例：selectAdmission 重复抽取不命中三例已下架病例', () => {
  const unpublished = new Set<string>(UNPUBLISHED_THREE);
  const candidates = eligibleAdmissions(unpublished);
  for (let i = 0; i < 60; i += 1) {
    const picked = selectAdmission(candidates, undefined, false, () => Math.random());
    assert.ok(!UNPUBLISHED_THREE.includes(picked as (typeof UNPUBLISHED_THREE)[number]));
  }
});

test('源码契约：会话恢复（getSession）不校验发布状态，仅新建会话（createSession）调用守卫', () => {
  const source = readSource('../src/lib/repository.ts');
  const createSessionBody = source.slice(source.indexOf('async createSession('), source.indexOf('async getSession('));
  const getSessionBody = source.slice(source.indexOf('async getSession('));
  assert.ok(
    createSessionBody.includes('assertCasePublishedForNewSession'),
    'createSession 应调用发布守卫（学生新建拦截 CASE_UNPUBLISHED）',
  );
  assert.ok(
    !getSessionBody.includes('assertCasePublishedForNewSession'),
    'getSession（既有会话恢复/历史读取）不应校验发布状态',
  );
});

test('源码契约：新建会话路由将 CASE_UNPUBLISHED 映射为 403（服务端拒绝，非仅前端隐藏）', () => {
  const source = readSource('../src/app/api/sessions/route.ts');
  assert.ok(source.includes('CASE_UNPUBLISHED'));
  assert.ok(/CASE_UNPUBLISHED[^;]*?\?\s*403/.test(source), 'CASE_UNPUBLISHED 应映射 403');
});

test('源码契约：发布管理写入接口保留教师身份 + 数据库白名单双重门禁', () => {
  const source = readSource('../src/app/api/teacher/case-publication/route.ts');
  assert.ok(source.includes("requireAuth(request, 'teacher'"), '应用层教师角色校验');
  assert.ok(source.includes('isTeacherByWhitelist'), '数据库白名单校验');
  for (const handler of ['export async function GET', 'export async function POST']) {
    assert.ok(source.includes(handler));
  }
  // GET/POST 均需先经过 requireTeacher 门禁再进入业务逻辑。
  const postBody = source.slice(source.indexOf('export async function POST'));
  assert.ok(postBody.indexOf('requireTeacher') < postBody.indexOf('setCasePublication'), 'POST 必须先过教师门禁再写发布状态');
});
