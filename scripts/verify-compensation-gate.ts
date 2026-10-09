/* eslint-disable no-console */
/**
 * 补偿迁移门控验证（20261015100000 恢复 orderedTests 门控）——真实平台直调 RPC。
 *
 * 验证点（全部结构性断言，不输出患者文本/答案/凭据）：
 * 1) 会话 A（已执行手卫生准备 + 真实查体动作，未开单）：RPC sections 含 history/exam 键、
 *    **不含 tests 键**（补偿后未开单时 tests 全文缺失，撤销 20261015090000 的放宽）；
 * 2) 会话 B（零动作）：RPC sections 仅 history 键（exam/tests 均剥离）；
 * 3) RPC 恒不返回 diagnosis/plan（走 get_reference 完成门控，本验证不触完成态）；
 * 4) 非本人会话 RPC 返回 null（归属校验保留）；
 * 5) 学生 RLS 直读 case_snapshot_facts 被拒/空（无放宽）。
 *
 * 安全边界：不创建账号、不伪造 JWT、不提权、不放宽 RLS/RPC；凭据经受控文件读取，
 * 不进命令行/输出/日志；结束 signOut(global)。
 *
 * 运行：pnpm tsx scripts/verify-compensation-gate.ts
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.RESTORE_BASE_URL ?? `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const CRED_FILE = process.env.COLDSTART_REAL_CRED_FILE ?? '/tmp/demo-student-credentials.txt';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('仅允许本地 dev server 地址');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

const CASE_ID = 'teacher-川崎病';

/** createSourceCase 的查体定义组合（toolId/bodyPartId），按序尝试至解锁一项 */
const EXAM_COMBOS: Array<[string, string]> = [
  ['stethoscope', 'chest'],
  ['inspection', 'skin'],
  ['tongue-depressor', 'mouth'],
  ['palpation', 'abdomen'],
  ['thermometer', 'forehead'],
  ['oximeter', 'finger'],
  ['bp-cuff', 'upper-arm'],
  ['flashlight', 'forehead'],
  ['reflex-hammer', 'limbs'],
];

function loadCredentials(): { email: string; password: string } {
  const raw = readFileSync(CRED_FILE, 'utf8');
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([a-zA-Z_]+)\s*[:=]\s*(.+?)\s*$/);
    if (match) map.set(match[1].toLowerCase(), match[2]);
  }
  const email = map.get('email');
  const password = map.get('password');
  if (!email || !password) throw new Error(`凭据文件 ${CRED_FILE} 缺少 email/password`);
  return { email, password };
}

interface AuthTokens { access_token: string; refresh_token: string }

async function login(email: string, password: string): Promise<AuthTokens> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as AuthTokens & { error_code?: string };
  if (!resp.ok || !body.access_token) throw new Error(`登录失败: ${body.error_code ?? resp.status}`);
  return body;
}

async function signOutGlobal(tokens: AuthTokens): Promise<boolean> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.access_token}` },
  });
  return resp.ok;
}

interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code: string; message: string } }
async function api<T>(path: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}

interface TurnData {
  session: { id: string; unlockedEvidence: string[]; orderedTests: string[] };
  newMessages: Array<{ actor: string; content: string }>;
}

let eventSeq = 0;
async function turn(token: string, sessionId: string, event: Record<string, unknown>): Promise<{ status: number; body: ApiEnvelope<TurnData> }> {
  eventSeq += 1;
  return api<TurnData>('/api/agent/turn', {
    method: 'POST', token,
    body: JSON.stringify({ sessionId, clientEventId: `verify-gate-${sessionId.slice(0, 8)}-${eventSeq}`, event }),
  });
}

interface Check { name: string; pass: boolean }
const checks: Check[] = [];
function check(name: string, pass: boolean): void {
  checks.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
}
function observe(name: string, value: unknown): void {
  console.log(`OBS   ${name}: ${JSON.stringify(value)}`);
}

/** RPC 返回 facts 的 sections 键集合与各键字符计数（不输出内容本身） */
function sectionShape(facts: unknown): { keys: string[]; lengths: Record<string, number> } {
  const sections = (facts as { sections?: Record<string, unknown> })?.sections ?? {};
  const keys = Object.keys(sections).sort();
  const lengths: Record<string, number> = {};
  for (const key of keys) lengths[key] = typeof sections[key] === 'string' ? (sections[key] as string).length : -1;
  return { keys, lengths };
}

async function main(): Promise<void> {
  const creds = loadCredentials();
  const tokens = await login(creds.email, creds.password);
  const token = tokens.access_token;
  check('登录：学生演示身份成功', true);

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- 会话 A：prep + 真实查体动作（未开单） ----
  const createdA = await api<{ id: string; sourceSnapshotVersion?: string | null }>('/api/sessions', {
    method: 'POST', token, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }),
  });
  if (createdA.status !== 201 || !createdA.body.data) throw new Error(`创建会话 A 失败: ${createdA.status} ${createdA.body.error?.code ?? ''}`);
  const sessionA = createdA.body.data.id;
  const version = createdA.body.data.sourceSnapshotVersion ?? null;
  check('建会话 A：绑定版本指纹（16 位 hex）', /^[0-9a-f]{16}$/.test(version ?? ''));

  const prep = await turn(token, sessionA, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } });
  check('A 手卫生准备：200 且解锁 EX_PREP', prep.status === 200 && (prep.body.data?.session.unlockedEvidence ?? []).includes('EX_PREP'));

  let examUnlocked = false;
  for (const combo of EXAM_COMBOS) {
    const result = await turn(token, sessionA, { type: 'EXAM_ACTION', data: { toolId: combo[0], bodyPartId: combo[1] } });
    if (result.status !== 200) throw new Error(`A 查体动作 HTTP ${result.status}: ${result.body.error?.code ?? ''}`);
    const gained = (result.body.data?.session.unlockedEvidence ?? []).some((code) => code.startsWith('SOURCE_EX_'));
    if (gained && (result.body.data?.newMessages ?? []).length > 0) { examUnlocked = true; break; }
  }
  check('A 真实查体动作：解锁 SOURCE_EX_ 证据（查体闭环，不因会话作用域化永远空）', examUnlocked);

  // ---- 核心断言 1：A（已查体、未开单）直调 RPC —— sections.tests 必须缺失 ----
  const { data: rpcA, error: rpcAError } = await db.rpc('case_snapshot_get_facts', {
    p_case_id: CASE_ID, p_version: version ?? '', p_session_id: sessionA,
  });
  check('RPC 直调（A）：无错误返回', !rpcAError);
  const shapeA = sectionShape(rpcA);
  observe('RPC A sections 键与字符计数（结构性）', shapeA);
  check('补偿门控：A 已查体未开单 —— sections 含 exam 键（查体事实按证据投影）', shapeA.keys.includes('exam'));
  check('补偿门控：A 未开单 —— sections.tests 键缺失（撤销放宽，全文不可见）', !shapeA.keys.includes('tests'));
  check('恒定边界：A sections 无 diagnosis/plan 键', !shapeA.keys.includes('diagnosis') && !shapeA.keys.includes('plan'));

  // ---- 会话 B：零动作 ----
  const createdB = await api<{ id: string; sourceSnapshotVersion?: string | null }>('/api/sessions', {
    method: 'POST', token, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }),
  });
  if (createdB.status !== 201 || !createdB.body.data) throw new Error(`创建会话 B 失败: ${createdB.status}`);
  const sessionB = createdB.body.data.id;
  check('建会话 B：与 A 同一绑定版本', createdB.body.data.sourceSnapshotVersion === version);

  const { data: rpcB } = await db.rpc('case_snapshot_get_facts', {
    p_case_id: CASE_ID, p_version: version ?? '', p_session_id: sessionB,
  });
  const shapeB = sectionShape(rpcB);
  observe('RPC B sections 键与字符计数（结构性）', shapeB);
  check('零动作隔离：B sections 无 exam 键（未执行查体）', !shapeB.keys.includes('exam'));
  check('零动作隔离：B sections 无 tests 键（未开单）', !shapeB.keys.includes('tests'));
  check('零动作隔离：B 仍有 history 键（facts 载荷本身有效）', shapeB.keys.includes('history'));

  // ---- 归属校验与 RLS 无放宽 ----
  const { data: rpcForeign } = await db.rpc('case_snapshot_get_facts', {
    p_case_id: CASE_ID, p_version: version ?? '', p_session_id: randomUUID(),
  });
  check('归属校验保留：非本人会话 RPC 返回 null', rpcForeign === null || rpcForeign === undefined);
  const { data: direct, error: directError } = await db.from('case_snapshot_facts').select('case_id,version').limit(1);
  check('RLS 无放宽：学生直读 case_snapshot_facts 被拒/空', Boolean(directError) || (direct ?? []).length === 0);

  // ---- 已知死锁记录（不伪造开单不猜 testId，仅结构记录） ----
  const aRead = await api<TurnData['session'] & { caseOptions?: { tests?: unknown[] } | null }>(`/api/sessions/${sessionA}`, { token });
  const testsCatalogCount = ((aRead.body.data as unknown as { caseOptions?: { tests?: unknown[] } })?.caseOptions?.tests ?? []).length;
  observe('orderedTests 死锁记录：A 已查体后 caseOptions.tests 目录数量（补偿门控下预期 0）', testsCatalogCount);

  const revoked = await signOutGlobal(tokens);
  check('收尾：signOut(global) 撤销本次会话', revoked);

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n==== 补偿迁移门控验证（学生演示身份直调 RPC）：${checks.length - failed}/${checks.length} 通过 ====`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main().catch((e: unknown) => {
  console.error('验证异常：', (e as Error).message);
  process.exitCode = 1;
});
