import type { ChaoxingIdentity } from '@/lib/chaoxing-client';
import { ChaoxingLoginError } from '@/lib/chaoxing-client';

/**
 * 平台安全约束（fail-closed）：
 * 登录令牌签发需要 Supabase Auth Admin API（createUser / generateLink / updateUserById），
 * 该接口仅接受 SERVICE_ROLE_KEY 级特权凭据；平台明确禁止生成应用读取或持有此类密钥。
 * 因此本函数不构造任何 admin 客户端：环境未提供可用特权凭据时直接抛出明确错误，
 * 登录回调将其映射到 oauth_failed 错误页，绝不回退匿名或用户身份伪造签名。
 *
 * 当前部署环境下的有效登录路径：
 * - 邮箱密码登录（Supabase 原生，Auth 配置 external_email_enabled = true）；
 * - 平台代理的超星 OAuth（/v1/api/coder/proxy/auth/chaoxing-oauth/*）。
 * 应用自带的超星 OAuth 回调（CHAOXING_APPID/SECRET）在未配置时本就不可达。
 */
export async function createSupabaseLoginToken(identity: ChaoxingIdentity): Promise<string> {
  void identity;
  throw new ChaoxingLoginError(
    'oauth_failed',
    '登录令牌签发依赖特权凭据（Auth Admin API），当前平台环境未提供，已按安全规范 fail-closed',
  );
}
