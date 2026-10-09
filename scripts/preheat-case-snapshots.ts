export {};

/**
 * 53 病例快照教师预热（路径 A：知识库召回 + 教师身份双写持久缓存）：
 *
 * 目的：新环境（knowledge/ 本地文件缺失）部署后，以教师身份对 53 病例逐一
 * ensureCaseSnapshot（召回构建 + persistSnapshot 双写 case_snapshot_facts /
 * case_snapshot_answers），使学生恢复链路走 DB 受控 RPC 而非降级"资料不足"。
 *
 * 凭据安全约定（与 verify-case53-real-api.ts 同模式，fail-closed，不 signup）：
 * - 教师凭据仅经 --cred-file <0600 JSON {email,password}> 或
 *   PEDIATRICS_TEACHER_EMAIL / PEDIATRICS_TEACHER_PWD 环境变量输入；
 * - 两者皆缺直接退出；绝不 signup 新账号、不改密码、不打印凭据/token 原文；
 * - 登录后校验 profiles.role='teacher'，非教师身份拒绝执行（防止学生 token
 *   触发无意义召回）。
 *
 * 模式：
 * - --verify-only：验证 53 病例召回可行性（每例召回构建快照，校验 facts 分段
 *   完整性），不写任何 DB 表，不需要教师凭据（召使用平台注入的知识库凭据
 *   CODER_CODING_API_KEY/BASE_URL）——用于部署前可行性验证；
 * - 默认模式：教师身份逐例预热并双写持久缓存（需教师凭据，fail-closed），
 *   结束后打印健康计数复核。
 *
 * 输出仅病例 ID / 布尔 / 计数 / 版本指纹前 8 位，不打印患者原文与 token。
 *
 * 运行：
 *   pnpm tsx scripts/preheat-case-snapshots.ts --cred-file /tmp/.teacher-creds.json --verify-only
 *   pnpm tsx scripts/preheat-case-snapshots.ts --cred-file /tmp/.teacher-creds.json
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ===== 环境与参数 =====
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const VERIFY_ONLY = process.argv.includes('--verify-only');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) {
  throw new Error('缺少 Supabase 环境变量（CODER_SUPABASE_URL/ANON_KEY/TENANT_ID）');
}

// ===== 凭据：受控通道 fail-closed，绝不 signup =====
function loadCredentials(argv: string[]): { email: string; password: string } {
  const idx = argv.indexOf('--cred-file');
  if (idx >= 0 && argv[idx + 1]) {
    const raw = JSON.parse(readFileSync(argv[idx + 1], 'utf8')) as { email?: string; password?: string };
    if (!raw.email || !raw.password) throw new Error('凭据文件缺少 email/password');
    return { email: raw.email, password: raw.password };
  }
  if (process.env.PEDIATRICS_TEACHER_EMAIL && process.env.PEDIATRICS_TEACHER_PWD) {
    return { email: process.env.PEDIATRICS_TEACHER_EMAIL, password: process.env.PEDIATRICS_TEACHER_PWD };
  }
  throw new Error('缺少教师凭据：--cred-file <0600 JSON> 或 PEDIATRICS_TEACHER_EMAIL/PEDIATRICS_TEACHER_PWD（复用既有教师账号，不 signup 不改密）');
}

interface AuthResult { access_token: string; user: { id: string; email?: string } }

async function loginTeacher(): Promise<AuthResult> {
  const { email, password } = loadCredentials(process.argv);
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as AuthResult & { error_code?: string; msg?: string };
  if (!resp.ok || !body.access_token) throw new Error(`教师登录失败: ${body.error_code ?? resp.status}`);
  return body;
}

// ===== 教师身份校验（profiles.role 必须 teacher）=====
function userDb(accessToken: string) {
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${accessToken}` } },
  });
}

async function assertTeacherRole(accessToken: string, userId: string): Promise<void> {
  const db = userDb(accessToken);
  const { data, error } = await db.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (error || !data) throw new Error('无法读取 profiles（教师身份校验失败）');
  if (data.role !== 'teacher') throw new Error(`账号角色为 ${data.role}，非教师——拒绝预热（防止无意义召回）`);
}

// ===== 53 病例清单：本地 catalog + links 解析（不 import src，脚本独立运行）=====
interface CatalogEntry { id: string; name: string; folder?: string }

function loadCatalog(): CatalogEntry[] {
  const catalogText = readFileSync('src/domain/teacher-case-catalog.ts', 'utf8');
  const linksText = readFileSync('src/domain/teacher-case-links.ts', 'utf8');
  // catalog 为双引号 JSON 风格条目：{ "id": "xxx", "name": "yyy", "folder": "zzz" | null }
  const entryRe = /"id":\s*"([^"]+)"[^}]*?"name":\s*"([^"]+)"[^}]*?"folder":\s*(?:"([^"]+)"|null)/g;
  const entries: CatalogEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(catalogText)) !== null) {
    entries.push({ id: m[1], name: m[2], folder: m[3] });
  }
  // links: 别名 -> sourceId 映射，目标必须已登记
  const linkRe = /'([^']+)':\s*\{\s*sourceId:\s*'([^']+)'[^}]*\}/g;
  const linkTargets = new Set<string>();
  while ((m = linkRe.exec(linksText)) !== null) {
    linkTargets.add(m[2]);
  }
  const withFolder = entries.filter((e) => e.folder);
  for (const target of linkTargets) {
    if (!withFolder.some((e) => e.id === target)) throw new Error(`links 目标未在 catalog folder 登记: ${target}`);
  }
  return withFolder;
}

// ===== 召回可行性验证（verify-only）：仅用平台知识库凭据召回构建，不写库 =====
interface SnapFacts { history: string; exam: string; tests: string }
async function verifyRecall(cases: CatalogEntry[]): Promise<{ pass: number; fail: Array<{ id: string; reason: string }> }> {
  // 动态 import src 模块（路径别名由 tsx + tsconfig paths 支持，verify-53-cases-e2e.ts 同模式）
  const { ensureCaseSnapshot, getSnapshotVersion, getCachedSnapshot } = await import('../src/lib/case-snapshot');
  let pass = 0;
  const fail: Array<{ id: string; reason: string }> = [];
  for (const item of cases) {
    try {
      // verify-only：不传 accessToken/teacher，persistSnapshot 因 !teacher 直接跳过，不写库
      const snap = await ensureCaseSnapshot(item.id, {});
      if (!snap) { fail.push({ id: item.id, reason: '召回为空' }); continue; }
      const version = getSnapshotVersion(item.id);
      if (!version) { fail.push({ id: item.id, reason: '版本指纹缺失' }); continue; }
      const cached = getCachedSnapshot(item.id, version);
      if (!cached) { fail.push({ id: item.id, reason: '缓存未命中' }); continue; }
      const sections = cached.sections as SnapFacts;
      if (!sections.history || sections.history.length < 20) { fail.push({ id: item.id, reason: 'history 分段缺失' }); continue; }
      if (!sections.exam && !sections.tests) { fail.push({ id: item.id, reason: 'exam/tests 分段均缺失' }); continue; }
      pass++;
      console.log(`[OK] ${item.id} version=${version.slice(0, 8)} chunks=${snap.meta.chunkCount}`);
    } catch (error) {
      fail.push({ id: item.id, reason: (error as Error).message });
    }
  }
  return { pass, fail };
}

// ===== 预热模式：教师身份逐例 ensureCaseSnapshot（persistSnapshot 双写）=====
async function preheat(accessToken: string, cases: CatalogEntry[]): Promise<{ done: number; fail: Array<{ id: string; reason: string }> }> {
  const { ensureCaseSnapshot, getSnapshotVersion } = await import('../src/lib/case-snapshot');
  let done = 0;
  const fail: Array<{ id: string; reason: string }> = [];
  for (const item of cases) {
    try {
      const snap = await ensureCaseSnapshot(item.id, { accessToken, teacher: true });
      if (!snap) { fail.push({ id: item.id, reason: '召回为空' }); continue; }
      const version = getSnapshotVersion(item.id);
      console.log(`[OK] ${item.id} version=${(version ?? '?').slice(0, 8)} chunks=${snap.meta.chunkCount}`);
      done++;
    } catch (error) {
      fail.push({ id: item.id, reason: (error as Error).message });
    }
  }
  return { done, fail };
}

// ===== 健康计数复核（预热后）=====
async function healthCounts(accessToken: string): Promise<void> {
  const db = userDb(accessToken);
  const { data, error } = await db.rpc('case_knowledge_health_counts');
  if (error) throw error;
  const counts = data as { persisted_facts_versions: number; persisted_answer_versions: number; bound_teacher_sessions: number };
  console.log(`[健康计数] persisted_facts=${counts.persisted_facts_versions} persisted_answers=${counts.persisted_answer_versions} bound_sessions=${counts.bound_teacher_sessions}`);
}

// ===== 主流程 =====
async function main(): Promise<void> {
  console.log(`[模式] ${VERIFY_ONLY ? 'verify-only（仅召回验证，不写库，无需教师凭据）' : '预热（教师身份双写持久缓存）'}`);
  const cases = loadCatalog();
  console.log(`[清单] catalog folder 病例 ${cases.length} 份（links 目标已在册）`);

  if (VERIFY_ONLY) {
    const result = await verifyRecall(cases);
    console.log(`\n[结果] 召回可行 ${result.pass}/${cases.length}，失败 ${result.fail.length}`);
    for (const f of result.fail) console.log(`[FAIL] ${f.id}: ${f.reason}`);
    if (result.fail.length > 0) process.exit(1);
    return;
  }

  const auth = await loginTeacher();
  console.log(`[登录] 教师 token 获取成功 userId=${auth.user.id.slice(0, 8)}…`);
  await assertTeacherRole(auth.access_token, auth.user.id);
  console.log('[身份] profiles.role=teacher 校验通过');
  const result = await preheat(auth.access_token, cases);
  console.log(`\n[结果] 预热完成 ${result.done}/${cases.length}，失败 ${result.fail.length}`);
  for (const f of result.fail) console.log(`[FAIL] ${f.id}: ${f.reason}`);
  await healthCounts(auth.access_token);
  if (result.fail.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error('[FATAL]', (error as Error).message);
  process.exit(1);
});
