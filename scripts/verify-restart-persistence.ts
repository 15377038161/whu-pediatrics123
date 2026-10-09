/* eslint-disable no-console */
/**
 * 重启持久化验证（两阶段、两独立进程，等价于服务重启后的 DB 恢复路径）：
 * 背景：当前 dev 服务为 next dev（常驻进程），平台禁止手动重启；服务端本就无内存会话状态
 * （AgentRepository 全部读写走真实 DB），因此"重启后可恢复"等价于"全新进程不带任何内存
 * 状态，仅凭学生 JWT + DB 即可完整恢复会话"。验证方式：
 * - 阶段 1（默认，经 dev server HTTP）：真实学生 signup -> 建会话 -> 若干回合（问诊+查体，
 *   使 state 非初始形态）-> 记录会话指纹（caseId/stage/status/stateVersion/facts数/来源版本）；
 * - 阶段 2（--restore，独立 tsx 进程直连 DB，不经 dev server）：同一学生 JWT 从
 *   training_sessions 读回 state，逐字段比对指纹，证明跨进程可恢复。
 * 运行：
 *   pnpm tsx scripts/verify-restart-persistence.ts
 *   pnpm tsx scripts/verify-restart-persistence.ts --restore <token> <sessionId> <fingerprintJson>
 */
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
  return JSON.stringify({ sessionId, clientEventId: crypto.randomUUID(), event: { type, data } });
}

async function main(): Promise<void> {
  // ===== 阶段 2：独立进程直连 DB 恢复（模拟重启后无内存状态的新进程） =====
  if (process.argv[2] === '--restore') {
    const token = process.argv[3];
    const sessionId = process.argv[4];
    const expected = JSON.parse(process.argv[5]) as Fingerprint;
    if (!token || !sessionId || !expected) throw new Error('--restore 需要 <token> <sessionId> <fingerprintJson>');
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(SUPA_URL, SUPA_ANON_KEY, {
      global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
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
    console.log(JSON.stringify({ phase: 'restore(独立进程·无内存状态)', restored, expected, verdict: same ? 'PERSISTENCE_PASS' : 'PERSISTENCE_FAIL' }, null, 1));
    if (!same) process.exitCode = 1;
    return;
  }

  // ===== 阶段 1：经 dev server HTTP 训练并记录指纹 =====
  const stamp = Date.now();
  const signupResp = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `persist-probe-${stamp}@luojia.dev`, password: `Persist-${stamp}-Aa1!` }),
  });
  const auth = (await signupResp.json()) as { access_token: string };
  if (!auth.access_token) throw new Error('signup 失败');
  const token = auth.access_token;

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
  console.log(`phase1(经HTTP) 训练完成: ${JSON.stringify(fp)}`);
  // 输出阶段 2 命令（在新的 shell/进程执行 = 模拟服务重启后另一进程从 DB 恢复）
  const safe = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
  console.log(`next: pnpm tsx scripts/verify-restart-persistence.ts --restore ${safe(token)} ${safe(sessionId)} ${safe(JSON.stringify(fp))}`);
}

void main().catch((e: unknown) => { console.error((e as Error).message); process.exitCode = 1; });
