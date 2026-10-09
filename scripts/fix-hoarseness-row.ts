export {};

/** 一次性修复脚本：删除手动 db_execute 写入时被截断的 teacher-急性喉炎 损坏行
 *  （documents 1883b vs 本地 3935b，版本指纹相同导致幂等导入跳过），
 *  随后重跑导入通道以教师身份按本地受控产物完整重建该行。
 *  删除走教师探针身份，RLS app_is_teacher 放行 DELETE；不动其他 52 例与历史会话。
 *  运行：pnpm tsx scripts/fix-hoarseness-row.ts --cred-file /tmp/.teacher-import-probe-creds.json */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

const CASE_ID = 'teacher-急性喉炎';
const VERSION = 'add55543e88cae23';

async function main(): Promise<void> {
  const idx = process.argv.indexOf('--cred-file');
  const raw = JSON.parse(readFileSync(idx >= 0 ? process.argv[idx + 1] : '/tmp/.teacher-import-probe-creds.json', 'utf8')) as { email: string; password: string };
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: raw.email, password: raw.password }),
  });
  const { access_token } = (await resp.json()) as { access_token: string };
  const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: pre } = await db.from('case_snapshot_facts').select('case_id,version').eq('case_id', CASE_ID).eq('version', VERSION);
  console.log(`[前置] ${CASE_ID}@${VERSION} facts 行存在: ${pre?.length === 1}`);

  const { error: factsDel } = await db.from('case_snapshot_facts').delete().eq('case_id', CASE_ID).eq('version', VERSION);
  if (factsDel) throw new Error(`facts 删除失败: ${factsDel.message}`);
  const { error: answersDel } = await db.from('case_snapshot_answers').delete().eq('case_id', CASE_ID).eq('version', VERSION);
  if (answersDel) throw new Error(`answers 删除失败: ${answersDel.message}`);
  console.log('[删除] 损坏 facts+answers 行已清除（其余 52 例与历史会话不受影响）');

  const { importTeacherCases } = await import('../src/lib/teacher-case-import');
  const summary = await importTeacherCases(access_token, { only: [CASE_ID] });
  console.log(`[重建] imported=${summary.imported} unchanged=${summary.unchanged} failed=${summary.failed}`);
  if (summary.failed > 0 || summary.imported !== 1) { process.exitCode = 1; return; }
  console.log('[完成] 请重跑 verify-case53-init-publication.ts 复核内容保真');
}

void main().catch((e: unknown) => { console.error('[FATAL]', (e as Error).message); process.exitCode = 1; });
