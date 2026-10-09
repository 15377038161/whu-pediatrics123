import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/api-result';
import { requireUser } from '@/lib/request-auth';

/**
 * 当前用户信息（新鉴权链路）：
 * - 浏览器经 authedFetch 携带 Authorization（网关重命名 x-sandbox-authorization）；
 * - requireUser 对 token 做 getUser() 网络校验，无效/过期 401；
 * - 无头时回退本地 cookie 会话（本地直连 SSR 路径）。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    return ok({ user });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AUTH_REQUIRED';
    if (code === 'AUTH_REQUIRED') {
      return fail({ code: 'AUTH_REQUIRED', message: '未登录或会话已过期。', retryable: false }, undefined, 401);
    }
    if (code === 'IDENTITY_CONFLICT') {
      return fail({ code: 'IDENTITY_CONFLICT', message: '登录身份冲突，请退出后重新登录。', retryable: false }, undefined, 403);
    }
    if (code === 'FORBIDDEN') {
      return fail({ code: 'FORBIDDEN', message: '无权访问。', retryable: false }, undefined, 403);
    }
    return fail({ code: 'AUTH_ERROR', message: '鉴权服务异常，请稍后重试。', retryable: true }, undefined, 500);
  }
}
