import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getSupabaseCredentials } from '@/lib/supabase-client';
import { SUPABASE_AUTH_COOKIE_NAME, SUPABASE_COOKIE_ENCODING } from '@/lib/supabase-cookie-config';

interface CookieReader {
  getAll(): Array<{ name: string; value: string }>;
}

interface CookieMutation {
  name: string;
  value: string;
  options: CookieOptions;
}

function secureCookie(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.COZE_PROJECT_ENV === 'PROD';
}

function createBaseClient(getAll: () => Array<{ name: string; value: string }>, setAll: (cookies: CookieMutation[]) => void) {
  const { url, anonKey } = getSupabaseCredentials();
  return createServerClient(url, anonKey, {
    cookieEncoding: 'base64url',
    cookieOptions: {
      name: SUPABASE_AUTH_COOKIE_NAME,
      path: '/',
      sameSite: 'lax',
      secure: secureCookie(),
      httpOnly: true,
    },
    cookies: { encode: SUPABASE_COOKIE_ENCODING, getAll, setAll: (cookies) => setAll(cookies) },
  });
}

export function createSupabaseRouteClient(request: NextRequest) {
  const pending: CookieMutation[] = [];
  const supabase = createBaseClient(() => request.cookies.getAll(), (cookies) => pending.push(...cookies));
  return {
    supabase,
    applyToResponse(response: NextResponse): NextResponse {
      for (const cookie of pending) response.cookies.set(cookie.name, cookie.value, cookie.options);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    },
  };
}

export function createReadOnlySupabaseClient(cookies: CookieReader) {
  return createBaseClient(() => cookies.getAll(), () => undefined);
}
