/* eslint-disable no-console */
/**
 * 双学生账号训练会话归属/越权验收（2026-10-10）：
 * - 严格复用既有两个合法学生身份：probe 测试账号（A）与演示学生账号（B），
 *   受控凭据仅从 0600 文件读取（/workspace/.demo-secrets/），只 login 不 signup，
 *   不创建/删除/改密/提权，不使用任何随机新增账号。
 * - 任一身份不可用 → 该分支 SKIP 并保留未验，不找替代身份。
 * - 验收面：
 *   1) A/B 各经正常 API 创建最少本人会话（各 1 个，guided）；
 *   2) 本人正向对照：读本人会话详情 + 合法最小回合（DOCTOR_INTERVENTION，不涉 AI/开单/答案）；
 *   3) AB/BA 互读会话详情 / 互提交回合 / 互 finish：预期 403/404，任何 200 须判归属；
 *   4) 拒绝写入前后：受害方会话指纹（stateVersion/messagesCount/status/reportId）不变；
 *   5) 学生访问教师接口（students/usage-stats/teacher session/题池 review）：预期 403；
 *   6) RPC 直读（既有公开可调用契约 case_snapshot_get_facts）：以 A token 传 B 的 sessionId → null；反向同；
 *   7) RLS 直查 training_sessions 对方会话行 → 空集/被拒；
 *   8) 报告列表仅含本人（不出现对方 sessionId）；
 *   9) 匿名访问 401 对照；小并发（双身份并行读本人+RPC）缓存隔离；
 *   10) 结束双端 signOut(global)。
 * - 输出仅：状态码、结构断言布尔、指纹（版本/计数），不输出患者内容、题目答案、凭据。
 * - 不删除业务数据；本脚本创建的测试会话保留（明确标记 clientEventId 前缀 verify-dual）。
 * - 已知边界：orderedTests 死锁链路不推进、不伪造开单；process/pending finish 不当临床流程通过。
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.DUAL_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const PROBE_FILE = process.env.DUAL_A_CRED_FILE ?? '/workspace/.demo-secrets/probe-account-credentials-deprecated.txt';
const DEMO_FILE = process.env.DUAL_B_CRED_FILE ?? '/workspace/.demo-secrets/demo-student-credentials.txt';
const CASE_ID = 'teacher-川崎病'; // 既有验证可建会话的真实教师病例
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

interface Creds { email: string; password: string }
function readCreds(path: string): Creds {
  const map: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = /^(email|password)\s*[:=]\s*(.+)$/i.exec(line.trim());
    if (m) map[m[1].toLowerCase()] = m[2].trim();
  }
  if (!map.email || !map.password) throw new Error(`凭据文件 ${path} 缺少 email/password`);
  return { email: map.email, password: map.password };
}

interface AuthTokens { access_token: string; refresh_token: string }
async function login(email: string, password: string): Promise<AuthTokens | null> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) return null;
  const body = (await resp.json()) as AuthTokens;
  return body.access_token ? body : null;
}
async function signOutGlobal(token: string): Promise<boolean> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  return Boolean(resp?.ok);
}

interface ApiEnvelope<T> { ok?: boolean; data?: T; error?: { code?: string; message?: string } }
async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}

const passed: string[] = [];
const failed: string[] = [];
const skipped: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed.push(name); console.log(`PASS  ${name}`); }
  else { failed.push(name); console.log(`FAIL  ${name}${detail ? ` (${detail})` : ''}`); }
}
function skip(name: string, why: string): void {
  skipped.push(name); console.log(`SKIP  ${name}（${why}）`);
}

/** 会话结构指纹（不含任何病例内容） */
interface Fp { id: string; caseId: string; stage: string; status: string; stateVersion: number; version: string | null; msgCount: number; reportId: string | null }
function fpOf(s: Record<string, unknown>): Fp {
  const state = (s.state as Record<string, unknown> | undefined) ?? {};
  const messages = (state.messages as unknown[] | undefined) ?? (s.messages as unknown[] | undefined) ?? [];
  return {
    id: String(s.id ?? ''),
    caseId: String(s.caseId ?? ''),
    stage: String(s.stage ?? state.stage ?? ''),
    status: String(s.status ?? state.status ?? ''),
    stateVersion: Number(s.stateVersion ?? state.stateVersion ?? 0),
    version: (s.sourceSnapshotVersion as string | null) ?? (state.sourceSnapshotVersion as string | null) ?? null,
    msgCount: messages.length,
    reportId: (s.reportId as string | null) ?? (state.reportId as string | null) ?? null,
  };
}
async function readSession(token: string, id: string): Promise<{ status: number; fp: Fp | null }> {
  const r = await api<Record<string, unknown>>(`/api/sessions/${id}`, { token });
  return { status: r.status, fp: r.body.data ? fpOf(r.body.data as Record<string, unknown>) : null };
}

interface Identity { label: string; token: string | null; fp: Fp | null }

async function main(): Promise<void> {
  // === 身份装载：只 login，不 signup ===
  const a: Identity = { label: 'A(probe测试学生)', token: null, fp: null };
  const b: Identity = { label: 'B(演示学生)', token: null, fp: null };
  try {
    const probe = readCreds(PROBE_FILE);
    const t = await login(probe.email, probe.password);
    a.token = t?.access_token ?? null;
  } catch { a.token = null; }
  try {
    const demo = readCreds(DEMO_FILE);
    const t = await login(demo.email, demo.password);
    b.token = t?.access_token ?? null;
  } catch { b.token = null; }  check('A(probe) 登录成功（既有身份，仅 login）', a.token !== null);
  check('B(演示) 登录成功（既有身份，仅 login）', b.token !== null);

  if (!a.token || !b.token) {
    skip('双账号越权矩阵', '存在不可用身份（凭据文件缺失/登录失败），该分支整体保留未验，不找替代身份');
    const out = !a.token && !b.token ? 'AB 均不可用' : !a.token ? 'A(probe) 不可用' : 'B(演示) 不可用';
    console.log(`\n==== 双学生账号验收：身份不可用（${out}），矩阵未执行 ====`);
    process.exitCode = 1;
    return;
  }
  const A = a.token;
  const B = b.token;

  // === 1) 各建最少本人会话（guided，明确标记） ===
  const mk = await (async (token: string) => {
    const r = await api<Record<string, unknown>>('/api/sessions', { method: 'POST', token, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }) });
    return r.status === 201 && r.body.data ? fpOf(r.body.data as Record<string, unknown>) : null;
  })(A);
  const A_FP = mk;
  check('A 建会话 201（本人 guided，测试会话保留不删）', A_FP !== null);
  const B_FP = await (async () => {
    const r = await api<Record<string, unknown>>('/api/sessions', { method: 'POST', token: B, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }) });
    return r.status === 201 && r.body.data ? fpOf(r.body.data as Record<string, unknown>) : null;
  })();
  check('B 建会话 201（本人 guided，测试会话保留不删）', B_FP !== null);
  if (!A_FP || !B_FP) throw new Error('会话创建失败，无法继续');

  // === 2) 本人正向对照 ===
  const aRead = await readSession(A, A_FP.id);
  check('A 正向：读本人会话 200 且归属一致（sessionId/caseId 匹配）', aRead.status === 200 && aRead.fp?.id === A_FP.id && aRead.fp?.caseId === CASE_ID);
  const bRead = await readSession(B, B_FP.id);
  check('B 正向：读本人会话 200 且归属一致', bRead.status === 200 && bRead.fp?.id === B_FP.id && bRead.fp?.caseId === CASE_ID);

  // 合法最小回合（DOCTOR_INTERVENTION：不涉开单/答案/AI 生成路径）
  const turnBody = (sid: string, tag: string) => JSON.stringify({
    sessionId: sid, clientEventId: `verify-dual-${tag}-${Date.now()}`,
    event: { type: 'DOCTOR_INTERVENTION', data: { action: 'comfort_child' } },
  });
  const aTurn = await api<Record<string, unknown>>('/api/agent/turn', { method: 'POST', token: A, body: turnBody(A_FP.id, 'A1') });
  check('A 正向：合法最小回合（安抚患儿）非错误状态', aTurn.status === 200 || aTurn.status === 201, `status=${aTurn.status}`);
  if (aTurn.status >= 400) console.log(`  NOTE A 回合返回 ${aTurn.status} ${aTurn.body.error?.code ?? ''}（回合失败不阻断越权矩阵，另行记录）`);
  const aFp2 = (await readSession(A, A_FP.id)).fp;
  check('A 正向：回合后本人会话仍可读', aFp2 !== null);

  // === 3) 互读会话详情（AB/BA） ===
  const aReadB = await readSession(A, B_FP.id);
  check('A 读 B 会话被拒（403/404）且无数据', (aReadB.status === 403 || aReadB.status === 404) && aReadB.fp === null, `status=${aReadB.status}`);
  const bReadA = await readSession(B, A_FP.id);
  check('B 读 A 会话被拒（403/404）且无数据', (bReadA.status === 403 || bReadA.status === 404) && bReadA.fp === null, `status=${bReadA.status}`);

  // === 4) 互提交回合（写入拒绝 + 前后指纹不变） ===
  const bBefore = (await readSession(B, B_FP.id)).fp;
  const aTurnB = await api('/api/agent/turn', { method: 'POST', token: A, body: turnBody(B_FP.id, 'A2B') });
  check('A 向 B 会话提交回合被拒（403/404）', aTurnB.status === 403 || aTurnB.status === 404, `status=${aTurnB.status}`);
  const bAfter = (await readSession(B, B_FP.id)).fp;
  check('A 越权回合被拒后：B 会话指纹不变（stateVersion/messages/status）',
    bBefore !== null && bAfter !== null && bBefore.stateVersion === bAfter.stateVersion && bBefore.msgCount === bAfter.msgCount && bBefore.status === bAfter.status);

  const aBefore = (await readSession(A, A_FP.id)).fp;
  const bTurnA = await api('/api/agent/turn', { method: 'POST', token: B, body: turnBody(A_FP.id, 'B2A') });
  check('B 向 A 会话提交回合被拒（403/404）', bTurnA.status === 403 || bTurnA.status === 404, `status=${bTurnA.status}`);
  const aAfter = (await readSession(A, A_FP.id)).fp;
  check('B 越权回合被拒后：A 会话指纹不变',
    aBefore !== null && aAfter !== null && aBefore.stateVersion === aAfter.stateVersion && aBefore.msgCount === aAfter.msgCount && aBefore.status === aAfter.status);

  // === 5) 互 finish（写入拒绝 + 受害方会话未被终结） ===
  const aFinishB = await api(`/api/sessions/${B_FP.id}/finish`, { method: 'POST', token: A, body: '{}' });
  check('A 对 B 会话 finish 被拒（403/404）', aFinishB.status === 403 || aFinishB.status === 404, `status=${aFinishB.status}`);
  const bPost = (await readSession(B, B_FP.id)).fp;
  check('A 越权 finish 被拒后：B 会话未被终结（status=active、无 reportId）',
    bPost !== null && bPost.status === 'active' && bPost.reportId === null);
  const bFinishA = await api(`/api/sessions/${A_FP.id}/finish`, { method: 'POST', token: B, body: '{}' });
  check('B 对 A 会话 finish 被拒（403/404）', bFinishA.status === 403 || bFinishA.status === 404, `status=${bFinishA.status}`);
  const aPost = (await readSession(A, A_FP.id)).fp;
  check('B 越权 finish 被拒后：A 会话未被终结（status=active、无 reportId）',
    aPost !== null && aPost.status === 'active' && aPost.reportId === null);

  // === 6) 学生访问教师接口（四个端点） ===
  const tStudents = await api('/api/teacher/students', { token: A });
  check('A(学生) 访问教师学生列表 403', tStudents.status === 403, `status=${tStudents.status}`);
  const tStats = await api('/api/teacher/usage-stats', { token: B });
  check('B(学生) 访问教师统计 403', tStats.status === 403, `status=${tStats.status}`);
  const tSession = await api(`/api/teacher/sessions/${B_FP.id}`, { token: A });
  check('A(学生) 访问教师会话详情 403（含 B 会话 id 场景）', tSession.status === 403, `status=${tSession.status}`);
  const tPool = await api('/api/quiz/review', { method: 'POST', token: A, body: JSON.stringify({}) });
  check('A(学生) 访问教师题池状态 403/422（拒绝教师面）', tPool.status === 403 || tPool.status === 422, `status=${tPool.status}`);

  // === 7) RPC 直读（既有公开契约 case_snapshot_get_facts） ===
  const { createClient } = await import('@supabase/supabase-js');
  const dbA = createClient(SUPA_URL, SUPA_ANON_KEY, { global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${A}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const dbB = createClient(SUPA_URL, SUPA_ANON_KEY, { global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${B}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const rpcArgs = (caseId: string, version: string | null, sessionId: string) => ({ p_case_id: caseId, p_version: version ?? '', p_session_id: sessionId });
  // 正向：A 本人会话 → 返回 facts 载荷
  const { data: rpcAOwn } = await dbA.rpc('case_snapshot_get_facts', rpcArgs(A_FP.caseId, A_FP.version, A_FP.id));
  check('RPC 正向：A 本人会话返回 facts 载荷（caseId 一致）', Boolean(rpcAOwn) && String((rpcAOwn as Record<string, unknown>).caseId ?? '') === CASE_ID);
  // 越权：A token 传 B 的 sessionId → null
  const { data: rpcAB } = await dbA.rpc('case_snapshot_get_facts', rpcArgs(B_FP.caseId, B_FP.version, B_FP.id));
  check('RPC 越权：A token 读 B 的 sessionId 返回 null', rpcAB === null || rpcAB === undefined, `data=${rpcAB === null ? 'null' : typeof rpcAB}`);
  const { data: rpcBA } = await dbB.rpc('case_snapshot_get_facts', rpcArgs(A_FP.caseId, A_FP.version, A_FP.id));
  check('RPC 越权：B token 读 A 的 sessionId 返回 null', rpcBA === null || rpcBA === undefined, `data=${rpcBA === null ? 'null' : typeof rpcBA}`);

  // === 8) RLS 直查对方会话行（training_sessions，只读 SELECT） ===
  const { data: rowsA, error: errA } = await dbA.from('training_sessions').select('id').eq('id', B_FP.id);
  check('RLS：A 直查 B 会话行空集/被拒', Boolean(errA) || (rowsA ?? []).length === 0);
  const { data: rowsB, error: errB } = await dbB.from('training_sessions').select('id').eq('id', A_FP.id);
  check('RLS：B 直查 A 会话行空集/被拒', Boolean(errB) || (rowsB ?? []).length === 0);

  // === 9) 报告列表隔离（本人列表不出现对方会话） ===
  const repA = await api<Array<Record<string, unknown>>>('/api/reports', { token: A });
  const repB = await api<Array<Record<string, unknown>>>('/api/reports', { token: B });
  const aList = (repA.body.data ?? []) as Array<Record<string, unknown>>;
  const bList = (repB.body.data ?? []) as Array<Record<string, unknown>>;
  const aSessionIds = aList.map((r) => String((r.case as Record<string, unknown> | undefined)?.sessionId ?? r.sessionId ?? ''));
  const bSessionIds = bList.map((r) => String((r.case as Record<string, unknown> | undefined)?.sessionId ?? r.sessionId ?? ''));
  check('报告列表：A 列表不出现 B 的会话 id', !aSessionIds.includes(B_FP.id), `A 列表 ${aList.length} 条`);
  check('报告列表：B 列表不出现 A 的会话 id', !bSessionIds.includes(A_FP.id), `B 列表 ${bList.length} 条`);

  // === 10) 匿名对照 ===
  const anon = await api(`/api/sessions/${A_FP.id}`);
  check('匿名读会话 401', anon.status === 401, `status=${anon.status}`);
  const anonTurn = await api('/api/agent/turn', { method: 'POST', body: turnBody(A_FP.id, 'anon') });
  check('匿名提交回合 401', anonTurn.status === 401, `status=${anonTurn.status}`);

  // === 11) 小并发缓存隔离（双身份并行本人读 + RPC，各归各） ===
  const [, , , rpcRaceA, rpcRaceB] = await Promise.all([
    readSession(A, A_FP.id), readSession(B, B_FP.id),
    readSession(A, A_FP.id), // 同一会话并发读两次
    dbA.rpc('case_snapshot_get_facts', rpcArgs(A_FP.caseId, A_FP.version, A_FP.id)),
    dbB.rpc('case_snapshot_get_facts', rpcArgs(B_FP.caseId, B_FP.version, B_FP.id)),
  ]);
  check('并发隔离：A 并行 RPC 仍得本人 facts（caseId 一致）',
    Boolean(rpcRaceA.data) && String((rpcRaceA.data as Record<string, unknown>).caseId ?? '') === CASE_ID);
  check('并发隔离：B 并行 RPC 仍得本人 facts（caseId 一致）',
    Boolean(rpcRaceB.data) && String((rpcRaceB.data as Record<string, unknown>).caseId ?? '') === CASE_ID);

  // === 12) 收尾：双端登出 ===
  check('A signOut(global)', await signOutGlobal(A));
  check('B signOut(global)', await signOutGlobal(B));

  console.log(`\n==== 双学生账号归属/越权验收：${passed.length} 通过 / ${failed.length} 失败 / ${skipped.length} 跳过 ====`);
  if (failed.length > 0) {
    console.log('失败项:');
    for (const f of failed) console.log(`  - ${f}`);
  }
  process.exitCode = failed.length === 0 ? 0 : 1;
}

void main().catch((e: unknown) => {
  console.error('FATAL', (e as Error).message);
  process.exitCode = 1;
});
