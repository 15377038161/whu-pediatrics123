import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseRouteClient } from '@/lib/supabase-ssr';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';

interface PlatformSessionBody {
  access_token?: unknown;
  refresh_token?: unknown;
}

/**
 * 平台 OAuth session 落地（服务端唯一可信写入口）：
 * 浏览器完成 /v1/api/coder/proxy/auth/chaoxing-oauth/exchange 后，把返回的 session
 * POST 到本路由；服务端用与读取路径同款 SSR 客户端 setSession 写 httpOnly cookie。
 * 浏览器端不持有 anonKey（平台不暴露真实节点地址），session 写入必须在服务端完成。
 * 仅接受 access_token/refresh_token 两个已知字段，落 cookie 后立即丢弃请求体。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PlatformSessionBody;
    const accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : '';
    const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token.trim() : '';
    if (!accessToken || !refreshToken) {
      return fail({ code: 'INVALID_SESSION', message: 'session 参数不完整', retryable: false }, undefined, 400);
    }
    const route = createSupabaseRouteClient(request);
    const { data, error } = await route.supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error || !data.session) {
      return fail({ code: 'SESSION_REJECTED', message: 'session 校验失败', retryable: false }, undefined, 401);
    }
    // 验证用户身份确实可解析（触发 getUser 网络校验，无效 JWT 会被拒绝）
    const { data: userData, error: userError } = await route.supabase.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return fail({ code: 'SESSION_REJECTED', message: '用户身份校验失败', retryable: false }, undefined, 401);
    }
    const response = NextResponse.json({ ok: true, data: { userId: userData.user.id } });
    return route.applyToResponse(response);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, 500);
  }
}

export const dynamic = 'force-dynamic';
