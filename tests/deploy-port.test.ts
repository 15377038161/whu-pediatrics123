import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 端口与监听地址契约回归测试
 *
 * 背景（真实故障，2026-10-09）：
 *   dev 脚本曾硬编码 `next dev -H 127.0.0.1 -p 8765`，与平台网关转发的
 *   `<pod-ip>:5173` 不一致，且仅绑定本地回环地址导致网关容器无法访问，
 *   外部访问全部 502，登录入口完全不可用。
 *
 * 契约（修复后必须长期保持）：
 *   1. dev 脚本必须监听 0.0.0.0（网关从容器网络访问，非回环地址）。
 *   2. dev 脚本端口必须读取 DEPLOY_RUN_PORT（平台注入），允许 5173 兜底，
 *      禁止出现任何其它硬编码端口（如 8765）。
 *   3. 生产入口 src/server.ts 端口优先级 DEPLOY_RUN_PORT > PORT > 5173，
 *      监听地址默认 0.0.0.0。
 */

const projectRoot = resolve(__dirname, '..');

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

test('dev 脚本监听 0.0.0.0 且端口来自 DEPLOY_RUN_PORT', () => {
  const pkg = JSON.parse(readProjectFile('package.json')) as { scripts: Record<string, string> };
  const dev = pkg.scripts.dev;
  assert.ok(dev, 'package.json 必须定义 dev 脚本');
  assert.match(dev, /-H 0\.0\.0\.0/, 'dev 脚本必须绑定 0.0.0.0，网关才能从容器网络访问');
  assert.match(dev, /DEPLOY_RUN_PORT/, 'dev 脚本必须读取平台注入的 DEPLOY_RUN_PORT');
  assert.match(dev, /DEPLOY_RUN_PORT(:-5173)?\}/, 'DEPLOY_RUN_PORT 缺省时兜底端口只能是 5173');
});

test('dev 脚本不包含历史硬编码端口 8765 与回环绑定', () => {
  const pkg = JSON.parse(readProjectFile('package.json')) as { scripts: Record<string, string> };
  assert.ok(!/8765/.test(pkg.scripts.dev), 'dev 脚本禁止硬编码 8765（2026-10-09 502 根因）');
  assert.ok(!/127\.0\.0\.1|localhost/.test(pkg.scripts.dev), 'dev 脚本禁止绑定回环地址');
});

test('生产入口 server.ts 端口优先级 DEPLOY_RUN_PORT > PORT > 5173，默认监听 0.0.0.0', () => {
  const server = readProjectFile('src/server.ts');
  assert.match(server, /DEPLOY_RUN_PORT \|\| process\.env\.PORT \|\| '5173'/, '端口优先级必须为 DEPLOY_RUN_PORT > PORT > 5173');
  assert.match(server, /process\.env\.HOST \|\| '0\.0\.0\.0'/, '默认监听地址必须为 0.0.0.0');
});

test('构建产物入口与 dev 监听契约未被其它脚本改写为固定端口', () => {
  const pkg = JSON.parse(readProjectFile('package.json')) as { scripts: Record<string, string> };
  const { dev, build, start } = pkg.scripts;
  for (const [name, script] of Object.entries({ dev, build, start })) {
    if (!script) continue;
    assert.ok(
      !/-p\s+\d{4,5}\b/.test(script),
      `脚本 ${name} 禁止硬编码端口（发现固定 -p 端口）：${script}`,
    );
  }
});
