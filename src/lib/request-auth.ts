import type { NextRequest } from 'next/server';
import type { AppRole, UserContext } from '@/domain/agent';
import { canAccessRole } from '@/lib/access-control';
import {
  getCurrentAuth,
  readBearerToken,
  verifyHeaderToken,
  type AuthContext,
} from '@/lib/supabase-auth';

export interface AuthedUserContext extends UserContext {
  /** 当前会话 JWT（预览身份为 null）；用于服务端以用户身份访问数据库（RLS 依 auth.uid() 判定） */
  accessToken: string | null;
}

/**
 * 统一鉴权（官方契约：supabase-auth 技能 verify-session.md）：
 *
 * 通道优先级与安全规则：
 * 1. 请求头携带 Bearer token（浏览器发 Authorization，网关边界重命名为 x-sandbox-authorization）：
 *    - token 必须经 getUser() 网络校验（真实 Supabase access_token；禁止仅解码信任/自签）；
 *    - 校验失败（无效/过期）一律 401，绝不静默回退 cookie（防降级）；
 *    - cookie 会话（非预览）若同时存在且身份不同 → 403 IDENTITY_CONFLICT（拒绝而非择一）；
 *    - 预览 cookie 在正式 header 身份存在时忽略（正式身份优先）。
 * 2. 无头时回退 cookie 会话（本地直连 SSR 页面/预览模式的既有路径）。
 *
 * 教师门禁统一（应用/API/RLS 同源判定）：
 * 除超星 OAuth 教师身份与应用层角色外，还会以当前会话自身 token 调用既有 app_is_teacher RPC
 * （SECURITY DEFINER，读 teacher_emails 白名单，与数据层 RLS 谓词同一函数）——白名单教师
 * 在应用层与数据层一致放行。安全规则：
 * - 不信任客户端传入的 email/uid/role：白名单判定完全来自服务端 RPC（auth.jwt() 由 Supabase 签发）；
 * - 邮箱所有权必须经服务端 getUser() 的 email_confirmed_at 确认（防他人抢注白名单邮箱未验证账号）；
 * - RPC 调用失败/异常一律不提升（fail-closed）；无 token（预览）不提升；
 * - 仅恢复既有受控白名单授权，授权/撤销记录由管理员经平台管理通道维护（docs/teacher-access.md）。
 */

/** 教师白名单门禁决策（纯函数，便于负测覆盖）。 */
export function resolveWhitelistTeacherRole(
  currentRole: AppRole,
  emailConfirmed: boolean,
  whitelistTeacher: boolean | null,
): AppRole {
  if (currentRole === 'teacher') return 'teacher';
  if (whitelistTeacher === true && emailConfirmed) return 'teacher';
  return 'student';
}

/** 以当前会话身份调用 app_is_teacher RPC。无 token/未配置数据库/调用出错返回 null（不提升）。 */
async function fetchWhitelistTeacher(accessToken: string | null): Promise<boolean | null> {
  if (!accessToken) return null;
  try {
    const { getSupabaseUserClient, isDatabaseConfigured } = await import('@/lib/supabase-client');
    if (!isDatabaseConfigured()) return null;
    const { data, error } = await getSupabaseUserClient(accessToken).rpc('app_is_teacher');
    if (error) return null;
    return data === true;
  } catch {
    return null;
  }
}

/** 对已解析的会话应用教师白名单门禁（幂等：已是教师则跳过 RPC）。 */
async function applyTeacherWhitelistGate(auth: AuthContext): Promise<UserContext> {
  if (auth.user.role === 'teacher') return auth.user;
  const whitelistTeacher = await fetchWhitelistTeacher(auth.accessToken);
  const role = resolveWhitelistTeacherRole(auth.user.role, auth.emailConfirmed, whitelistTeacher);
  return { ...auth.user, role };
}

async function resolveAuth(request: NextRequest): Promise<AuthContext | null> {
  const headerToken = readBearerToken(request);
  if (headerToken) {
    const headerAuth = await verifyHeaderToken(headerToken);
    if (!headerAuth) return null;
    const cookieAuth = await getCurrentAuth(request.cookies);
    const cookieIsPreview = Boolean(request.cookies.get('luojia_preview_role')?.value);
    if (cookieAuth && !cookieIsPreview && cookieAuth.user.id !== headerAuth.user.id) {
      throw new Error('IDENTITY_CONFLICT');
    }
    return headerAuth;
  }
  return getCurrentAuth(request.cookies);
}

export async function requireAuth(request: NextRequest, role?: AppRole): Promise<AuthedUserContext> {
  const auth = await resolveAuth(request);
  if (!auth) throw new Error('AUTH_REQUIRED');
  const user = await applyTeacherWhitelistGate(auth);
  if (role && !canAccessRole(user.role, role)) throw new Error('FORBIDDEN');
  return { ...user, accessToken: auth.accessToken };
}

export async function requireUser(request: NextRequest, role?: AppRole): Promise<UserContext> {
  const headerToken = readBearerToken(request);
  const auth = headerToken
    ? await verifyHeaderToken(headerToken)
    : await getCurrentAuth(request.cookies);
  if (!auth) throw new Error('AUTH_REQUIRED');
  const user = await applyTeacherWhitelistGate(auth);
  if (role && !canAccessRole(user.role, role)) throw new Error('FORBIDDEN');
  return user;
}

export type { AuthContext };
