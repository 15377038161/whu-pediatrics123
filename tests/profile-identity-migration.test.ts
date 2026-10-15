import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// 静态重放安全契约；不等同于真实数据库 RPC 验收。
const directory = join(__dirname, '..', 'supabase', 'migrations');
const definitions = readdirSync(directory).sort().map(name => ({ name, sql: readFileSync(join(directory, name), 'utf8') }))
  .filter(file => /create or replace function sync_profile_identity\s*\(/i.test(file.sql));
const latest = definitions.at(-1)!;
const body = latest.sql.split(/as\s+\$\$/i)[1].split('$$')[0];

test('完整迁移顺序的最终同步函数不读取客户端角色', () => {
  assert.equal(latest.name, '20261015161000_profile_identity_server_role.sql');
  assert.doesNotMatch(body, /\bp_app_role\b/i);
  assert.match(body, /case when app_is_teacher\(\) is true then 'teacher' else 'student' end/i);
});

test('同步只写认证用户，匿名退出，执行权不开放给匿名角色', () => {
  assert.match(body, /v_uid uuid := auth\.uid\(\)/i);
  assert.match(body, /if v_uid is null then\s+return false/i);
  assert.match(latest.sql, /revoke all on function sync_profile_identity\([^;]+from public, anon/i);
  assert.match(latest.sql, /grant execute on function sync_profile_identity\([^;]+to authenticated/i);
  assert.doesNotMatch(latest.sql, /insert into teacher_emails/i);
});

test('旧 RPC 签名兼容，既有审计分类与历史迁移保持不变', () => {
  assert.match(latest.sql, /p_app_role text/);
  assert.doesNotMatch(body.split(/on conflict \(id\) do update/i)[1], /app_role\s*=/i);
  assert.match(definitions.find(file => file.name === '20261014180000_profile_identity_sync.sql')!.sql, /case when p_app_role in/);
});
