/* 探针用户凭据（受控环境变量版）：
 * - 密码一律从环境变量读取：RLS_PROBE_A_PWD / RLS_PROBE_B_PWD / RLS_PROBE_C_PWD
 * - 未设置时抛错退出（fail-closed，不回退任何默认密码），避免凭据硬编码进代码库。
 * - 邮箱为公开探针标识（非敏感），可保留常量。
 * 使用：import { PROBE_USER_A, PROBE_USER_B, PROBE_USER_C } from './probe-credentials'
 */
function requirePwd(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`FATAL: 缺少环境变量 ${name}（探针用户密码，不硬编码）`);
    process.exit(1);
  }
  return value;
}

export const PROBE_USER_A = { email: 'rls-probe-a@luojia.dev', password: process.env.RLS_PROBE_A_PWD ?? requirePwd('RLS_PROBE_A_PWD') };
export const PROBE_USER_B = { email: 'rls-probe-b@luojia.dev', password: process.env.RLS_PROBE_B_PWD ?? requirePwd('RLS_PROBE_B_PWD') };
export const PROBE_USER_C = { email: 'rls-probe-c@luojia.dev', password: process.env.RLS_PROBE_C_PWD ?? requirePwd('RLS_PROBE_C_PWD') };
