import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET as beginChaoxingLogin } from '@/app/api/auth/chaoxing/route';
import { GET as finishChaoxingLogin } from '@/app/api/auth/callback/chaoxing/route';
import { getChaoxingLoginOptions, isChaoxingConfigured } from '@/lib/chaoxing-client';

const keys = [
  'ENABLE_CHAOXING_AUTH',
  'CHAOXING_APPID',
  'CHAOXING_SECRET',
  'CHAOXING_FIDS',
  'CHAOXING_PREFERRED_FID',
  'CHAOXING_REDIRECT_URI',
] as const;

function withChaoxingConfig<T>(run: () => Promise<T>): Promise<T> {
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    ENABLE_CHAOXING_AUTH: 'true',
    CHAOXING_APPID: 'test-app',
    CHAOXING_SECRET: 'test-secret',
    CHAOXING_FIDS: 'whu:武汉大学',
    CHAOXING_REDIRECT_URI: 'https://example.edu/api/auth/callback/chaoxing',
  });
  return run().finally(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('超星配置缺失时只返回明确错误页', async () => {
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    const response = await beginChaoxingLogin(new NextRequest('http://127.0.0.1:8765/api/auth/chaoxing'));
    assert.equal(response.status, 307);
    assert.match(response.headers.get('location') ?? '', /reason=config_missing/);
  } finally {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('多个裸 FID 使用单按钮，并优先以 1385 测试单位识别双归属账号', async () => withChaoxingConfig(async () => {
  process.env.CHAOXING_FIDS = '1024,1385';
  const response = await beginChaoxingLogin(new NextRequest('http://127.0.0.1:8765/api/auth/chaoxing'));
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.origin, 'https://auth.chaoxing.com');
  assert.equal(location.pathname, '/connect/oauth2/authorize');
  assert.equal(location.searchParams.get('state'), '1385');
}));

test('可显式覆盖多机构单按钮的优先识别 FID', async () => withChaoxingConfig(async () => {
  process.env.CHAOXING_FIDS = '1024,1385';
  process.env.CHAOXING_PREFERRED_FID = '1024';
  const response = await beginChaoxingLogin(new NextRequest('http://127.0.0.1:8765/api/auth/chaoxing'));
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.searchParams.get('state'), '1024');
}));

test('凭据完整且未设置总开关时默认启用超星登录', async () => withChaoxingConfig(async () => {
  delete process.env.ENABLE_CHAOXING_AUTH;
  assert.equal(isChaoxingConfigured(), true);
  assert.equal(getChaoxingLoginOptions().configured, true);
}));

test('显式关闭总开关时隐藏超星登录入口', async () => withChaoxingConfig(async () => {
  process.env.ENABLE_CHAOXING_AUTH = 'false';
  assert.equal(isChaoxingConfigured(), false);
  assert.equal(getChaoxingLoginOptions().configured, false);
}));

test('多个具名机构未选择时返回机构错误而不是配置缺失', async () => withChaoxingConfig(async () => {
  process.env.CHAOXING_FIDS = '1024:武汉大学,1385:测试机构';
  const response = await beginChaoxingLogin(new NextRequest('http://127.0.0.1:8765/api/auth/chaoxing'));
  assert.match(response.headers.get('location') ?? '', /reason=institution_mismatch/);
}));

test('缺少签名登录上下文的回调在访问超星前即被拒绝', async () => {
  const response = await finishChaoxingLogin(new NextRequest('http://127.0.0.1:8765/api/auth/callback/chaoxing?code=fake&state=whu'));
  assert.equal(response.status, 307);
  assert.match(response.headers.get('location') ?? '', /reason=oauth_expired/);
});

test('回调机构必须与发起登录时选择的机构一致', async () => withChaoxingConfig(async () => {
  const begin = await beginChaoxingLogin(new NextRequest('http://127.0.0.1:8765/api/auth/chaoxing?fid=whu&next=%2Fstudent'));
  const setCookie = begin.headers.get('set-cookie');
  assert.ok(setCookie);
  const cookie = setCookie.split(';', 1)[0];
  const callback = await finishChaoxingLogin(new NextRequest('http://127.0.0.1:8765/api/auth/callback/chaoxing?code=fake&state=other', {
    headers: { cookie },
  }));
  assert.equal(callback.status, 307);
  assert.match(callback.headers.get('location') ?? '', /reason=oauth_expired/);
}));
