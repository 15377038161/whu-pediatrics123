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

test('构建包默认不开放预览身份', () => withEnvironment({ ENABLE_UI_PREVIEW: 'true', NODE_ENV: 'production' }, () => {
  assert.equal(isPreviewEnabled(), false);
}));

test('只有明确的Coze开发环境可以在生产构建中开放预览身份', () => {
  withEnvironment({ ENABLE_UI_PREVIEW: 'true', NODE_ENV: 'production', COZE_PROJECT_ENV: 'DEV' }, () => assert.equal(isPreviewEnabled(), true));
  withEnvironment({ ENABLE_UI_PREVIEW: 'true', NODE_ENV: 'production', COZE_PROJECT_ENV: 'PROD' }, () => assert.equal(isPreviewEnabled(), false));
});
