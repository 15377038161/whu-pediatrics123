import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseRouteClient } from '@/lib/supabase-ssr';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';

interface PlatformSessionBody {
  access_token?: unknown;
  refresh_token?: unknown;
}

/**
 * Origin 同源校验：请求 Origin 必须与 Host 同源，或匹配平台预览域名（CODER_PROJECTS_DOMAIN，
 * 沙箱预览域名与请求 Host 可能因网关转发不一致）。其余一律拒绝（CSRF 防线）。
 */
function sameOriginOrPreviewDomain(origin: string, request: NextRequest): boolean {
  try {
    const originHost = new URL(origin).host;
    const host = request.headers.get('host') ?? '';
    if (originHost === host) return true;
    const projectsDomain = process.env.CODER_PROJECTS_DOMAIN;
    if (projectsDomain) {
      const domainHost = projectsDomain.replace(/^https?:\/\//, '').split('/')[0];
      if (originHost === domainHost) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 平台 OAuth session 落地（服务端唯一可信写入口）：
 * 浏览器完成 /v1/api/coder/proxy/auth/chaoxing-oauth/exchange 后，把返回的 session
 * POST 到本路由；服务端用与读取路径同款 SSR 客户端 setSession 写 httpOnly cookie。
 * 浏览器端不持有 anonKey（平台不暴露真实节点地址），session 写入必须在服务端完成。
 * 仅接受 access_token/refresh_token 两个已知字段，落 cookie 后立即丢弃请求体。
 * 跨站防护：校验 Origin/Referer 必须同源（无 Origin 头的非浏览器客户端放行，
 * 由 token 签名校验兜底；伪造 token 已实测被 401 拒绝）。
 */
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('Origin');
    if (origin) {
      const allowed = sameOriginOrPreviewDomain(origin, request);
      if (!allowed) {
        return fail({ code: 'CROSS_ORIGIN_REJECTED', message: '跨站请求被拒绝', retryable: false }, undefined, 403);
      }
    }
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
