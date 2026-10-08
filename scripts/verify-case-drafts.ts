/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 教师病例草稿导入验收（真实 HTTP 栈 + 真实教师/学生 JWT + 真实服务重启）：
 * 1. 教师B（白名单 rls-probe-b@luojia.dev）经 platform-session 落 cookie；
 * 2. 预校验：缺必填字段 → missingFields/issues 如实报告，不自动补造；
 * 3. 保存非患者测试草稿（目录内病例 + 唯一探针版本号）→ saved；
 * 4. 重复导入同一 (case_id, draft_version) → duplicate，不覆盖；
 * 5. 版本递增 v2 修订 → saved，v1 仍在；
 * 6. 学生A / 匿名 访问草稿 API → 403 / 401；
 * 7. Data API 直插/直读草稿表（学生A、匿名）→ RLS 拒绝；
 * 8. 触发 tsx watch 真实重启（PID 变化）→ 教师重新登录后复读草稿（数据库持久化）。
 * 运行：pnpm tsx scripts/verify-case-drafts.ts
 */
import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.RESTART_BASE_URL || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5173}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const PROJECT_ROOT = resolve(process.cwd());

const TEACHER = { email: 'rls-probe-b@luojia.dev', password: 'RlsProbe#2026B' };
const STUDENT_A = { email: 'rls-probe-a@luojia.dev', password: 'RlsProbe#2026A' };

const PROBE_CASE_ID = 'teacher-新生儿呼吸窘迫综合征';
const PROBE_VERSION = `probe-${Date.now()}`;
const PROBE_VERSION_2 = `${PROBE_VERSION}-v2`;

if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) {
  console.error('FATAL: 缺少 CODER_SUPABASE_* 环境变量');
  process.exit(1);
}

interface TokenResult { access_token: string; refresh_token: string; user: { id: string; email?: string } }

async function login({ email, password }: { email: string; password: string }): Promise<TokenResult> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as TokenResult & { error_code?: string; msg?: string };
  if (!resp.ok || !body.access_token) throw new Error(`登录失败 ${email}: ${body.error_code ?? body.msg ?? resp.status}`);
  return body;
}

async function establishSession(token: TokenResult): Promise<string> {
  const resp = await fetch(`${BASE}/api/auth/callback/platform-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ access_token: token.access_token, refresh_token: token.refresh_token }),
  });
  const setCookies = resp.headers.getSetCookie?.() ?? [];
  const authCookie = setCookies.find((c) => c.startsWith('luojia-peds-auth='));
  if (!resp.ok || !authCookie) throw new Error(`platform-session 落地失败 status=${resp.status} cookies=${setCookies.length}`);
  return authCookie.split(';')[0];
}

async function api(path: string, cookie: string | null, init?: RequestInit): Promise<{ status: number; body: any }> {
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
  });
  let body: any = null;
  try { body = await resp.json(); } catch { /* 非 JSON */ }
  return { status: resp.status, body };
}

function serverPid(): string {
  const out = execSync(`ps -eo pid,cmd | grep "loader.mjs src/server.ts" | grep -v grep | head -1`, { encoding: 'utf8' }).trim();
  return out ? out.split(/\s+/)[0] : '';
}

async function waitHealthy(timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${BASE}/api/health/integrations`, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) return;
    } catch { /* 重启中 */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('等待服务 ready 超时');
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ` (${detail})` : ''}`); }
}

/** 非患者测试草稿载荷：全部必填字段齐备、无身份信息、无媒体。 */
function probePayload(): Record<string, unknown> {
  return {
    caseId: PROBE_CASE_ID,
    age: '胎龄34+1周（测试数据）',
    sex: '男（测试数据）',
    complaint: '生后呻吟、吐沫30分钟（测试数据）',
    sections: {
      history: '测试病史：非患者数据，仅用于草稿导入验收。',
      exam: '测试查体：呼吸 65 次/分，双肺呼吸音减低（测试数据）。',
      tests: '测试辅检：血气分析示低氧血症（测试数据）。',
      diagnosis: '测试诊断：新生儿呼吸窘迫综合征（测试数据）。',
      plan: '测试计划：持续气道正压通气（测试数据）。',
    },
  };
}

async function main(): Promise<void> {
  console.log(`目标服务: ${BASE}`);
  console.log(`探针草稿: ${PROBE_CASE_ID} @ ${PROBE_VERSION}`);

  // 0. 教师登录 + 落 cookie
  const teacherToken = await login(TEACHER);
  const teacherCookie = await establishSession(teacherToken);
  check('教师B（白名单）经 platform-session 落 cookie', Boolean(teacherCookie));

  // 1. 预校验：缺必填字段
  const precheckMissing = await api('/api/teacher/case-drafts', teacherCookie, {
    method: 'POST',
    body: JSON.stringify({ action: 'precheck', draftVersion: PROBE_VERSION, payload: { caseId: PROBE_CASE_ID, sections: {} } }),
  });
  const pre = precheckMissing.body?.data?.precheck;
  check('预校验（缺字段）返回 200 且 missingFields ≥ 6',
    precheckMissing.status === 200 && Array.isArray(pre?.missingFields) && pre.missingFields.length >= 6,
    `status=${precheckMissing.status} missing=${pre?.missingFields?.length ?? 'n/a'}`);
  check('预校验不自动补造患者事实', pre?.issues?.some((i: string) => i.includes('必填字段缺失')) === true);

  // 2. 保存完整非患者草稿
  const save1 = await api('/api/teacher/case-drafts', teacherCookie, {
    method: 'POST',
    body: JSON.stringify({ action: 'save', draftVersion: PROBE_VERSION, desensitized: true, payload: probePayload() }),
  });
  check('教师保存非患者测试草稿（saved）', save1.status === 200 && save1.body?.data?.result === 'saved',
    `status=${save1.status} result=${save1.body?.data?.result}`);

  // 3. 重复导入同一版本 → duplicate（不覆盖）
  const saveDup = await api('/api/teacher/case-drafts', teacherCookie, {
    method: 'POST',
    body: JSON.stringify({ action: 'save', draftVersion: PROBE_VERSION, desensitized: true, payload: probePayload() }),
  });
  check('重复导入同一版本被拒（duplicate，不覆盖旧版本）',
    saveDup.status === 200 && saveDup.body?.data?.result === 'duplicate',
    `status=${saveDup.status} result=${saveDup.body?.data?.result}`);

  // 4. 版本递增 v2 → saved，v1 仍在
  const save2 = await api('/api/teacher/case-drafts', teacherCookie, {
    method: 'POST',
    body: JSON.stringify({ action: 'save', draftVersion: PROBE_VERSION_2, desensitized: true, payload: probePayload() }),
  });
  check('版本递增修订保存成功（v2）', save2.status === 200 && save2.body?.data?.result === 'saved');
  const list1 = await api('/api/teacher/case-drafts', teacherCookie);
  const versions = (list1.body?.data ?? []).filter((d: any) => d.caseId === PROBE_CASE_ID && String(d.draftVersion).startsWith(PROBE_VERSION)).map((d: any) => d.draftVersion);
  check('草稿列表含 v1 与 v2（旧版本保留）', versions.includes(PROBE_VERSION) && versions.includes(PROBE_VERSION_2), `versions=${versions.length}`);

  // 5. 越权拒绝：学生A / 匿名
  const studentToken = await login(STUDENT_A);
  const studentCookie = await establishSession(studentToken);
  const studentGet = await api('/api/teacher/case-drafts', studentCookie);
  check('学生A读取草稿列表被拒（403）', studentGet.status === 403, `status=${studentGet.status}`);
  const studentPost = await api('/api/teacher/case-drafts', studentCookie, {
    method: 'POST',
    body: JSON.stringify({ action: 'save', draftVersion: `evil-${Date.now()}`, payload: probePayload() }),
  });
  check('学生A保存草稿被拒（403）', studentPost.status === 403, `status=${studentPost.status}`);
  const anonGet = await api('/api/teacher/case-drafts', null);
  check('匿名读取草稿被拒（401）', anonGet.status === 401, `status=${anonGet.status}`);

  // 6. Data API 直插/直读（绕过应用路由）
  const directInsert = await fetch(`${SUPA_URL}/rest/v1/case_draft_imports`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${studentToken.access_token}`, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ case_id: 'teacher-x', draft_version: 'evil', payload: {}, created_by: studentToken.user.id }),
  });
  check('学生A直插 case_draft_imports 被拒（RLS）', directInsert.status >= 400, `status=${directInsert.status}`);
  const directSelect = await fetch(`${SUPA_URL}/rest/v1/case_draft_imports?select=id&case_id=eq.${encodeURIComponent(PROBE_CASE_ID)}`, {
    headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${studentToken.access_token}`, 'X-Instance-ID': SUPA_TENANT_ID },
  });
  const directRows = directSelect.ok ? await directSelect.json() : null;
  check('学生A直读草稿表 0 行（RLS）', Array.isArray(directRows) && directRows.length === 0, `status=${directSelect.status} rows=${directRows?.length ?? 'err'}`);
  const anonSelect = await fetch(`${SUPA_URL}/rest/v1/case_draft_imports?select=id&limit=1`, {
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID },
  });
  const anonRows = anonSelect.ok ? (await anonSelect.json()) as unknown[] : null;
  check('匿名直读草稿表被拒（RLS+权限收回，401/空）', anonRows === null || anonRows.length === 0, `status=${anonSelect.status}`);

  // 7. 真实服务重启 → 教师重新登录复读草稿
  const pidBefore = serverPid();
  console.log(`重启前服务 PID: ${pidBefore}`);
  appendFileSync(resolve(PROJECT_ROOT, 'src/server.ts'), '\n');
  const pidDeadline = Date.now() + 60000;
  let pidAfter = '';
  while (Date.now() < pidDeadline) {
    const current = serverPid();
    if (current && current !== pidBefore) { pidAfter = current; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await waitHealthy();
  if (!pidAfter) pidAfter = serverPid();
  check('服务进程真实重启（PID 变化）', Boolean(pidAfter) && pidAfter !== pidBefore, `before=${pidBefore} after=${pidAfter}`);

  const teacherToken2 = await login(TEACHER);
  const teacherCookie2 = await establishSession(teacherToken2);
  const listAfter = await api('/api/teacher/case-drafts', teacherCookie2);
  const versionsAfter = (listAfter.body?.data ?? []).filter((d: any) => d.caseId === PROBE_CASE_ID && String(d.draftVersion).startsWith(PROBE_VERSION)).map((d: any) => d.draftVersion);
  check('重启后教师重新登录复读草稿（v1+v2 均在，数据库持久化）',
    listAfter.status === 200 && versionsAfter.includes(PROBE_VERSION) && versionsAfter.includes(PROBE_VERSION_2),
    `status=${listAfter.status} n=${versionsAfter.length}`);
  const studentGetAfter = await api('/api/teacher/case-drafts', await establishSession(studentToken));
  check('重启后学生仍被拒（403）', studentGetAfter.status === 403, `status=${studentGetAfter.status}`);

  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  console.log(`\n清理提示：探针草稿 ${PROBE_CASE_ID} @ ${PROBE_VERSION}, ${PROBE_VERSION_2} 需管理工具清理（表无 DELETE 权限，应用层不可删）。`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
