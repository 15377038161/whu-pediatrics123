import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { getRealOrigin } from '@/lib/auth-utils';

const COOKIE = 'luojia_peds_login_context';
const MAX_AGE = 60 * 30;
interface Context { version: 1; nextPath: string; fid: string; expiresAt: number }

function secret(): string {
  const value = process.env.CHAOXING_SECRET?.trim();
  if (!value) throw new Error('缺少CHAOXING_SECRET');
  return value;
}

function signature(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function encode(context: Context): string {
  const payload = Buffer.from(JSON.stringify(context)).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

function decode(value: string | undefined): Context | null {
  if (!value) return null;
  const [payload, signed, extra] = value.split('.');
  if (!payload || !signed || extra || !equal(signed, signature(payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Context>;
    if (parsed.version !== 1 || typeof parsed.nextPath !== 'string' || typeof parsed.fid !== 'string' || !parsed.fid || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) return null;
    return parsed as Context;
  } catch { return null; }
}

export function setLoginContextCookie(response: NextResponse, request: NextRequest, nextPath: string, fid: string): void {
  response.cookies.set(COOKIE, encode({ version: 1, nextPath, fid, expiresAt: Date.now() + MAX_AGE * 1000 }), {
    httpOnly: true,
    secure: getRealOrigin(request).startsWith('https:'),
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export function readLoginContext(request: NextRequest): Context | null {
  return decode(request.cookies.get(COOKIE)?.value);
}

export function clearLoginContextCookie(response: NextResponse, request: NextRequest): void {
  response.cookies.set(COOKIE, '', { httpOnly: true, secure: getRealOrigin(request).startsWith('https:'), sameSite: 'lax', path: '/', maxAge: 0 });
}
