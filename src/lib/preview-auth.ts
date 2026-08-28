import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import type { AppRole, UserContext } from '@/domain/agent';

export const PREVIEW_COOKIE = 'luojia_peds_preview';
const MAX_AGE = 60 * 60 * 8;

interface PreviewPayload {
  version: 1;
  role: AppRole;
  expiresAt: number;
}

export function isPreviewEnabled(): boolean {
  return process.env.ENABLE_UI_PREVIEW === 'true';
}

function secret(): string {
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

export function setPreviewCookie(response: NextResponse, role: AppRole): void {
  response.cookies.set(PREVIEW_COOKIE, encode(role), {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function clearPreviewCookie(response: NextResponse): void {
  response.cookies.set(PREVIEW_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

type CookieSource = { get(name: string): { value: string } | undefined };

export function readPreviewUser(cookies: CookieSource): UserContext | null {
  const payload = decode(cookies.get(PREVIEW_COOKIE)?.value);
  if (!payload) return null;
  return payload.role === 'teacher'
    ? { id: 'preview-teacher-001', role: 'teacher', displayName: '评委预览教师', studentNo: null, provider: 'preview', chaoxingUid: null }
    : { id: 'preview-student-001', role: 'student', displayName: '评委预览学生', studentNo: 'PREVIEW-001', provider: 'preview', chaoxingUid: null };
}
