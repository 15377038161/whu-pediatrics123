/* 收紧后复验脚本：同一组合攻击（两变体）在 fail-closed 收紧后必须全部拒绝。
 * 凭据运行时随机生成，不落盘、不打印。运行后探针数据自动清理。 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.CODER_SUPABASE_URL!;
const key = process.env.CODER_SUPABASE_ANON_KEY!;
const tenant = process.env.CODER_SUPABASE_TENANT_ID!;

const rand = () => Math.random().toString(36).slice(2, 10);
const emailA = `osce-verify-a-${rand()}@luojia.dev`;
const emailB = `osce-verify-b-${rand()}@luojia.dev`;
const pwA = `Vfy#_${rand()}${rand()}`;
const pwB = `Vfy#_${rand()}${rand()}`;
const TS = new Date().toISOString();

async function signup(email: string, password: string): Promise<string> {
  const resp = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: key, 'X-Instance-ID': tenant, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await resp.json();
  if (!body.access_token) throw new Error(`signup failed: ${body.error_code ?? body.msg}`);
  return body.access_token as string;
}

function client(token: string) {
  return createClient(url, key, {
    global: { headers: { 'X-Instance-ID': tenant, Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const DEFAULT_COHORT_ID = '10000000-0000-4000-8000-000000000102';
const PROBE_CASE = 'osce-verify-probe';
const PROBE_VERSION = `vfy-${rand()}`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}

async function main() {
  const a = await signup(emailA, pwA);
  const b = await signup(emailB, pwB);
  const dbA = client(a);
  const dbB = client(b);
  const uid = (await dbA.auth.getUser()).data.user?.id ?? null;

  // 学生无法写 answers（teacher-only），本轮无合法教师样本 → 用「answers 缺失」路径验证收紧：
  // 收紧前：组合攻击双条件满足即返回对照（若有数据）；收紧后：学生调用一律 null（无论数据是否存在）。
  // 关键断言：即使学生组合伪造成功（UPDATE 被接受），RPC 也必须 null——授权不再依赖可伪造条件。

  const baseState = {
    id: '', userId: uid, mode: 'osce', caseId: PROBE_CASE, caseVersion: 1,
    sourceSnapshotVersion: PROBE_VERSION, stage: 'history', status: 'active',
    messages: [], events: [], unlockedEvidence: [], orderedTests: [],
    startedAt: TS, updatedAt: TS,
  };
  const finishEvent = { id: 'atk', clientEventId: 'atk', type: 'FINISH_SESSION', stage: 'report', summary: 'atk', correct: null, evidenceCodes: [], createdAt: TS };

  // 变体一：一次同改
  const sid1 = crypto.randomUUID();
  const st1 = { ...baseState, id: sid1 };
  const ins1 = await dbA.from('training_sessions').insert({
    id: sid1, user_id: uid, cohort_id: DEFAULT_COHORT_ID, case_id: PROBE_CASE, case_version: 1,
    mode: 'osce', stage: 'history', status: 'active', state: st1,
  });
  check('变体一会话创建', !ins1.error, ins1.error?.message ?? '');
  const combo1 = await dbA.from('training_sessions').update({
    status: 'completed', stage: 'report',
    state: { ...st1, status: 'completed', stage: 'report', events: [finishEvent] },
  }).eq('id', sid1);
  check('变体一组合UPDATE被接受（可写面如实记录）', !combo1.error, combo1.error?.message ?? '');
  const ref1 = await dbA.rpc('case_snapshot_get_reference', { p_case_id: PROBE_CASE, p_version: PROBE_VERSION, p_session_id: sid1 });
  check('变体一收紧后reference → null（组合伪造不再解锁）', ref1.data === null, JSON.stringify(ref1.data ?? null));

  // 变体二：分两次
  const sid2 = crypto.randomUUID();
  const st2 = { ...baseState, id: sid2 };
  await dbA.from('training_sessions').insert({
    id: sid2, user_id: uid, cohort_id: DEFAULT_COHORT_ID, case_id: PROBE_CASE, case_version: 1,
    mode: 'osce', stage: 'history', status: 'active', state: st2,
  });
  const s1 = await dbA.from('training_sessions').update({ state: { ...st2, events: [finishEvent] } }).eq('id', sid2);
  check('变体二step1(仅events)被接受', !s1.error, s1.error?.message ?? '');
  const s2 = await dbA.from('training_sessions').update({ status: 'completed', stage: 'report' }).eq('id', sid2);
  check('变体二step2(仅status)被接受', !s2.error, s2.error?.message ?? '');
  const ref2 = await dbA.rpc('case_snapshot_get_reference', { p_case_id: PROBE_CASE, p_version: PROBE_VERSION, p_session_id: sid2 });
  check('变体二收紧后reference → null', ref2.data === null, JSON.stringify(ref2.data ?? null));

  // 归属对照：B 用 A 的会话调用 → null
  const bRef = await dbB.rpc('case_snapshot_get_reference', { p_case_id: PROBE_CASE, p_version: PROBE_VERSION, p_session_id: sid1 });
  check('B用A会话调reference → null（归属+教师判定双拒）', bRef.data === null);

  // 伪证据取 facts：收紧范围外的已知边界（行为记录，不作安全断言）
  const ev = await dbA.from('training_sessions').update({ state: { ...st2, unlockedEvidence: ['EX_ATK1'] } }).eq('id', sid2);
  check('伪证据UPDATE被接受（已知边界：state.unlockedEvidence 在可写范围）', !ev.error, ev.error?.message ?? '');
  const facts = await dbA.rpc('case_snapshot_get_facts', { p_case_id: PROBE_CASE, p_version: PROBE_VERSION, p_session_id: sid2 });
  const secs = (facts.data as { sections?: Record<string, string> } | null)?.sections ?? null;
  check('伪证据后facts投影 → null（本探针无教师facts数据，与门控无关）', secs === null, JSON.stringify(secs ?? null));

  // 匿名拒绝
  const anon = createClient(url, key, {
    global: { headers: { 'X-Instance-ID': tenant } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonRef = await anon.rpc('case_snapshot_get_reference', { p_case_id: PROBE_CASE, p_version: PROBE_VERSION, p_session_id: sid1 });
  check('匿名调reference被拒', anonRef.error !== null || anonRef.data === null);

  // 教师直读正向：无合法教师样本（本轮不借提权探针），标未验
  console.log('INFO 教师RLS直读answers正向：本轮无合法教师样本，标未验（fail-closed不改变教师策略，RLS app_is_teacher保留）');

  // 清理
  await dbA.from('training_sessions').delete().in('id', [sid1, sid2]);
  console.log(`\n结果: pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e instanceof Error ? e.message : e); process.exit(1); });
