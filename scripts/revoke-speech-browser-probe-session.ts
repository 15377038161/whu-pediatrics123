export {};

/**
 * 语音链浏览器探针会话收尾（D-边界-01 指令步骤 2，一次性受控工具）：
 * - 仅用于撤销本批（D-验收-01）违规新建的探针账号 speech-browser-probe@luojia.dev 的
 *   refresh 会话；不删除账号、不改角色/白名单/RLS、不动业务数据（账号处置由用户决定）。
 * - 身份确认链（任何一步不符即中止并如实记待处理，不执行 signOut）：
 *   受控凭据文件(0600) 中 email 必须等于本批唯一固定定位符邮箱 →
 *   密码登录后 getUser 的 UID/email 与登录响应一致 →
 *   本人 profiles 行（RLS self-select）display_name=语音链浏览器探针 且
 *   app_role=student 且 account_kind=test（与本批迁移 20261020100000 标记一致）。
 * - 输出纪律：仅打印 email（公开标识）、UID（非秘密定位符）、布尔/状态与真实退出码；
 *   不打印密码、JWT、refresh token、签名 URL；token 不进命令行参数。
 * - signOut(scope=global) 撤销该账号全部 refresh token；access JWT 在自身 TTL 内仍可能
 *   有效——不得声称已立即失效（到期自然失效，与既有 revoke-teacher-import-probe.ts 口径一致）。
 * 运行：pnpm tsx scripts/revoke-speech-browser-probe-session.ts
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

/** 本批探针唯一公开定位符（bootstrap-speech-browser-probe.ts 固定邮箱，非秘密）。 */
const EXPECTED_EMAIL = 'speech-browser-probe@luojia.dev';
const EXPECTED_DISPLAY_NAME = '语音链浏览器探针';
const CRED_FILE = process.env.PROBE_CRED_FILE ?? '/tmp/.speech-browser-creds.json';

type Cred = { email: string; password: string };
type AuthResp = { access_token?: string; user?: { id: string; email?: string }; error_code?: string; msg?: string };
type ProfileRow = { display_name: string | null; app_role: string; account_kind: string | null };

async function main(): Promise<void> {
  // 0. 读取受控凭据文件（进程内，不打印原文）
  const cred = JSON.parse(readFileSync(CRED_FILE, 'utf8')) as Cred;
  if (!cred?.email || !cred?.password) throw new Error('凭据文件缺 email/password');
  if (cred.email !== EXPECTED_EMAIL) {
    console.error(`[中止] 凭据文件 email 与本批探针定位符不一致（读到: ${cred.email}），身份不确定，不执行 signOut`);
    process.exitCode = 1;
    return;
  }
  console.log('[身份核对-1] 凭据文件 email 与本批探针定位符一致');

  // 1. 探针自身凭据登录（仅用于身份核对与会话注销）
  const loginResp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cred.email, password: cred.password }),
  });
  const auth = (await loginResp.json()) as AuthResp;
  if (!loginResp.ok || !auth.access_token || !auth.user?.id) {
    throw new Error(`探针登录失败: ${auth.error_code ?? auth.msg ?? loginResp.status}`);
  }
  const loginUid = auth.user.id;
  console.log(`[登录] 成功 UID=${loginUid}（email=${cred.email}）`);

  // 2. getUser 独立核对：返回 UID/email 必须与登录响应一致
  const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${auth.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: getUserError } = await db.auth.getUser();
  if (getUserError || !userData?.user) throw new Error(`getUser 失败: ${getUserError?.message}`);
  if (userData.user.id !== loginUid || userData.user.email !== EXPECTED_EMAIL) {
    console.error(`[中止] getUser 身份不一致（UID=${userData.user.id}, email=${userData.user.email}），不执行 signOut`);
    process.exitCode = 1;
    return;
  }
  console.log(`[身份核对-2] getUser UID/email 与登录响应一致（UID=${userData.user.id}）`);

  // 3. 本人 profiles 行核对（RLS self-select）：与本批迁移标记一致
  const { data: profile, error: profileError } = await db.from('profiles').select('display_name, app_role, account_kind').eq('id', loginUid).maybeSingle<ProfileRow>();
  if (profileError) throw new Error(`profiles 查询失败: ${profileError.message}`);
  if (!profile || profile.display_name !== EXPECTED_DISPLAY_NAME || profile.app_role !== 'student' || profile.account_kind !== 'test') {
    console.error(`[中止] profiles 行与本批探针标记不一致（display_name=${profile?.display_name}, app_role=${profile?.app_role}, account_kind=${profile?.account_kind}），身份不确定，不执行 signOut`);
    process.exitCode = 1;
    return;
  }
  console.log(`[身份核对-3] profiles 行一致（display_name=${EXPECTED_DISPLAY_NAME}, app_role=student, account_kind=test）`);

  // 4. 全部核对通过 → 撤销该账号全部 refresh 会话
  const { error: signOutError } = await db.auth.signOut({ scope: 'global' });
  if (signOutError) throw new Error(`signOut 失败: ${signOutError.message}`);
  console.log('[会话注销] signOut(global) 完成：该账号全部 refresh token 已撤销');
  console.log('[如实声明] access JWT 在自身 TTL 内仍可能有效（到期自然失效），不声称已立即撤销；账号/数据保留，处置由用户决定');
}

void main().catch((e: unknown) => { console.error(`[失败] ${(e as Error).message}`); process.exitCode = 1; });
