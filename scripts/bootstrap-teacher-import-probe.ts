export {};

/**
 * 53 病例受控初始化教师探针——一次性受控引导（bootstrap）：
 * - 固定公开邮箱 teacher-import-probe@luojia.dev（邮箱为公开标识，非敏感）；
 * - 密码进程内随机生成（crypto），仅写入调用方指定的 0600 JSON 凭据文件，不打印、不进命令行；
 * - 账号已存在时 fail-closed 提示复用（凭据丢失不可恢复时如实报错，不静默重建）；
 * - 本脚本只 signup，不写任何白名单/角色表：teacher_emails 白名单登记由平台管理通道
 *   （db_execute）完成，与既有 whu-peds-test/rls-probe-b 探针同一管理流程；
 * - 配套使用：run-case53-import.ts --cred-file <0600 JSON>（登录→app_is_teacher 校验→importTeacherCases）。
 * 运行：pnpm tsx scripts/bootstrap-teacher-import-probe.ts --out /tmp/.teacher-import-probe-creds.json
 */
import { writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

const EMAIL = 'teacher-import-probe@luojia.dev';
const DISPLAY_NAME = '病例导入探针';

const outIdx = process.argv.indexOf('--out');
const outFile = outIdx >= 0 ? process.argv[outIdx + 1] : '/tmp/.teacher-import-probe-creds.json';

type SignupResult = { access_token: string; user: { id: string; email?: string } };

async function main(): Promise<void> {
  const password = randomBytes(24).toString('base64url');
  const resp = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  const body = (await resp.json()) as SignupResult & { msg?: string; error_code?: string };
  if (!resp.ok || !body.access_token) {
    if (body.msg?.includes('already') || body.error_code?.includes('exist')) {
      throw new Error(`账号 ${EMAIL} 已存在：请复用既有 0600 凭据文件（--cred-file），凭据丢失则无法恢复，如实报告，不得重建`);
    }
    throw new Error(`signup 失败: ${body.msg ?? body.error_code ?? resp.status}`);
  }

  writeFileSync(outFile, JSON.stringify({ email: EMAIL, password }), { mode: 0o600 });
  chmodSync(outFile, 0o600);
  console.log(`bootstrap 完成: ${EMAIL}（display_name=${DISPLAY_NAME}，待白名单登记）`);
  console.log(`凭据文件(0600): ${outFile}`);
  console.log('下一步（平台管理通道）：teacher_emails 白名单登记该邮箱（注记"受控初始化教师探针（可删除）"）');
  console.log('随后执行: pnpm tsx scripts/run-case53-import.ts --cred-file ' + outFile);
}

void main().catch((e: unknown) => { console.error((e as Error).message); process.exitCode = 1; });
