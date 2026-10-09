export {};

/** 一次性授权撤销验证脚本（探针自身凭据，非角色提升）。
 * 实际执行情况（2026-10-14，如实记录）：
 * - 白名单条目删除（db_execute 平台管理通道）：已完成，app_is_teacher 谓词对该账号恒为 false；
 * - 本脚本其余步骤（signOut global 会话注销、API 403 复验、凭据文件删除）：**未执行**——
 *   /tmp 凭据文件已被系统清理，密码为进程内随机生成从未落盘，探针自身凭据不可再获得。
 *   因此只能声称"教师白名单已撤销"；账号会话/refresh token 未确认注销（存活 JWT 理论上
 *   在 TTL 内仍可用其学生权限，教师特权已被 RLS 谓词切断，不受影响）。
 * 保留脚本原步骤作为撤销完成时的标准流程模板（供未来具备凭据时执行）。
 * 不删除账号、不动业务数据（case_snapshot_facts/answers 与 case_publication 审计行保留）。
 * 运行：pnpm tsx scripts/revoke-teacher-import-probe.ts */
import { readFileSync, unlinkSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

const EMAIL = 'teacher-import-probe@luojia.dev';
const CRED_FILE = '/tmp/.teacher-import-probe-creds.json';
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';

async function main(): Promise<void> {
  const { password } = JSON.parse(readFileSync(CRED_FILE, 'utf8')) as { email: string; password: string };

  // 1. 登录（探针自身凭据，仅用于撤销验证与会话注销）
  const loginResp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  const auth = (await loginResp.json()) as { access_token?: string; refresh_token?: string; user?: { id: string }; error_code?: string };
  if (!loginResp.ok || !auth.access_token) throw new Error(`探针登录失败: ${auth.error_code ?? loginResp.status}`);
  console.log(`[登录] 探针自身凭据登录成功（仅用于撤销验证与会话注销）`);

  // 2. 验证白名单撤销生效：app_is_teacher 必须 false
  const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${auth.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: isTeacher, error: rpcError } = await db.rpc('app_is_teacher');
  if (rpcError) throw new Error(`app_is_teacher 调用失败: ${rpcError.message}`);
  if (isTeacher !== false) { console.error(`[失败] app_is_teacher=${isTeacher}，白名单撤销未生效，中止`); process.exitCode = 1; return; }
  console.log('[撤销验证] app_is_teacher=false（教师权限已撤销）');

  // 3. 教师 API 不再可达（应用层 student + 白名单移除，双重拒绝路径都必须挡住）
  const apiResp = await fetch(`${BASE_URL}/api/teacher/case-publication`, { headers: { Authorization: `Bearer ${auth.access_token}` } });
  console.log(`[撤销验证] /api/teacher/case-publication → ${apiResp.status}（预期 401/403）`);
  if (apiResp.status !== 401 && apiResp.status !== 403) { console.error('[失败] 教师 API 仍可达，存在越权风险'); process.exitCode = 1; }

  // 4. 注销全部会话（signOut global：撤销该账号所有 refresh token）
  const { error: signOutError } = await db.auth.signOut({ scope: 'global' });
  if (signOutError) throw new Error(`signOut 失败: ${signOutError.message}`);
  console.log('[会话注销] signOut(global) 完成（探针全部会话/refresh token 已失效）');

  // 5. 注销后 token 立即失效核验
  const after = await fetch(`${BASE_URL}/api/sessions`, { headers: { Authorization: `Bearer ${auth.access_token}` } });
  console.log(`[核验] 注销后 /api/sessions → ${after.status}（预期 401，access token 已失效）`);

  // 6. 凭据文件清理（密码不再落盘）
  unlinkSync(CRED_FILE);
  console.log('[清理] 0600 凭据文件已删除（账号保留、业务数据保留）');
}

void main().catch((e: unknown) => { console.error('[FATAL]', (e as Error).message); process.exitCode = 1; });
