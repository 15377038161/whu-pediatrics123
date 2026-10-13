import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
test('批量验收脚本无隔离确认/无凭据时在登录前失败关闭', () => {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:CODER_|COZE_|RLS_PROBE_|PERSIST_PROBE_)/.test(key))), NODE_ENV: 'test' as const };
  for (const [args, expected] of [[[], 'ISOLATED_TEST_CONFIRMATION_REQUIRED'], [['--confirm-test-db'], 'CREDENTIAL_FILE_REQUIRED']] as const) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-case-library.ts', ...args], { env, encoding: 'utf8', timeout: 20000 });
    assert.equal(child.status, 1);
    assert.ok(child.stderr.includes(expected));
  }
});
