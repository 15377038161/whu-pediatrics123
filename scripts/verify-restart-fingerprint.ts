/* eslint-disable no-console */
/**
 * 真实沙箱重启持久化验收——阶段 1（重启前指纹记录）：
 * - 复用既有 probe+演示双合法学生身份（0600 受控凭据，仅 login 不 signup）；
 * - 查询各自最新测试会话（verify-dual 期间创建），读取指纹：
 *   sessionId/caseId/sourceSnapshotVersion/stateVersion/stage/status/messagesCount/
 *   unlockedEvidence 计数/orderedTests 计数/reportId；
 * - A 会话做一次合法 EXAM_ACTION（确认查体解锁证据留存——最小正常操作，
 *   不开单（orderedTests 死锁冻结）、不伪造开单）；
 * - 输出仅结构指纹与计数，不输出消息正文/患者内容/凭据；
 * - 指纹写入 /tmp/restart-fingerprint.json 供重启后比对（不含正文）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.RESTART_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const PROBE_FILE = process.env.RESTART_A_CRED_FILE ?? '/workspace/.demo-secrets/probe-account-credentials-deprecated.txt';
const DEMO_FILE = process.env.RESTART_B_CRED_FILE ?? '/workspace/.demo-secrets/demo-student-credentials.txt';
const OUT_FILE = process.env.RESTART_FP_FILE ?? '/tmp/restart-fingerprint.json';
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

function readCreds(path: string): { email: string; password: string } {
  const map: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = /^(email|password)\s*[:=]\s*(.+)$/i.exec(line.trim());
    if (m) map[m[1].toLowerCase()] = m[2].trim();
  }
  if (!map.email || !map.password) throw new Error(`凭据文件 ${path} 缺少 email/password`);
  return { email: map.email, password: map.password };
}

async function login(email: string, password: string): Promise<string | null> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) return null;
  const body = (await resp.json()) as { access_token?: string };
  return body.access_token ?? null;
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

interface Fp {
  sessionId: string; caseId: string; stage: string; status: string;
  stateVersion: number; sourceSnapshotVersion: string | null;
  messagesCount: number; unlockedEvidence: number; orderedTests: number; reportId: string | null;
}
function fpOf(s: Record<string, unknown>): Fp {
  const state = (s.state as Record<string, unknown> | undefined) ?? {};
  const messages = (state.messages as unknown[] | undefined) ?? (s.messages as unknown[] | undefined) ?? [];
  const ev = (state.unlockedEvidence as unknown[] | undefined) ?? (s.unlockedEvidence as unknown[] | undefined) ?? [];
  const ot = (state.orderedTests as unknown[] | undefined) ?? (s.orderedTests as unknown[] | undefined) ?? [];
  return {
    sessionId: String(s.id ?? ''),
    caseId: String(s.caseId ?? ''),
    stage: String(s.stage ?? state.stage ?? ''),
    status: String(s.status ?? state.status ?? ''),
    stateVersion: Number(s.stateVersion ?? state.stateVersion ?? 0),
    sourceSnapshotVersion: (s.sourceSnapshotVersion as string | null) ?? (state.sourceSnapshotVersion as string | null) ?? null,
    messagesCount: messages.length,
    unlockedEvidence: ev.length,
    orderedTests: ot.length,
    reportId: (s.reportId as string | null) ?? (state.reportId as string | null) ?? null,
  };
}

async function main(): Promise<void> {
  const phase = process.argv[2] ?? 'before';
  const aToken = await login(readCreds(PROBE_FILE).email, readCreds(PROBE_FILE).password);
  const bToken = await login(readCreds(DEMO_FILE).email, readCreds(DEMO_FILE).password);
  if (!aToken || !bToken) throw new Error(`双身份登录失败（A=${aToken !== null} B=${bToken !== null}）——不找替代身份`);
  console.log('PASS  双身份登录成功（仅 login）');

  // 各取最新本人会话（不猜 sessionId：经 reports 列表无法取 active 会话，改用 sessions 列表）
  const listA = await api<Array<Record<string, unknown>>>('/api/sessions', { token: aToken });
  if (listA.status !== 200) throw new Error(`A 会话列表失败 ${listA.status}`);
  const aSessions = (listA.body.data ?? []).map((s) => fpOf(s));
  const listB = await api<Array<Record<string, unknown>>>('/api/sessions', { token: bToken });
  if (listB.status !== 200) throw new Error(`B 会话列表失败 ${listB.status}`);
  const bSessions = (listB.body.data ?? []).map((s) => fpOf(s));
  console.log(`NOTE  A 会话 ${aSessions.length} 个 / B 会话 ${bSessions.length} 个`);
  if (aSessions.length === 0 || bSessions.length === 0) throw new Error('无既有测试会话可复用');

  // 选 A 最新会话；若全部 unlockedEvidence=0 则做一次合法查体动作（最小正常操作）
  let aTarget = aSessions[0];
  if (phase === 'before' && aTarget.unlockedEvidence === 0) {
    // 从会话详情取查体目录（exam 列表经 prep 后投影，查体目录含 id）
    const detail = await api<Record<string, unknown>>(`/api/sessions/${aTarget.sessionId}`, { token: aToken });
    const state = (detail.body.data?.state as Record<string, unknown> | undefined) ?? {};
    const caseOptions = (state.caseOptions ?? (detail.body.data as Record<string, unknown>)?.caseOptions) as { exams?: Array<{ id?: string }> } | undefined;
    const firstExam = caseOptions?.exams?.[0];
    if (!firstExam?.id) {
      // 查体目录需先经 prep：做一次 EXAM prep 动作（引擎既有的准备步骤）
      const prep = await api('/api/agent/turn', {
        method: 'POST', token: aToken,
        body: JSON.stringify({ sessionId: aTarget.sessionId, clientEventId: `verify-restart-prep-${Date.now()}`, event: { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } } }),
      });
      console.log(`NOTE  A 查体动作（stethoscope/chest）status=${prep.status} code=${prep.body.error?.code ?? 'ok'}`);
      const reDetail = await api<Record<string, unknown>>(`/api/sessions/${aTarget.sessionId}`, { token: aToken });
      aTarget = fpOf((reDetail.body.data ?? {}) as Record<string, unknown>);
    } else {
      const turn = await api('/api/agent/turn', {
        method: 'POST', token: aToken,
        body: JSON.stringify({ sessionId: aTarget.sessionId, clientEventId: `verify-restart-exam-${Date.now()}`, event: { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } } }),
      });
      console.log(`NOTE  A 查体动作 status=${turn.status} code=${turn.body.error?.code ?? 'ok'}`);
      const reDetail = await api<Record<string, unknown>>(`/api/sessions/${aTarget.sessionId}`, { token: aToken });
      aTarget = fpOf((reDetail.body.data ?? {}) as Record<string, unknown>);
    }
  } else if (phase === 'before') {
    const reDetail = await api<Record<string, unknown>>(`/api/sessions/${aTarget.sessionId}`, { token: aToken });
    aTarget = fpOf((reDetail.body.data ?? {}) as Record<string, unknown>);
  }
  const bTarget = bSessions[0];

  console.log(`A 指纹: ${JSON.stringify(aTarget)}`);
  console.log(`B 指纹: ${JSON.stringify(bTarget)}`);

  if (phase === 'before') {
    writeFileSync(OUT_FILE, JSON.stringify({ a: aTarget, b: bTarget }, null, 2), { mode: 0o600 });
    console.log(`PASS  指纹已写入 ${OUT_FILE}（仅结构指纹，无正文）`);
    check('A 会话有查体解锁证据（unlockedEvidence>0）或本轮已做合法查体', aTarget.unlockedEvidence > 0, `unlocked=${aTarget.unlockedEvidence}`);
  } else {
    // after：与 before 比对（除 stateVersion/messagesCount 可能因 before 阶段动作外，其余须一致）
    const before = JSON.parse(readFileSync(OUT_FILE, 'utf-8')) as { a: Fp; b: Fp };
    check('A：sessionId/caseId/版本/状态保持', before.a.sessionId === aTarget.sessionId && before.a.caseId === aTarget.caseId && before.a.sourceSnapshotVersion === aTarget.sourceSnapshotVersion && before.a.status === aTarget.status, `before.ver=${before.a.sourceSnapshotVersion} after.ver=${aTarget.sourceSnapshotVersion}`);
    check('A：已解锁查体证据保持（不丢失）', before.a.unlockedEvidence > 0 && aTarget.unlockedEvidence >= before.a.unlockedEvidence, `${before.a.unlockedEvidence} → ${aTarget.unlockedEvidence}`);
    check('A：orderedTests 仍为 0（未开单，死锁冻结不推进）', aTarget.orderedTests === 0, `ordered=${aTarget.orderedTests}`);
    check('B：sessionId/版本/状态保持', before.b.sessionId === bTarget.sessionId && before.b.sourceSnapshotVersion === bTarget.sourceSnapshotVersion && before.b.status === bTarget.status);
    // 重启后双账号互读拒绝复抽
    const aReadB = await api(`/api/sessions/${bTarget.sessionId}`, { token: aToken });
    check('重启后 A 读 B 会话仍拒绝（403/404）', aReadB.status === 403 || aReadB.status === 404, `status=${aReadB.status}`);
    const bReadA = await api(`/api/sessions/${aTarget.sessionId}`, { token: bToken });
    check('重启后 B 读 A 会话仍拒绝（403/404）', bReadA.status === 403 || bReadA.status === 404, `status=${bReadA.status}`);
  }

  await signOutGlobal(aToken);
  await signOutGlobal(bToken);
  console.log('PASS  双端登出');
  console.log(`\n==== 重启指纹（${phase}）：${passed.length} 通过 / ${failed.length} 失败 ====`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

const passed: string[] = [];
const failed: string[] = [];
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed.push(name); console.log(`PASS  ${name}`); }
  else { failed.push(name); console.log(`FAIL  ${name}${detail ? ` (${detail})` : ''}`); }
}

void main().catch((e: unknown) => { console.error('FATAL', (e as Error).message); process.exitCode = 1; });
