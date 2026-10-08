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

// 网关 Cookie 回放导致的角色串用防护：角色后缀 Cookie + 冲突 fail-closed
// （实证：退出后网关向无 Cookie 请求回放旧教师 Cookie，学生预览登录后被串成教师身份）
function makePreviewCookies(values: Record<string, string>): { get(name: string): { value: string } | undefined } {
  return { get: (name: string) => (name in values ? { value: values[name] } : undefined) };
}

test('学生登录后携带学生Cookie正常识别为学生身份', () => withEnvironment({ ENABLE_UI_PREVIEW: 'true', COZE_PROJECT_ENV: 'DEV' }, () => {
  const { readPreviewUser, setPreviewCookie } = require('@/lib/preview-auth') as typeof import('@/lib/preview-auth');
  const { NextResponse } = require('next/server') as typeof import('next/server');
  const res = NextResponse.json({ ok: true });
  setPreviewCookie(res, 'student');
  const studentCookieHeader = res.cookies.get('luojia_peds_preview_student')?.value;
  assert.ok(studentCookieHeader, '应设置学生角色后缀 Cookie');
  const user = readPreviewUser(makePreviewCookies({ luojia_peds_preview_student: studentCookieHeader }));
  assert.equal(user?.displayName, '评委预览学生');
}));

test('冲突fail-closed：新旧两个角色Cookie同时存在时拒绝识别（防网关回放串用）', () => withEnvironment({ ENABLE_UI_PREVIEW: 'true', COZE_PROJECT_ENV: 'DEV' }, () => {
  const { readPreviewUser, setPreviewCookie } = require('@/lib/preview-auth') as typeof import('@/lib/preview-auth');
  const { NextResponse } = require('next/server') as typeof import('next/server');
  const resT = NextResponse.json({ ok: true });
  setPreviewCookie(resT, 'teacher');
  const teacherCookie = resT.cookies.get('luojia_peds_preview_teacher')?.value;
  const resS = NextResponse.json({ ok: true });
  setPreviewCookie(resS, 'student');
  const studentCookie = resS.cookies.get('luojia_peds_preview_student')?.value;
  // 网关回放旧教师 Cookie + 浏览器持有新学生 Cookie → 双 Cookie 共存 → fail-closed
  assert.equal(readPreviewUser(makePreviewCookies({ luojia_peds_preview_teacher: teacherCookie, luojia_peds_preview_student: studentCookie })), null);
  // 旧版单名 Cookie 与新角色 Cookie 共存 → 同样拒绝（迁移期防串用）
  assert.equal(readPreviewUser(makePreviewCookies({ luojia_peds_preview: teacherCookie, luojia_peds_preview_student: studentCookie })), null);
  // 单一教师 Cookie（未过期、无冲突）仍可识别
  const teacherOnly = readPreviewUser(makePreviewCookies({ luojia_peds_preview_teacher: teacherCookie }));
  assert.equal(teacherOnly?.displayName, '评委预览教师');
}));

test('登录时清除另一角色与旧版单名Cookie（防网关jar陈旧值残留）', () => withEnvironment({ ENABLE_UI_PREVIEW: 'true', COZE_PROJECT_ENV: 'DEV' }, () => {
  const { setPreviewCookie } = require('@/lib/preview-auth') as typeof import('@/lib/preview-auth');
  const { NextResponse } = require('next/server') as typeof import('next/server');
  const res = NextResponse.json({ ok: true });
  setPreviewCookie(res, 'student');
  assert.equal(res.cookies.get('luojia_peds_preview_teacher')?.value, '', '应清除教师角色 Cookie');
  assert.equal(res.cookies.get('luojia_peds_preview')?.value, '', '应清除旧版单名 Cookie');
  assert.ok(res.cookies.get('luojia_peds_preview_student')?.value, '应设置学生 Cookie');
}));
