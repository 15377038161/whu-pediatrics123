/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 批次7·技能学习目录 RLS 正式验收：真实 Data API（anon key + 用户 JWT + X-Instance-ID）。
 * skills 目录表与 skill_catalog_student RPC 的允许与拒绝场景，与生产运行时同链路。
 *
 * 硬验证（不依赖资源数据）：
 * - 匿名：skills select 必须失败（anon 无 GRANT）；skill_catalog_student RPC 必须失败。
 * - 学生 A：skills select 成功且恰返回 8 项种子（sort_order 1..8）；skill_catalog_student
 *   返回 8 项数组且键结构完整（resourceCount/completedCount 为数字）。
 *
 * 软验证（依赖真实资源/班级数据，如实报告不误判）：
 * - skill_catalog_student 各项 resourceCount/completedCount 汇总输出供人工核对。
 *
 * 凭据：RLS_PROBE_A_PWD 从环境变量读取（不硬编码）；缺失时只执行匿名拒绝组，
 * authenticated 组输出 SKIP 并退出码 2（待凭据环境重跑）。
 * 运行：pnpm tsx scripts/verify-skill-rls.ts
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.CODER_SUPABASE_URL;
const anonKey = process.env.CODER_SUPABASE_ANON_KEY;
const tenantId = process.env.CODER_SUPABASE_TENANT_ID;

if (!url || !anonKey || !tenantId) {
  console.error('FATAL: 缺少 CODER_SUPABASE_URL / CODER_SUPABASE_ANON_KEY / CODER_SUPABASE_TENANT_ID');
  process.exit(1);
}

const SUPA_URL = url as string;
const SUPA_ANON_KEY = anonKey as string;
const SUPA_TENANT_ID = tenantId as string;

const credentialsAvailable = Boolean(process.env.RLS_PROBE_A_PWD);

type TokenResult = { access_token: string; user: { id: string; email?: string } };

async function login(email: string, password: string): Promise<TokenResult> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as TokenResult & { error_code?: string; msg?: string };
  if (!resp.ok || !body.access_token) {
    throw new Error(`登录失败 ${email}: ${body.error_code ?? body.msg ?? resp.status}`);
  }
  return body;
}

function anonClient() {
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function userClient(token: string) {
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let pass = 0;
let fail = 0;
let skip = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}
function checkSkip(name: string, detail = ''): void {
  skip += 1;
  console.log(`SKIP ${name}${detail ? ` (${detail})` : ''}`);
}

interface SkillRow { id: string; slug: string; title: string; sort_order: number; status: string }
interface SkillCatalogItem { skillId: string; slug: string; title: string; resourceCount: number; completedCount: number; sortOrder: number }

async function main(): Promise<void> {
  console.log('== 批次7·技能学习目录 RLS 验收 ==');

  // ---------- 匿名拒绝组（硬验证） ----------
  const anon = anonClient();
  const anonSelect = await anon.from('skills').select('id').limit(1);
  check('匿名 skills select 被拒绝', anonSelect.error !== null, anonSelect.error?.message ?? '未报错');
  const anonRpc = await anon.rpc('skill_catalog_student');
  check('匿名 skill_catalog_student 被拒绝', anonRpc.error !== null, anonRpc.error?.message ?? '未报错');

  // ---------- authenticated 组 ----------
  const probeEmail = process.env.RLS_PROBE_A_EMAIL ?? 'probe-a@example.com';
  if (!credentialsAvailable) {
    checkSkip('学生 A skills select', '缺少 RLS_PROBE_A_PWD');
    checkSkip('学生 A skill_catalog_student', '缺少 RLS_PROBE_A_PWD');
    console.log(`\n结果：pass=${pass} fail=${fail} skip=${skip}（authenticated 组待凭据环境重跑）`);
    process.exit(2);
  }

  const probePwd = process.env.RLS_PROBE_A_PWD as string;
  const token = await login(probeEmail, probePwd);
  const student = userClient(token.access_token);

  const skillsSelect = await student.from('skills').select('id, slug, title, sort_order, status').order('sort_order');
  check('学生 A skills select 成功', skillsSelect.error === null, skillsSelect.error?.message ?? `${skillsSelect.data?.length ?? 0} 行`);
  const rows = (skillsSelect.data ?? []) as SkillRow[];
  check('skills 种子恰 8 项', rows.length === 8, `实际 ${rows.length} 行`);
  check('skills 排序 1..8', rows.every((row, index) => row.sort_order === index + 1), rows.map((row) => row.sort_order).join(','));

  const catalog = await student.rpc('skill_catalog_student');
  check('学生 A skill_catalog_student 成功', catalog.error === null, catalog.error?.message ?? 'ok');
  const items = (catalog.data ?? []) as unknown;
  const list = Array.isArray(items) ? (items as SkillCatalogItem[]) : [];
  check('目录返回 8 项', list.length === 8, `实际 ${list.length} 项`);
  check(
    '目录键结构完整（resourceCount/completedCount 为数字）',
    list.every((item) => typeof item.resourceCount === 'number' && typeof item.completedCount === 'number'),
    list.slice(0, 2).map((item) => `${item.slug}:${item.resourceCount}/${item.completedCount}`).join(' '),
  );
  // 软验证：汇总输出供人工核对
  console.log(
    `INFO 目录概览: ${list.map((item) => `${item.title}(${item.resourceCount}/${item.completedCount})`).join('、')}`,
  );

  console.log(`\n结果：pass=${pass} fail=${fail} skip=${skip}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
