/* eslint-disable no-console */
/**
 * 重启持久化验证（两阶段、两独立进程，等价于服务重启后的 DB 恢复路径）：
 * - 阶段 1（默认，经 dev server HTTP）：真实学生登录（凭据见下）-> 建会话 -> 若干回合
 *   （问诊+查体，使 state 非初始形态）-> 记录会话指纹 -> 将 access/refresh token 写入
 *   0600 临时凭据文件，跨进程仅传【非秘密定位符】（凭据文件路径 + sessionId + 指纹）；
 * - 阶段 2（--restore <authFile> <sessionId> <fingerprintJson>，独立 tsx 进程直连 DB，
 *   不经 dev server）：从凭据文件读 token 恢复会话逐字段比对，结束后 signOut(global)
 *   撤销本次 refresh 会话并删除凭据文件。
 *
 * 凭据安全约定（本轮泄露处置后固化）：
 * - 凭据不得出现在 CLI 参数 / 命令文本 / console 输出 / 截图中；
 * - 输入通道仅两种：--cred-file <0600 JSON 文件 {email,password}>（推荐）或
 *   PERSIST_PROBE_EMAIL / PERSIST_PROBE_PWD 环境变量；两者皆缺则 fail-closed 退出；
 * - 不再默认 signup 新账号（复用既有测试账号，避免清理类验证扩散测试用户）；
 * - 阶段间传递的只有：凭据文件路径（受 0600 保护、阶段 2 删除）、sessionId、脱敏指纹。
 * 运行：
 *   pnpm tsx scripts/verify-restart-persistence.ts --cred-file /path/to/creds.json
 *   pnpm tsx scripts/verify-restart-persistence.ts --restore <authFile> <sessionId> <fingerprintJson>
 */
export {};

import { readFileSync, writeFileSync, unlinkSync, chmodSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.RESTORE_BASE_URL ?? 'http://127.0.0.1:5173';
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('仅允许本地地址验证');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code: string; message: string } }
async function api<T>(path: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}

interface Fingerprint {
  sessionId: string;
  caseId: string;
  stage: string;
  status: string;
  stateVersion: number;
  sourceSnapshotVersion: string | null;
  factsCount: number;
  messagesCount: number;
}

// 从 API 会话负载提取指纹（顶层字段 + state 内字段双路径兼容）
function fingerprintFromApi(session: Record<string, unknown>): Fingerprint {
  const state = (session.state as Record<string, unknown> | undefined) ?? {};
  const facts = (state.facts as unknown[] | undefined) ?? (session.facts as unknown[] | undefined) ?? [];
  const messages = (state.messages as unknown[] | undefined) ?? (session.messages as unknown[] | undefined) ?? [];
  return {
    sessionId: String(session.id ?? ''),
    caseId: String(session.caseId ?? ''),
    stage: String(session.stage ?? state.stage ?? ''),
    status: String(session.status ?? state.status ?? ''),
    stateVersion: Number(session.stateVersion ?? state.stateVersion ?? 0),
    sourceSnapshotVersion: (session.sourceSnapshotVersion as string | null) ?? (state.sourceSnapshotVersion as string | null) ?? null,
    factsCount: facts.length,
    messagesCount: messages.length,
  };
}

// 从 DB 行（snake_case）+ state JSON 提取同构指纹
function fingerprintFromDb(row: { id: string; case_id: string; stage: string; status: string; state: Record<string, unknown> }): Fingerprint {
  const state = row.state ?? {};
  const facts = (state.facts as unknown[] | undefined) ?? [];
  const messages = (state.messages as unknown[] | undefined) ?? [];
  return {
    sessionId: row.id,
    caseId: row.case_id,
    stage: row.stage,
    status: row.status,
    stateVersion: Number(state.stateVersion ?? 0),
    sourceSnapshotVersion: (state.sourceSnapshotVersion as string | null) ?? null,
    factsCount: facts.length,
    messagesCount: messages.length,
  };
}

function turnBody(sessionId: string, type: string, data: unknown): string {
  return JSON.stringify({ sessionId, clientEventId: randomUUID(), event: { type, data } });
}

// 受控读取登录凭据：仅 --cred-file（0600 JSON）或环境变量，fail-closed，绝不来自命令行明文
function loadCredentials(argv: string[]): { email: string; password: string } {
  const credFileIdx = argv.indexOf('--cred-file');
  if (credFileIdx >= 0 && argv[credFileIdx + 1]) {
    const raw = JSON.parse(readFileSync(argv[credFileIdx + 1], 'utf8')) as { email?: string; password?: string };
    if (!raw.email || !raw.password) throw new Error('凭据文件缺少 email/password');
    return { email: raw.email, password: raw.password };
  }
  if (process.env.PERSIST_PROBE_EMAIL && process.env.PERSIST_PROBE_PWD) {
    return { email: process.env.PERSIST_PROBE_EMAIL, password: process.env.PERSIST_PROBE_PWD };
  }
  throw new Error('缺少凭据：请用 --cred-file <0600 JSON {email,password}> 或 PERSIST_PROBE_EMAIL/PERSIST_PROBE_PWD 环境变量（凭据不得出现在命令文本中）');
}

interface AuthTokens { access_token: string; refresh_token: string }

async function login(email: string, password: string): Promise<AuthTokens> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as AuthTokens & { error_code?: string; msg?: string };
  if (!resp.ok || !body.access_token || !body.refresh_token) throw new Error(`login 失败: ${body.error_code ?? resp.status}`);
  return { access_token: body.access_token, refresh_token: body.refresh_token };
}

async function signOutGlobal(tokens: AuthTokens): Promise<boolean> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.access_token}` },
  });
  return resp.ok;
}

// 0600 凭据文件写入（token 仅落受保护临时文件，不进命令行/console）
function writeAuthFile(tokens: AuthTokens): string {
  const authFile = `/tmp/.persist-probe-auth-${randomUUID()}.json`;
  writeFileSync(authFile, JSON.stringify(tokens), { mode: 0o600 });
  chmodSync(authFile, 0o600);
  return authFile;
}

async function main(): Promise<void> {
  // ===== 阶段 2：独立进程直连 DB 恢复（模拟重启后无内存状态的新进程） =====
  if (process.argv[2] === '--restore') {
    const authFile = process.argv[3];
    const sessionId = process.argv[4];
    const expected = process.argv[5] ? (JSON.parse(process.argv[5]) as Fingerprint) : undefined;
    if (!authFile || !sessionId || !expected) throw new Error('--restore 需要 <authFile> <sessionId> <fingerprintJson>（均为非秘密定位符）');
    if (!existsSync(authFile)) throw new Error('凭据文件不存在');
    const tokens = JSON.parse(readFileSync(authFile, 'utf8')) as AuthTokens;
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
      global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${tokens.access_token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.from('training_sessions').select('id,case_id,stage,status,state').eq('id', sessionId).maybeSingle();
    if (error || !data) {
      console.error(`restore FAIL: ${error?.message ?? 'SESSION_NOT_FOUND'}`);
      process.exitCode = 1;
      return;
    }
    const restored = fingerprintFromDb(data as { id: string; case_id: string; stage: string; status: string; state: Record<string, unknown> });
    const same = restored.caseId === expected.caseId
      && restored.stage === expected.stage
      && restored.status === expected.status
      && restored.stateVersion === expected.stateVersion
      && restored.sourceSnapshotVersion === expected.sourceSnapshotVersion
      && restored.factsCount === expected.factsCount
      && restored.messagesCount === expected.messagesCount;
    // 收尾：撤销本次 refresh 会话 + 删除凭据文件（业务证据已在上方输出，不随凭据销毁）
    const revoked = await signOutGlobal(tokens);
    let cleaned = false;
    try { unlinkSync(authFile); cleaned = true; } catch { /* 尽力清理 */ }
    console.log(JSON.stringify({ phase: 'restore(独立进程·无内存状态)', restored, expected, verdict: same ? 'PERSISTENCE_PASS' : 'PERSISTENCE_FAIL', signOutGlobal: revoked, authFileCleaned: cleaned }, null, 1));
    if (!same) process.exitCode = 1;
    return;
  }

  // ===== 阶段 1：经 dev server HTTP 训练并记录指纹（凭据经受控通道，输出零凭据） =====
  const creds = loadCredentials(process.argv);
  const tokens = await login(creds.email, creds.password);
  const token = tokens.access_token;

  const created = await api<Record<string, unknown>>('/api/sessions', {
    method: 'POST', token, body: JSON.stringify({ mode: 'guided', caseId: 'teacher-川崎病' }),
  });
  if (created.status !== 201 || !created.body.data) throw new Error(`创建会话失败: ${created.status} ${created.body.error?.code ?? ''}`);
  const sessionId = String((created.body.data as Record<string, unknown>).id);

  // 两个回合：问诊 + 查体（改变 stage/facts/messages，确保 state 非初始形态、指纹有区分度）
  await api('/api/agent/turn', { method: 'POST', token, body: turnBody(sessionId, 'ASK_QUESTION', { text: '孩子发热几天了？有没有皮疹？' }) });
  await api('/api/agent/turn', { method: 'POST', token, body: turnBody(sessionId, 'EXAM_ACTION', { toolId: 'hand-hygiene', bodyPartId: 'hands' }) });

  const latest = await api<Record<string, unknown>>(`/api/sessions/${sessionId}`, { token });
  if (latest.status !== 200 || !latest.body.data) throw new Error(`读回会话失败: ${latest.status} ${latest.body.error?.code ?? ''}`);
  const fp = fingerprintFromApi(latest.body.data);
  if (fp.messagesCount === 0) throw new Error('回合未生效，指纹无区分度');

  // token 写入 0600 临时文件；阶段 2 命令只含非秘密定位符（文件路径/sessionId/脱敏指纹）
  const authFile = writeAuthFile(tokens);
  console.log(`phase1(经HTTP) 训练完成: ${JSON.stringify(fp)}`);
  console.log(`authFile(0600): ${authFile}`);
  console.log(`next: pnpm tsx scripts/verify-restart-persistence.ts --restore ${authFile} ${sessionId} '${JSON.stringify(fp).replace(/'/g, "'\\''")}'`);
  console.log('注：阶段 2 结束将自动 signOut(global) 撤销本次 refresh 会话并删除凭据文件');
}

void main().catch((e: unknown) => { console.error((e as Error).message); process.exitCode = 1; });
