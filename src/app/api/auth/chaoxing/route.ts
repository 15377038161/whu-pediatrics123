import { NextRequest, NextResponse } from 'next/server';
import { getRealOrigin, normalizeSafeRedirectPath } from '@/lib/auth-utils';
import { getChaoxingAuthorizationConfig, isChaoxingConfigured } from '@/lib/chaoxing-client';
import { setLoginContextCookie } from '@/lib/chaoxing-login-context';

export async function GET(request: NextRequest) {
  try {
    if (!isChaoxingConfigured()) throw new Error('config_missing');
    const nextPath = normalizeSafeRedirectPath(request.nextUrl.searchParams.get('next')) || '/student';
    const config = getChaoxingAuthorizationConfig(request.nextUrl.searchParams.get('fid'));
    const url = new URL('https://auth.chaoxing.com/connect/oauth2/authorize');
    url.searchParams.set('appid', config.appid);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'snsapi_base');
    url.searchParams.set('state', config.stateFid);
    const response = NextResponse.redirect(url);
    setLoginContextCookie(response, request, nextPath, config.stateFid);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    console.error('无法发起超星登录:', error instanceof Error ? error.message : String(error));
    return NextResponse.redirect(new URL('/auth/error?reason=config_missing', getRealOrigin(request)));
  }
}
