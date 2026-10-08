import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import type { AppRole, UserContext } from '@/domain/agent';

export const PREVIEW_COOKIE = 'luojia_peds_preview';
// 沙箱网关会向无 Cookie 请求回放其 jar 中的陈旧预览 Cookie（app.log 实证），
// 曾导致"退出→学生预览登录"后仍被旧教师 Cookie 串角色。
// 防线：角色后缀 Cookie 名隔离 + 双角色 Cookie 同时存在时 fail-closed 拒识 + 登录时清除另一角色。
const PREVIEW_COOKIE_LEGACY = 'luojia_peds_preview';
const PREVIEW_COOKIE_TEACHER = 'luojia_peds_preview_teacher';
const PREVIEW_COOKIE_STUDENT = 'luojia_peds_preview_student';
const MAX_AGE = 60 * 60 * 8;

interface PreviewPayload {
  version: 1;
  role: AppRole;
  expiresAt: number;
}

export function isPreviewEnabled(): boolean {
  if (process.env.ENABLE_UI_PREVIEW !== 'true') return false;
  // 生产环境 fail-closed：未显式提供签名密钥时禁用预览，
  // 否则任何人可用公开的默认密钥伪造教师身份 cookie。
  const production = process.env.CODER_PROJECT_ENV === 'PROD' || process.env.COZE_PROJECT_ENV === 'PROD';
  if (production) return Boolean(process.env.PREVIEW_SIGNING_SECRET?.trim());
  return true;
}

function secret(): string {
  // 仅非生产环境允许回退到本地默认密钥；生产环境由 isPreviewEnabled 保证密钥必填
  return process.env.PREVIEW_SIGNING_SECRET?.trim() || 'local-preview-only-luojia-pediatrics';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function encode(role: AppRole): string {
  const payload = Buffer.from(JSON.stringify({ version: 1, role, expiresAt: Date.now() + MAX_AGE * 1000 } satisfies PreviewPayload)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function decode(value: string | undefined): PreviewPayload | null {
  if (!isPreviewEnabled() || !value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra || !safeEqual(signature, sign(payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<PreviewPayload>;
    if (parsed.version !== 1 || (parsed.role !== 'student' && parsed.role !== 'teacher') || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) return null;
    return parsed as PreviewPayload;
  } catch {
    return null;
  }
}

function previewCookieName(role: AppRole): string {
  return role === 'teacher' ? PREVIEW_COOKIE_TEACHER : PREVIEW_COOKIE_STUDENT;
}

export function setPreviewCookie(response: NextResponse, role: AppRole): void {
  // 1. 清除另一角色的 Cookie（防止网关回放旧值与本角色共存）
  // 2. 清除旧版单名 Cookie（历史会话残留）
  // 3. 写入本角色的后缀 Cookie
  response.cookies.set(previewCookieName(role === 'teacher' ? 'student' : 'teacher'), '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  response.cookies.set(PREVIEW_COOKIE_LEGACY, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  response.cookies.set(previewCookieName(role), encode(role), {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function clearPreviewCookie(response: NextResponse): void {
  // 全量清除：角色后缀 Cookie + 旧版单名 Cookie，确保退出后无残留
  response.cookies.set(PREVIEW_COOKIE_LEGACY, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  response.cookies.set(PREVIEW_COOKIE_TEACHER, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  response.cookies.set(PREVIEW_COOKIE_STUDENT, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

type CookieSource = { get(name: string): { value: string } | undefined };

export function readPreviewUser(cookies: CookieSource): UserContext | null {
  if (!isPreviewEnabled()) return null;
  // 冲突 fail-closed：两个角色 Cookie 同时存在（网关回放陈旧值/异常合并）时，
  // 一律拒绝识别预览身份，要求重新登录，防止旧教师 Cookie 串用学生会话。
  const teacherPayload = decode(cookies.get(PREVIEW_COOKIE_TEACHER)?.value);
  const studentPayload = decode(cookies.get(PREVIEW_COOKIE_STUDENT)?.value);
  if (teacherPayload && studentPayload) return null;
  // 旧版单名 Cookie 与新版角色 Cookie 共存时同样拒绝（迁移期防串用）
  const legacyPayload = decode(cookies.get(PREVIEW_COOKIE_LEGACY)?.value);
  if (legacyPayload && (teacherPayload || studentPayload)) return null;
  const payload = teacherPayload ?? studentPayload ?? legacyPayload;
  if (!payload) return null;
  return payload.role === 'teacher'
    ? { id: 'preview-teacher-001', role: 'teacher', displayName: '评委预览教师', studentNo: null, provider: 'preview', chaoxingUid: null }
    : { id: 'preview-student-001', role: 'student', displayName: '评委预览学生', studentNo: 'PREVIEW-001', provider: 'preview', chaoxingUid: null };
}
