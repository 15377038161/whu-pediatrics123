import { NextRequest, NextResponse } from 'next/server';

/**
 * 诊断端点（脱敏）：仅返回关键头/cookie 的「存在性布尔值」，绝不回显任何 token 值或 cookie 内容。
 * 用途：实测网关对 Authorization → x-sandbox-authorization 重命名与 Cookie 透传行为。
 */
export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  const sandboxAuth = request.headers.get('x-sandbox-authorization');
  const cookieHeader = request.headers.get('cookie');
  const cookieNames = (cookieHeader ?? '')
    .split(';')
    .map((pair) => pair.split('=')[0].trim())
    .filter(Boolean);
  return NextResponse.json({
    ok: true,
    data: {
      hasAuthorizationHeader: Boolean(authorization),
      authorizationPrefix: authorization?.split(' ')[0] ?? null,
      hasXSandboxAuthorization: Boolean(sandboxAuth),
      sandboxAuthorizationPrefix: sandboxAuth?.split(' ')[0] ?? null,
      hasCookieHeader: Boolean(cookieHeader),
      cookieNames,
      host: request.headers.get('host'),
    },
  });
}

export const dynamic = 'force-dynamic';
