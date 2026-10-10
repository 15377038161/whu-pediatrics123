/* 辅助检查 RPC 安全探针（对当前实现取证，只输出状态与计数，零患者内容输出）：
 * 场景（全部以既有学生身份、本人会话合法操作 + 攻击面最小探测）：
 *  P1 未下单直调 get_test（首项）        → 期望拒绝；当前实现返回结果 = 缺陷
 *  P2 合法首单后 get_test（首项）        → 期望允许（仅首项）
 *  P3 首单后直调 get_test（第二项，未下单）→ 期望拒绝；当前实现返回结果 = 缺陷
 *  P4 首单后 get_facts 的 tests 段行数    → 期望=已下单数(1)；当前返回全部行 = 缺陷
 *  P5 跨学生调用 get_test/list_tests       → 期望拒绝
 *  P6 错误 case_id / 错误 version 调用     → 期望拒绝
 *  P7 完成后（finish）再 ORDER_TEST        → 期望拒绝
 * 运行：pnpm exec tsx scripts/verify-tests-rpc-security.ts
 * 退出码保留真实结果（0=全部符合期望，1=存在缺陷/失败项）。
 */
export {};
import { readFileSync } from 'node:fs';

const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const baseUrl = `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('仅允许本地 dev server 地址');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

const CASE_ID = 'teacher-川崎病';
const OTHER_CASE_ID = 'teacher-肾病综合征';
const DEMO_FILE = '/workspace/.demo-secrets/demo-student-credentials.txt';
const PROBE_FILE = '/workspace/.demo-secrets/probe-account-credentials-deprecated.txt';

function loadCredentials(file: string): { email: string; password: string } {
  const raw = readFileSync(file, 'utf8');
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([a-zA-Z_]+)\s*[:=]\s*(.+?)\s*$/);
    if (match) map.set(match[1].toLowerCase(), match[2]);
  }
  const email = map.get('email'); const password = map.get('password');
  if (!email || !password) throw new Error(`凭据文件 ${file} 缺少 email/password`);
  return { email, password };
}

interface AuthTokens { access_token: string }
async function login({ email, password }: { email: string; password: string }): Promise<AuthTokens> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as AuthTokens & { error_code?: string };
  if (!resp.ok || !body.access_token) throw new Error(`登录失败: ${body.error_code ?? resp.status}`);
  return body;
}

interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code: string; message: string } }
async function api<T>(path: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${baseUrl}${path}`, { ...init, headers });
  let body: ApiEnvelope<T> | null = null;
  try { body = (await resp.json()) as ApiEnvelope<T>; } catch { body = null; }
  return { status: resp.status, body: body ?? { ok: false } };
}

interface SessionShape { id: string; sourceSnapshotVersion?: string; orderedTests?: string[]; status?: string }

async function turn(token: string, sessionId: string, event: Record<string, unknown>): Promise<{ status: number; code?: string; data?: SessionShape }> {
  const r = await api<{ session: SessionShape }>('/api/agent/turn', {
    method: 'POST', token,
    body: JSON.stringify({ sessionId, clientEventId: `sec-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, event }),
  });
  return { status: r.status, code: r.body.error?.code, data: r.body.data?.session };
}

async function rpc<T>(fn: string, token: string, args: Record<string, string>): Promise<{ status: number; data: T | null }> {
  const resp = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!resp.ok) return { status: resp.status, data: null };
  return { status: resp.status, data: (await resp.json()) as T };
}

let pass = 0; let fail = 0; let defect = 0;
function expectReject(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { defect += 1; console.log(`DEFECT ${name}${detail ? ` (${detail})` : ''}`); }
}
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}

async function main(): Promise<void> {
  const token = (await login(loadCredentials(DEMO_FILE))).access_token;
  const attackerToken = (await login(loadCredentials(PROBE_FILE))).access_token;
  console.log(`目标服务: ${baseUrl} / 病例: ${CASE_ID}`);

  // 会话建立 + 推进到检查阶段（本人合法操作）
  const created = await api<SessionShape>('/api/sessions', { method: 'POST', token, body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }) });
  const sessionId = created.body.data?.id;
  const version = created.body.data?.sourceSnapshotVersion ?? '';
  if (created.status !== 201 || !sessionId || !version) throw new Error(`会话建立失败 status=${created.status}`);
  await turn(token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } });
  await turn(token, sessionId, { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest' } });
  const navTests = await turn(token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage: 'tests' } });
  check('前置：推进到检查阶段成功', navTests.status === 200, `status=${navTests.status}`);

  // 目录：计数与稳定 ID（不输出 label 内容）
  const catalog = await rpc<Array<{ id: string }>>('case_snapshot_list_tests', token, { p_case_id: CASE_ID, p_version: version, p_session_id: sessionId });
  const catalogCount = catalog.data?.length ?? 0;
  check('目录非空且 ID 稳定（source-test-N）', catalog.status === 200 && catalogCount >= 2 && (catalog.data ?? []).every((t) => /^source-test-\d+$/.test(t.id)), `count=${catalogCount}`);
  if (catalogCount < 2) throw new Error('目录不足 2 项，无法执行首项/第二项探针');

  // P8 label 白名单断言：label 要么「检查记录 N」要么在 TRUSTED_TEST_NAMES（与 SQL 白名单同步校验），
  // 且不含数值与阳性结论关键词——冒号前缀不保证无答案（数值/结论前缀泄露面）
  const { TRUSTED_TEST_NAMES } = await import('../src/domain/case');
  const trusted = new Set<string>(TRUSTED_TEST_NAMES);
  const labels = (catalog.data ?? []).map((t) => (t as { label?: unknown }).label).filter((l): l is string => typeof l === 'string');
  const allTrusted = labels.every((l) => /^检查记录 \d+$/.test(l) || trusted.has(l));
  const noLeak = labels.every((l) => /^检查记录 \d+$/.test(l) || !/(升高|降低|正常|异常|阳性|阴性|提示|可见|考虑|\d)/.test(l));
  check('P8 目录 label 全部为白名单名或「检查记录 N」（SQL/TS 白名单同步）', allTrusted, `labels=${labels.length} untrusted=${labels.filter((l) => !(/^检查记录 \d+$/.test(l) || trusted.has(l))).length}`);
  check('P8 目录 label 不含数值与阳性结论关键词', noLeak);

  // P1 未下单直调 get_test（首项）→ 期望拒绝
  const p1 = await rpc<{ result?: string }>('case_snapshot_get_test', token, { p_case_id: CASE_ID, p_version: version, p_session_id: sessionId, p_test_id: 'source-test-0' });
  expectReject('P1 未下单直调 get_test 被拒', p1.data === null, `status=${p1.status} returned=${p1.data ? 'result' : 'null'}`);

  // P2 合法首单 → get_test 首项允许（仅首项）
  const order = await turn(token, sessionId, { type: 'ORDER_TEST', data: { testId: 'source-test-0' } });
  const orderedList = order.data?.orderedTests ?? [];
  check('P2a 合法首单成功', order.status === 200 && orderedList.includes('source-test-0'), `status=${order.status} ordered=${orderedList.length}`);
  const p2 = await rpc<{ id?: string; result?: string }>('case_snapshot_get_test', token, { p_case_id: CASE_ID, p_version: version, p_session_id: sessionId, p_test_id: 'source-test-0' });
  check('P2b 已下单项 get_test 允许（仅首项）', p2.status === 200 && Boolean(p2.data?.result) && p2.data?.id === 'source-test-0', `status=${p2.status}`);

  // P3 第二项未下单直调 get_test → 期望拒绝
  const p3 = await rpc<{ result?: string }>('case_snapshot_get_test', token, { p_case_id: CASE_ID, p_version: version, p_session_id: sessionId, p_test_id: 'source-test-1' });
  expectReject('P3 未下单第二项 get_test 被拒', p3.data === null, `status=${p3.status} returned=${p3.data ? 'result' : 'null'}`);

  // P4 首单后 get_facts 的 tests 段行数 vs 已下单数（1）→ 期望不大于已下单数
  // （修复后训练中 get_facts 一律剥离 tests 段，行数=0；目录走 list_tests、结果走 get_test 行级）
  const facts = await rpc<{ sections?: Record<string, string> }>('case_snapshot_get_facts', token, { p_case_id: CASE_ID, p_version: version, p_session_id: sessionId });
  const testsText = facts.data?.sections?.tests ?? '';
  const testsRows = testsText.split('\n').map((l) => l.trim()).filter((l) => l && !/^(辅助检查|辅检|入院后辅检)[：:]$/.test(l)).length;
  expectReject('P4 get_facts tests 段不泄露未下单项目（行数≤已下单数）', facts.status === 200 && testsRows <= orderedList.length, `rows=${testsRows} ordered=${orderedList.length}`);

  // P5 跨学生（攻击者 token 对本人会话）
  const p5a = await rpc('case_snapshot_get_test', attackerToken, { p_case_id: CASE_ID, p_version: version, p_session_id: sessionId, p_test_id: 'source-test-0' });
  expectReject('P5a 跨学生 get_test 被拒', p5a.data === null, `status=${p5a.status}`);
  const p5b = await rpc('case_snapshot_list_tests', attackerToken, { p_case_id: CASE_ID, p_version: version, p_session_id: sessionId });
  expectReject('P5b 跨学生 list_tests 被拒', p5b.data === null, `status=${p5b.status}`);

  // P6 错误 case / 错误 version
  const p6a = await rpc('case_snapshot_get_test', token, { p_case_id: OTHER_CASE_ID, p_version: version, p_session_id: sessionId, p_test_id: 'source-test-0' });
  expectReject('P6a 错误 case_id 被拒', p6a.data === null, `status=${p6a.status}`);
  const p6b = await rpc('case_snapshot_get_test', token, { p_case_id: CASE_ID, p_version: `${version}x`, p_session_id: sessionId, p_test_id: 'source-test-0' });
  expectReject('P6b 错误 version 被拒', p6b.data === null, `status=${p6b.status}`);

  // P7 完成后写入拒绝：诊断→处置→finish→ORDER_TEST
  await turn(token, sessionId, { type: 'SUBMIT_DECISION', data: { diagnosis: '探针诊断', summary: '探针摘要：用于完成后写入拒绝测试的合法本人操作。', differentials: '无' } });
  await turn(token, sessionId, { type: 'SUBMIT_PLAN', data: { priority: '监测', detail: '探针处置：用于完成后写入拒绝测试。' } });
  const finish = await turn(token, sessionId, { type: 'FINISH_SESSION', data: {} });
  check('P7a finish 成功（本人合法操作）', finish.status === 200 || finish.status === 201, `status=${finish.status}`);
  const afterFinish = await turn(token, sessionId, { type: 'ORDER_TEST', data: { testId: 'source-test-1' } });
  expectReject('P7b 完成后再下单被拒', afterFinish.status !== 200, `status=${afterFinish.status} code=${afterFinish.code}`);

  console.log(`\n结果: ${pass} pass / ${fail} fail / ${defect} defect`);
  process.exit(fail > 0 || defect > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
