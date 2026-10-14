import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
test('批量验收脚本无隔离确认/无凭据时在登录前失败关闭', () => {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:CODER_|COZE_|RLS_PROBE_|PERSIST_PROBE_)/.test(key))), NODE_ENV: 'test' as const };
  for (const [args, expected] of [[[], 'ISOLATED_TEST_CONFIRMATION_REQUIRED'], [['--confirm-test-db'], 'CREDENTIAL_FILE_REQUIRED']] as const) {
    // 超时上限 60s：全量套件并行负载下 tsx 子进程冷启动可超过 20s（隔离运行约 2s），
    // 本用例验证脚本失败关闭行为而非性能，放宽上限不改变断言语义。
    const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-case-library.ts', ...args], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(child.status, 1);
    assert.ok(child.stderr.includes(expected));
  }
});
