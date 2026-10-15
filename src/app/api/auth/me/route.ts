import { NextRequest } from 'next/server';
import { fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';

/**
 * 当前用户信息（新鉴权链路）：
 * - 浏览器经 authedFetch 携带 Authorization（网关重命名 x-sandbox-authorization）；
 * - requireAuth 对 token 做 getUser() 网络校验，无效/过期 401；
 * - 无头时回退本地 cookie 会话（本地直连 SSR 路径）。
 *
 * 身份同步（教师端可识别"谁是谁"）：登录身份含可识别信息（超星号或非默认姓名）时，
 * 幂等 upsert 本人 profiles 行（sync_profile_identity SECURITY DEFINER RPC，
 * 迁移 20261014180000：仅维护 display_name/student_no/chaoxing_uid 身份列，
 * 只能写 auth.uid() 本人行）。教师学情统计/会话详情经 profiles join 即可看到
 * 学生真实姓名、学号/超星号；同步失败不阻断身份响应（下次访问自动重试，幂等）。
 */
async function syncProfileIdentity(
  user: { displayName: string; studentNo: string | null; chaoxingUid: string | null; role: string },
  accessToken: string | null,
): Promise<void> {
  if (!accessToken || !isDatabaseConfigured()) return;
  // 无可识别身份（预览身份、未落地资料的邮箱账号）不触发同步
  if (!user.chaoxingUid && user.displayName === '用户') return;
  try {
    const { error } = await getSupabaseUserClient(accessToken).rpc('sync_profile_identity', {
      p_display_name: user.displayName,
      p_student_no: user.studentNo ?? '',
      p_chaoxing_uid: user.chaoxingUid ?? '',
      // 兼容旧 RPC 签名；新迁移由 app_is_teacher() 派生分类，不采信调用方角色。
      p_app_role: 'student',
    });
    if (error) console.error('profiles 身份同步失败:', error.message);
  } catch (error) {
    console.error('profiles 身份同步异常:', error instanceof Error ? error.message : String(error));
  }
}

export async function GET(request: NextRequest) {
  try {
    const { accessToken, ...user } = await requireAuth(request);
    await syncProfileIdentity(user, accessToken);
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
