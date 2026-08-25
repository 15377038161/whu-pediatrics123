import { NextRequest, NextResponse } from 'next/server';
import { getRealOrigin } from '@/lib/auth-utils';
import { clearLoginContextCookie, readLoginContext } from '@/lib/chaoxing-login-context';
import { resolveChaoxingIdentity, ChaoxingLoginError } from '@/lib/chaoxing-client';
import { createSupabaseLoginToken } from '@/lib/supabase-chaoxing-user';
import { createSupabaseRouteClient } from '@/lib/supabase-ssr';

function errorResponse(request: NextRequest, reason: string): NextResponse {
  const response = NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(reason)}`, getRealOrigin(request)));
  clearLoginContextCookie(response, request);
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const callbackFid = request.nextUrl.searchParams.get('state')?.trim() ?? '';
  if (!code || request.nextUrl.searchParams.get('error')) return errorResponse(request, 'oauth_failed');
  const context = readLoginContext(request);
  if (!context || !callbackFid || context.fid !== callbackFid) return errorResponse(request, 'oauth_expired');
  try {
    const identity = await resolveChaoxingIdentity(code, callbackFid);
    const tokenHash = await createSupabaseLoginToken(identity);
    const { supabase, applyToResponse } = createSupabaseRouteClient(request);
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (error) throw error;
    return applyToResponse(NextResponse.redirect(new URL(context.nextPath, getRealOrigin(request))));
  } catch (error) {
    console.error('超星登录回调失败:', error instanceof Error ? error.message : String(error));
    return errorResponse(request, error instanceof ChaoxingLoginError ? error.reason : 'session_failed');
  }
}
