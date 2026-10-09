export {};

/**
 * 53 病例受控初始化执行器（真实教师身份 + 项目导入库 + RLS 全程生效）：
 *
 * 凭据安全约定（与 preheat-case-snapshots.ts 同模式，fail-closed，不 signup）：
 * - 教师凭据仅经 --cred-file <0600 JSON {email,password}> 或
 *   TEACHER_IMPORT_PROBE_EMAIL / TEACHER_IMPORT_PROBE_PWD 环境变量输入；
 * - 两者皆缺直接退出；绝不 signup 新账号、不改密码、不打印凭据/token 原文。
 *
 * 流程：
 * 1. 密码模式登录获取真实 access_token；
 * 2. app_is_teacher RPC 校验（teacher_emails 白名单判定，与 RLS 谓词同一函数）——
 *    非教师 fail-closed 退出，不降级、不绕过；
 * 3. importTeacherCases：服务端读取本地受控产物 knowledge/teaching-cases/*.json，
 *   recordSchema 校验 + sha256 版本指纹，幂等双写 case_snapshot_facts/answers
 *   （ignoreDuplicates：同版本不覆盖，既有装载/历史版本不受影响）；
 * 4. 导入后 diagnoseTeacherCaseImport 复核：loaded/pending 计数 + 健康计数。
 *
 * 输出仅 caseId / 状态 / 版本指纹 / 计数，不打印患者原文与 token。
 * 运行：pnpm tsx scripts/run-case53-import.ts --cred-file /tmp/.teacher-import-probe-creds.json
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量（CODER_SUPABASE_URL/ANON_KEY/TENANT_ID）');

function loadCredentials(argv: string[]): { email: string; password: string } {
  const idx = argv.indexOf('--cred-file');
  if (idx >= 0 && argv[idx + 1]) {
    const raw = JSON.parse(readFileSync(argv[idx + 1], 'utf8')) as { email?: string; password?: string };
    if (!raw.email || !raw.password) throw new Error('凭据文件缺少 email/password');
    return { email: raw.email, password: raw.password };
  }
  if (process.env.TEACHER_IMPORT_PROBE_EMAIL && process.env.TEACHER_IMPORT_PROBE_PWD) {
    return { email: process.env.TEACHER_IMPORT_PROBE_EMAIL, password: process.env.TEACHER_IMPORT_PROBE_PWD };
  }
  throw new Error('缺少凭据：--cred-file <0600 JSON> 或 TEACHER_IMPORT_PROBE_EMAIL/TEACHER_IMPORT_PROBE_PWD（不 signup）');
}

async function main(): Promise<void> {
  const { email, password } = loadCredentials(process.argv);
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const auth = (await resp.json()) as { access_token?: string; user?: { id: string }; error_code?: string; msg?: string };
  if (!resp.ok || !auth.access_token) throw new Error(`教师登录失败: ${auth.error_code ?? resp.status}`);
  const token = auth.access_token;
  console.log(`[登录] 探针 ${email} userId=${(auth.user?.id ?? '').slice(0, 8)}…`);

  // app_is_teacher 白名单校验（与 RLS 谓词同一函数）：非教师 fail-closed
  const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: isTeacher } = await db.rpc('app_is_teacher');
  if (isTeacher !== true) throw new Error('app_is_teacher=false：邮箱未在 teacher_emails 白名单，拒绝导入（fail-closed）');
  console.log('[身份] app_is_teacher=true（teacher_emails 白名单判定通过）');

  const { importTeacherCases, diagnoseTeacherCaseImport } = await import('../src/lib/teacher-case-import');
  console.log('[导入] importTeacherCases 开始（服务端读取本地受控产物，幂等双写 facts+answers）…');
  const summary = await importTeacherCases(token);
  console.log(`[结果] total=${summary.total} imported=${summary.imported} unchanged=${summary.unchanged} skipped=${summary.skipped} failed=${summary.failed}`);
  for (const item of summary.results) {
    if (item.status === 'failed' || item.status.startsWith('skipped_')) {
      console.error(`  ${item.status} - ${item.caseId} :: ${item.detail ?? ''}`);
    } else {
      console.log(`  ${item.status} - ${item.caseId} :: ver=${item.version}`);
    }
  }

  const diag = await diagnoseTeacherCaseImport(token);
  console.log(`[复核] loaded=${diag.loaded}/${diag.total} pending=${diag.pending} missingLocal=${diag.missingLocal} noSource=${diag.noSource}`);
  console.log(`[复核] 健康计数 facts=${diag.counts.persistedFactsVersions} answers=${diag.counts.persistedAnswerVersions} boundSessions=${diag.counts.boundTeacherSessions}`);

  if (summary.failed > 0 || summary.skipped > 0 || diag.loaded !== diag.total) {
    console.error('[判定] 存在失败/跳过/未装载项，初始化未完成');
    process.exitCode = 1;
    return;
  }
  console.log('[判定] 53 例全部装载且本地/DB 版本一致（ALL_LOADED）');
}

void main().catch((e: unknown) => { console.error('[FATAL]', (e as Error).message); process.exitCode = 1; });
