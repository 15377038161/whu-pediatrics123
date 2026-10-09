/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 53 病例真实 API 验收专用学生探针——一次性受控引导（bootstrap）：
 * - 固定公开邮箱 case53-probe@luojia.dev（邮箱为公开标识，非敏感）；
 * - 密码进程内随机生成（crypto），仅写入调用方指定的 0600 JSON 凭据文件，不打印、不进命令行；
 * - 账号已存在时 fail-closed 提示复用（凭据丢失不可恢复时如实报错，不静默重建）；
 * - profile 自建（RLS self-insert），display_name 固定「病例53探针」，
 *   配套迁移按受控脚本证据将 account_kind 标记为 test（不污染教师统计口径）；
 * - 本脚本是【一次性】工具：验收脚本 verify-case53-real-api.ts 一律通过
 *   --cred-file / CASE53_PROBE_* 环境变量复用本账号，绝不默认 signup。
 * 运行：pnpm tsx scripts/bootstrap-case53-probe.ts --out /tmp/.case53-probe-creds.json
 */
export {};

import { writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

const EMAIL = 'case53-probe@luojia.dev';
const DISPLAY_NAME = '病例53探针';

const outIdx = process.argv.indexOf('--out');
const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : '/tmp/.case53-probe-creds.json';

type TokenResult = { access_token: string; user: { id: string; email?: string } };

async function main(): Promise<void> {
  // 密码仅在进程内生成：随机 24 字节 base64url（含大小写/数字，长度 32）
  const password = randomBytes(24).toString('base64url');
  const resp = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  const body = (await resp.json()) as TokenResult & { msg?: string; error_code?: string };
  if (!resp.ok || !body.access_token) {
    if (body.msg?.includes('already') || body.error_code?.includes('exist')) {
      throw new Error(`账号 ${EMAIL} 已存在：请复用既有 0600 凭据文件（--cred-file），凭据丢失则无法恢复，如实报告，不得重建`);
    }
    throw new Error(`signup 失败: ${body.msg ?? body.error_code ?? resp.status}`);
  }

  // profile 自建（RLS self-insert，学生角色）
  const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${body.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: profileError } = await db
    .from('profiles')
    .insert({ id: body.user.id, display_name: DISPLAY_NAME, app_role: 'student' });
  if (profileError) throw new Error(`profile 自建失败: ${profileError.message}`);

  // 凭据仅写入 0600 文件（不打印原文）
  writeFileSync(outFile, JSON.stringify({ email: EMAIL, password }), { mode: 0o600 });
  chmodSync(outFile, 0o600);
  console.log(`bootstrap 完成: ${EMAIL}（display_name=${DISPLAY_NAME}，account_kind 待配套迁移标记 test）`);
  console.log(`凭据文件(0600): ${outFile}`);
  console.log('后续验收一律: pnpm tsx scripts/verify-case53-real-api.ts --cred-file ' + outFile);
}

void main().catch((e: unknown) => { console.error((e as Error).message); process.exitCode = 1; });
