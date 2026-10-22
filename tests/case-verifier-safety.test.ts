import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
test('批量验收脚本无隔离确认/无凭据时在登录前失败关闭', () => {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:CODER_|COZE_|RLS_PROBE_|PERSIST_PROBE_)/.test(key))), NODE_ENV: 'test' as const };
  for (const [args, expected] of [[[], 'ISOLATED_TEST_CONFIRMATION_REQUIRED'], [['--confirm-test-db'], 'CREDENTIAL_FILE_REQUIRED']] as const) {
    // 超时上限 180s：全量套件并行负载下 tsx 子进程冷启动实测可超 60s（2026-10-22 重跑中 61196ms 触发超时击杀，
    // status=null 误报为断言失败；隔离运行约 2s）。本用例验证脚本失败关闭行为而非性能，
    // 放宽上限不改变断言语义（退出码 1 + stderr 消息）。
    const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-case-library.ts', ...args], { env, encoding: 'utf8', timeout: 180000 });
    assert.equal(child.status, 1);
    assert.ok(child.stderr.includes(expected));
  }
});
