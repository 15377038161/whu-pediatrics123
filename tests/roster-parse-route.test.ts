import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { NextRequest } from 'next/server';
import { POST as rosterParseRoute } from '../src/app/api/teacher/roster-parse/route';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function rosterFile(rows: readonly unknown[][]): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('名单');
  rows.forEach((cells) => sheet.addRow(cells));
  return new File([new Uint8Array(await workbook.xlsx.writeBuffer())], '名单.xlsx', { type: XLSX_TYPE });
}

function textFileAsXlsx(text: string): File {
  return new File([new TextEncoder().encode(text)], '名单.xlsx', { type: 'text/csv' });
}

type FailBody = { ok: false; error: { code: string; message: string } };

/**
 * 名单解析路由：教师鉴权 + 解析失败必须把可操作的中文原因原样回给老师。
 * 上游用本地 mock（无真实 token、无外部网络），与 case-index 路由测试同一套合成身份方式。
 */
test('roster-parse 路由：匿名 401 / 学生 403 / 教师解析成功，格式错误回 422 原文提示', async () => {
  const keys = ['CODER_SUPABASE_URL', 'CODER_SUPABASE_ANON_KEY', 'COZE_SUPABASE_URL', 'COZE_SUPABASE_ANON_KEY'];
  const previous = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  let role = 'student';
  keys.forEach((key) => delete process.env[key]);
  process.env.COZE_SUPABASE_URL = 'https://roster-parse.invalid';
  process.env.COZE_SUPABASE_ANON_KEY = 'synthetic-test-key';
  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.ok(url.startsWith('https://roster-parse.invalid/'));
    if (url.includes('/auth/v1/user')) {
      return Response.json({
        id: '00000000-0000-0000-0000-000000000003',
        email: 'synthetic-roster@example.invalid',
        email_confirmed_at: '2026-01-01',
        app_metadata: { app: { role } },
        user_metadata: {},
      });
    }
    if (url.includes('/rpc/app_is_teacher')) return Response.json(false);
    throw new Error('Unexpected synthetic upstream path');
  };

  const post = async (file?: File, authenticated = true) => {
    const form = new FormData();
    if (file) form.append('file', file);
    return rosterParseRoute(new NextRequest('http://localhost/api/teacher/roster-parse', {
      method: 'POST',
      headers: authenticated ? { authorization: 'Bearer synthetic-fixture' } : {},
      body: form,
    }));
  };
  const failBody = async (response: Response) => (await response.json()) as FailBody;

  try {
    assert.equal((await post(undefined, false)).status, 401, '匿名 → 401');
    const valid = await rosterFile([['姓名', '学号'], ['张同学', '0001']]);
    assert.equal((await post(valid)).status, 403, '学生 → 403（名单导入是教师操作）');

    role = 'teacher';
    const response = await post(valid);
    assert.equal(response.status, 200, '教师 → 200');
    const body = (await response.json()) as { ok: true; data: { rows: Array<{ name: string; cxid: string; studentNo: string }> } };
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.rows, [{ name: '张同学', cxid: '', studentNo: '0001' }]);

    // 解析失败要带原因，不能被 errorFromUnknown 收敛成「系统暂时无法完成该操作」
    const broken = await post(textFileAsXlsx('姓名,学号\n张同学,0001'));
    assert.equal(broken.status, 422);
    const brokenBody = await failBody(broken);
    assert.equal(brokenBody.error.code, 'ROSTER_INVALID');
    assert.ok(brokenBody.error.message.includes('无法读取该文件'), `实际提示：${brokenBody.error.message}`);

    const headerless = await failBody(await post(await rosterFile([['张同学', '0001']])));
    assert.ok(headerless.error.message.includes('第一行需要是表头'), `实际提示：${headerless.error.message}`);

    const missing = await post(undefined);
    assert.equal(missing.status, 422, '缺文件字段 → 422');
    assert.equal((await failBody(missing)).error.code, 'ROSTER_FILE_REQUIRED');
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
