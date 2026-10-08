import assert from 'node:assert/strict';
import test from 'node:test';
import { isPreviewEnabled } from '@/lib/preview-auth';

const keys = ['ENABLE_UI_PREVIEW', 'NODE_ENV', 'COZE_PROJECT_ENV'] as const;

function withEnvironment(values: Partial<Record<(typeof keys)[number], string>>, run: () => void): void {
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      const value = values[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else Reflect.set(process.env, key, value);
    }
    run();
  } finally {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else Reflect.set(process.env, key, value);
    }
  }
}

test('未显式开启时任何环境都不开放预览身份', () => withEnvironment({ NODE_ENV: 'production' }, () => {
  assert.equal(isPreviewEnabled(), false);
}));

test('显式开关可在开发环境开放评委预览；生产环境必须提供签名密钥（fail-closed）', () => {
  withEnvironment({ ENABLE_UI_PREVIEW: 'true', NODE_ENV: 'production', COZE_PROJECT_ENV: 'DEV' }, () => assert.equal(isPreviewEnabled(), true));
  // 生产无签名密钥：即使开关打开也禁用（防默认密钥伪造教师 cookie）
  withEnvironment({ ENABLE_UI_PREVIEW: 'true', NODE_ENV: 'production', COZE_PROJECT_ENV: 'PROD' }, () => assert.equal(isPreviewEnabled(), false));
  // 生产且显式提供密钥：开放
  process.env.PREVIEW_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef';
  withEnvironment({ ENABLE_UI_PREVIEW: 'true', NODE_ENV: 'production', COZE_PROJECT_ENV: 'PROD' }, () => assert.equal(isPreviewEnabled(), true));
  delete process.env.PREVIEW_SIGNING_SECRET;
  withEnvironment({ ENABLE_UI_PREVIEW: 'false', NODE_ENV: 'development', COZE_PROJECT_ENV: 'DEV' }, () => assert.equal(isPreviewEnabled(), false));
});
