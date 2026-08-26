import { NextRequest, NextResponse } from 'next/server';
import { getRealOrigin } from '@/lib/auth-utils';
import { ChaoxingLoginError, type ChaoxingLoginErrorReason } from '@/lib/chaoxing-client';

export type LoginErrorReason = ChaoxingLoginErrorReason | 'oauth_expired' | 'session_failed';

const reasons = new Set<LoginErrorReason>([
  'config_missing',
  'institution_mismatch',
  'oauth_failed',
  'oauth_expired',
  'session_failed',
]);

export function normalizeLoginErrorReason(value: string): LoginErrorReason {
  return reasons.has(value as LoginErrorReason) ? value as LoginErrorReason : 'oauth_failed';
}

export function chaoxingErrorReason(error: unknown): LoginErrorReason {
  return error instanceof ChaoxingLoginError ? error.reason : 'oauth_failed';
}

export function loginErrorRedirect(request: NextRequest, reason: LoginErrorReason): NextResponse {
  const url = new URL('/auth/error', getRealOrigin(request));
  url.searchParams.set('reason', reason);
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
