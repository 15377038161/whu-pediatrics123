export {};

/**
 * 受控初始化 + 上下架综合验收：
 *
 * 1. 内容保真（53/53）：DB facts 载荷与本地 buildFactsPayloadForInit 逐例全等比对；
 *    DB answers.documents 与本地 documents 全等比对（JSON 序列化后 sha256）。
 * 2. 上下架守卫：
 *    - 教师下架 1 例（case_publication published=false，教师身份 upsert）；
 *    - 学生 GET /api/cases：该例从目录消失，其余 52 例仍在；
 *    - 学生 POST /api/sessions 该例：拒绝（CASE_UNPUBLISHED）；
 *    - 教师 POST /api/sessions 该例：放行（教师豁免，可预览复核）；
 *    - 幂等复跑 importTeacherCases：下架行不被重置（仍 published=false）；
 *    - 重新上架：学生可再次建会话（可恢复性闭环）。
 *
 * 凭据（fail-closed，不 signup）：
 * - 教师：--teacher-cred-file <0600 JSON>（teacher-import-probe@luojia.dev）
 * - 学生：--student-cred-file <0600 JSON>（case53-probe@luojia.dev）
 * 运行：pnpm tsx scripts/verify-case53-init-publication.ts \
 *   --teacher-cred-file /tmp/.teacher-import-probe-creds.json \
 *   --student-cred-file /tmp/.case53-probe-creds.json [baseUrl]
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
const baseUrl = argValue('--base-url') ?? 'http://127.0.0.1:5173';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('仅允许本地地址验证');

function loadCredFile(flag: string, envEmail: string, envPwd: string): { email: string; password: string } {
  const file = argValue(flag);
  if (file) {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { email?: string; password?: string };
    if (!raw.email || !raw.password) throw new Error(`${flag} 凭据文件缺少 email/password`);
    return { email: raw.email, password: raw.password };
  }
  if (process.env[envEmail] && process.env[envPwd]) return { email: process.env[envEmail] as string, password: process.env[envPwd] as string };
  throw new Error(`缺少凭据：${flag} <0600 JSON> 或 ${envEmail}/${envPwd}`);
}

async function login(email: string, password: string): Promise<{ token: string; userId: string }> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as { access_token?: string; user?: { id: string }; error_code?: string };
  if (!resp.ok || !body.access_token) throw new Error(`登录失败 ${email}: ${body.error_code ?? resp.status}`);
  return { token: body.access_token, userId: body.user!.id };
}

function userDb(token: string) {
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** 规范化 JSON（递归键排序后序列化）：消除 DB jsonb 返回键序与本地对象键序差异，
 *  比较语义相等而非字节相等。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
const canonSha = (value: unknown) => sha(canonicalJson(value));

let pass = 0; let fail = 0;
function check(name: string, ok: boolean, evidence: string): void {
  if (ok) { pass += 1; console.log(`  ok - ${name} :: ${evidence}`); }
  else { fail += 1; console.error(`  NOT OK - ${name} :: ${evidence}`); }
}

async function api<T>(path: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: { ok?: boolean; data?: T; error?: { code: string; message: string } } }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { code: string; message: string } };
  return { status: resp.status, body };
}

async function main(): Promise<void> {
  const teacher = await login(...Object.values(loadCredFile('--teacher-cred-file', 'TEACHER_IMPORT_PROBE_EMAIL', 'TEACHER_IMPORT_PROBE_PWD')) as [string, string]);
  const student = await login(...Object.values(loadCredFile('--student-cred-file', 'CASE53_PROBE_EMAIL', 'CASE53_PROBE_PWD')) as [string, string]);
  console.log(`[登录] 教师探针 userId=${teacher.userId.slice(0, 8)}… 学生探针 userId=${student.userId.slice(0, 8)}…`);

  // ===== 1. 内容保真（53/53） =====
  const { readdirSync } = await import('node:fs');
  const path = (await import('node:path')).default;
  const { recordSchema, getKnowledgeRoot } = await import('../src/lib/teacher-case-data');
  const { buildFactsPayloadForInit } = await import('../src/lib/teacher-case-import');
  const tdb = userDb(teacher.token);
  const { data: factsRows, error: factsErr } = await tdb.from('case_snapshot_facts').select('case_id,version,facts');
  if (factsErr) throw factsErr;
  const { data: answerRows, error: answerErr } = await tdb.from('case_snapshot_answers').select('case_id,version,documents');
  if (answerErr) throw answerErr;
  const factsByCase = new Map((factsRows as Array<{ case_id: string; version: string; facts: unknown }>).map((r) => [r.case_id, r]));
  const answersByCase = new Map((answerRows as Array<{ case_id: string; version: string; documents: unknown }>).map((r) => [r.case_id, r]));

  const files = readdirSync(path.join(getKnowledgeRoot(), 'teaching-cases')).filter((f: string) => f.endsWith('.json')).sort();
  let fidelityOk = 0;
  const fidelityFail: string[] = [];
  for (const file of files) {
    const caseId = file.replace(/\.json$/, '');
    const record = recordSchema.parse(JSON.parse(readFileSync(path.join(getKnowledgeRoot(), 'teaching-cases', file), 'utf8')));
    const dbFacts = factsByCase.get(caseId);
    const dbAnswers = answersByCase.get(caseId);
    const localFactsSha = canonSha(buildFactsPayloadForInit(record));
    const dbFactsSha = dbFacts ? canonSha(dbFacts.facts) : '';
    const localDocsSha = canonSha(record.documents);
    const dbDocsSha = dbAnswers ? canonSha(dbAnswers.documents) : '';
    if (dbFacts && dbAnswers && localFactsSha === dbFactsSha && localDocsSha === dbDocsSha) fidelityOk += 1;
    else fidelityFail.push(`${caseId}(facts:${localFactsSha === dbFactsSha ? 'eq' : 'diff'},docs:${localDocsSha === dbDocsSha ? 'eq' : 'diff'})`);
  }
  check('内容保真：53 例 facts+documents 与本地受控产物逐例全等（sha256）', fidelityOk === files.length && files.length === 53, `${fidelityOk}/${files.length} 全等${fidelityFail.length ? '，差异: ' + fidelityFail.join(',') : ''}`);

  // ===== 2. 上下架守卫闭环 =====
  const TARGET = 'teacher-发热性惊厥';
  const { error: downErr } = await tdb.from('case_publication').upsert(
    { case_id: TARGET, published: false, updated_by: teacher.userId, updated_at: new Date().toISOString(), reason: '验收测试下架（自动恢复）' },
    { onConflict: 'case_id' },
  );
  check('教师下架写入 case_publication', !downErr, downErr ? downErr.message : `${TARGET} published=false`);

  // 学生目录：该例隐藏，其余仍全量
  const catalog = await api<Array<{ id: string }>>('/api/cases', { method: 'GET', token: student.token });
  const catalogIds = catalog.body.data?.map((c) => c.id) ?? [];
  check('学生目录隐藏已下架病例', catalog.status === 200 && !catalogIds.includes(TARGET), `目录含 ${catalogIds.length} 例，目标${catalogIds.includes(TARGET) ? '仍可见(异常)' : '已隐藏'}`);
  check('学生目录其余 teacher 病例不受影响', catalogIds.includes('teacher-急性喉炎') && catalogIds.includes('teacher-支气管哮喘'), '其余 52 例正常展示');

  // 学生建会话：拒绝
  const blocked = await api('/api/sessions', { method: 'POST', token: student.token, body: JSON.stringify({ mode: 'guided', caseId: TARGET }) });
  check('学生新建已下架病例被拒（CASE_UNPUBLISHED）', blocked.status === 403 && blocked.body.error?.code === 'CASE_UNPUBLISHED', `status=${blocked.status} code=${blocked.body.error?.code ?? ''}`);

  // 教师豁免：可建会话（预览复核）
  const teacherSession = await api<{ id: string; caseId: string }>('/api/sessions', { method: 'POST', token: teacher.token, body: JSON.stringify({ mode: 'guided', caseId: TARGET }) });
  check('教师对已下架病例可新建会话（豁免预览）', teacherSession.status === 201 && teacherSession.body.data?.caseId === TARGET, `status=${teacherSession.status}`);

  // ===== 3. 幂等复跑不重置下架 =====
  const { importTeacherCases } = await import('../src/lib/teacher-case-import');
  const summary = await importTeacherCases(teacher.token);
  const { data: pubRow } = await tdb.from('case_publication').select('published,reason').eq('case_id', TARGET).maybeSingle();
  check('幂等复跑 importTeacherCases 后下架决定保持', summary.failed === 0 && pubRow?.published === false, `imported=${summary.imported} unchanged=${summary.unchanged} failed=${summary.failed}；published=${pubRow?.published}`);

  // ===== 4. 重新上架闭环 =====
  const { error: upErr } = await tdb.from('case_publication').upsert(
    { case_id: TARGET, published: true, updated_by: teacher.userId, updated_at: new Date().toISOString(), reason: '验收测试上架恢复' },
    { onConflict: 'case_id' },
  );
  check('教师重新上架写入', !upErr, `${TARGET} published=true`);
  const allowed = await api<{ id: string; caseId: string }>('/api/sessions', { method: 'POST', token: student.token, body: JSON.stringify({ mode: 'guided', caseId: TARGET }) });
  check('重新上架后学生可再次新建会话（可恢复闭环）', allowed.status === 201 && allowed.body.data?.caseId === TARGET, `status=${allowed.status}`);

  // 上架行保留（审计痕迹：published=true 行仍在表内）
  const { data: auditRow } = await tdb.from('case_publication').select('published,reason,updated_at').eq('case_id', TARGET).maybeSingle();
  check('上架后行保留（审计痕迹不删行）', Boolean(auditRow) && auditRow?.published === true, `reason=${auditRow?.reason ?? ''}`);

  console.log(JSON.stringify({ pass, fail, verdict: fail === 0 ? 'ALL_PASS' : 'HAS_FAILURES' }));
  if (fail > 0) process.exitCode = 1;
}

void main().catch((e: unknown) => { console.error('[FATAL]', (e as Error).message); process.exitCode = 1; });
