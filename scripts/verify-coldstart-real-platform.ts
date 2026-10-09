/* eslint-disable no-console */
/**
 * 冷启动恢复验证（阶段 B：真实平台，仅现有合法学生演示身份）。
 *
 * 与阶段 A（scripts/verify-coldstart-restore.ts 合成 HTTP 上游）分开标注：
 * - 本脚本全部流量发往真实平台：dev server（127.0.0.1:$DEPLOY_RUN_PORT）与
 *   平台 Supabase（CODER_SUPABASE_* 环境变量注入）；
 * - 仅使用既有学生演示账号（/tmp/demo-student-credentials.txt，评委演示账号，
 *   最小权限学生端），不创建账号、不伪造 JWT、不提权、不放宽 RLS；
 * - 不输出病例内容与凭据：仅结构性指纹（版本指纹、计数、布尔）；
 * - 结束后 signOut(global) 撤销本次 refresh 会话。
 *
 * 验证点（真实平台冷启动语义）：
 * 1) 学生建会话（guided，教师病例）：dev 环境本地 teaching-cases 缺失 →
 *    版本应绑定 DB 已装载版本（sourceSnapshotVersion 为 16 位指纹），不漂移；
 * 2) 会话读回（重启等价：每次 GET 经 repository.getSession → restoreCaseSnapshotFacts
 *    受控 RPC 恢复）指纹稳定：两次读回 sourceSnapshotVersion/facts/messages 计数一致；
 * 3) 受控 RPC 会话归属校验（真实 SQL）：p_session_id 非本人会话 → 返回 null；
 * 4) RLS（真实 SQL）：学生直读 case_snapshot_facts → 被拒/空。
 *
 * 运行：pnpm tsx scripts/verify-coldstart-real-platform.ts
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

const CASE_ID = 'teacher-川崎病'; // 与 verify-restart-persistence 同病例（已验证在真实平台可建会话）

/** 受控读取既有学生演示凭据（key: value 文本行），凭据不进命令行/输出。 */
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
  const body = (await resp.json()) as AuthTokens & { error_code?: string; msg?: string };
  if (!resp.ok || !body.access_token || !body.refresh_token) throw new Error(`登录失败: ${body.error_code ?? resp.status}`);
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

/** 会话结构指纹（不含任何病例内容）。 */
interface Fingerprint {
  sessionId: string;
  caseId: string;
  stage: string;
  status: string;
  stateVersion: number;
  sourceSnapshotVersion: string | null;
  /** 教学事实可用性（SessionState 无 facts 数组：事实以 caseOptions/vitals 形态呈现） */
  hasSource: boolean | null;
  vitalsSet: number;
  messagesCount: number;
}

function fingerprintFromApi(session: Record<string, unknown>): Fingerprint {
  const state = (session.state as Record<string, unknown> | undefined) ?? {};
  const messages = (state.messages as unknown[] | undefined) ?? (session.messages as unknown[] | undefined) ?? [];
  const caseOptions = (state.caseOptions ?? session.caseOptions) as { hasSource?: boolean } | undefined | null;
  const vitals = (state.vitals ?? session.vitals) as Record<string, unknown> | undefined | null;
  const vitalsSet = vitals ? Object.values(vitals).filter((v) => v !== null && v !== undefined).length : 0;
  return {
    sessionId: String(session.id ?? ''),
    caseId: String(session.caseId ?? ''),
    stage: String(session.stage ?? state.stage ?? ''),
    status: String(session.status ?? state.status ?? ''),
    stateVersion: Number(session.stateVersion ?? state.stateVersion ?? 0),
    sourceSnapshotVersion: (session.sourceSnapshotVersion as string | null) ?? (state.sourceSnapshotVersion as string | null) ?? null,
    hasSource: caseOptions?.hasSource ?? null,
    vitalsSet,
    messagesCount: messages.length,
  };
}

function sameFingerprint(a: Fingerprint, b: Fingerprint): boolean {
  return a.caseId === b.caseId && a.stage === b.stage && a.status === b.status
    && a.stateVersion === b.stateVersion && a.sourceSnapshotVersion === b.sourceSnapshotVersion
    && a.hasSource === b.hasSource && a.vitalsSet === b.vitalsSet
    && a.messagesCount === b.messagesCount;
}

interface Check { name: string; pass: boolean }
const checks: Check[] = [];
function check(name: string, pass: boolean): void {
  checks.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
}

async function main(): Promise<void> {
  const creds = loadCredentials();
  const tokens = await login(creds.email, creds.password);
  const token = tokens.access_token;
  check('真实平台：学生演示身份登录成功', true);

  // 1) 建会话（guided）：dev 环境本地 teaching-cases 缺失 → 冷启动绑定 DB 已装载版本
  const created = await api<Record<string, unknown>>('/api/sessions', {
    method: 'POST', token, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }),
  });
  if (created.status !== 201 || !created.body.data) throw new Error(`创建会话失败: ${created.status} ${created.body.error?.code ?? ''}`);
  const createdFp = fingerprintFromApi(created.body.data as Record<string, unknown>);
  console.log(`会话指纹: ${JSON.stringify(createdFp)}`);
  check('冷启动建会话：绑定 DB 版本指纹（16 位 hex）', /^[0-9a-f]{16}$/.test(createdFp.sourceSnapshotVersion ?? ''));
  check('冷启动建会话：开场消息就绪（messagesCount≥2）', createdFp.messagesCount >= 2);

  // 2) 两次读回（每次经 repository.getSession → 受控 RPC 恢复）指纹稳定
  const read1 = await api<Record<string, unknown>>(`/api/sessions/${createdFp.sessionId}`, { token });
  if (read1.status !== 200 || !read1.body.data) throw new Error(`读回会话失败: ${read1.status}`);
  const fp1 = fingerprintFromApi(read1.body.data as Record<string, unknown>);
  const read2 = await api<Record<string, unknown>>(`/api/sessions/${createdFp.sessionId}`, { token });
  const fp2 = fingerprintFromApi((read2.body.data ?? {}) as Record<string, unknown>);
  check('冷启动恢复：读回版本绑定不变（sourceSnapshotVersion 稳定）', fp1.sourceSnapshotVersion === createdFp.sourceSnapshotVersion && fp2.sourceSnapshotVersion === createdFp.sourceSnapshotVersion);
  check('冷启动恢复：两次读回指纹一致（hasSource/vitals/messages 稳定）', sameFingerprint(fp1, fp2));
  check('冷启动恢复：恢复后教学事实可用（caseOptions.hasSource=true）', fp1.hasSource === true);
  check('冷启动恢复：恢复后生命体征可用（vitals 至少 1 项非空）', fp1.vitalsSet >= 1);

  // 3) 受控 RPC 会话归属校验（真实 SQL）：p_session_id 非本人/不存在 → null
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // 3a) 本人会话直探 RPC（诊断：区分 RPC 层失败与应用层恢复失败；仅结构性结果）
  //     注意 RPC 返回 jsonb 即 facts 载荷本身（return v_facts），无 {facts} 包装
  const { data: rpcOwn, error: rpcOwnError } = await db.rpc('case_snapshot_get_facts', {
    p_case_id: CASE_ID, p_version: createdFp.sourceSnapshotVersion ?? '', p_session_id: createdFp.sessionId,
  });
  const rpcOwnFacts = (rpcOwn ?? null) as Record<string, unknown> | null;
  const rpcPayload = rpcOwnFacts && typeof rpcOwnFacts.caseId === 'string' ? rpcOwnFacts : null;
  console.log(`RPC本人会话直探: error=${rpcOwnError ? rpcOwnError.message : 'none'} rpcData=${rpcOwnFacts === null ? 'null' : typeof rpcOwnFacts} hasPayload=${Boolean(rpcPayload)} hasAgeField=${Boolean(rpcPayload?.age)}`);
  check('RPC本人会话直探：返回 facts 载荷', Boolean(rpcPayload && rpcPayload.age));
  const { data: rpcForeign } = await db.rpc('case_snapshot_get_facts', {
    p_case_id: CASE_ID, p_version: createdFp.sourceSnapshotVersion ?? '', p_session_id: randomUUID(),
  });
  check('RPC 会话归属校验：非本人会话返回 null', rpcForeign === null || rpcForeign === undefined);

  // 4) RLS：学生直读 case_snapshot_facts → 被拒/空
  const { data: direct, error: directError } = await db.from('case_snapshot_facts').select('case_id,version').limit(1);
  check('RLS：学生直读 case_snapshot_facts 被拒/空', Boolean(directError) || (direct ?? []).length === 0);

  // 收尾：撤销 refresh 会话
  const revoked = await signOutGlobal(tokens);
  check('收尾：signOut(global) 撤销本次会话', revoked);

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n==== 真实平台冷启动恢复验证（学生演示身份）：${checks.length - failed}/${checks.length} 通过 ====`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main().catch((e: unknown) => {
  console.error('真实平台验证异常：', (e as Error).message);
  process.exitCode = 1;
});
