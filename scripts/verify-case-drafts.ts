/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 教师病例草稿导入验收（真实 HTTP 栈 + 真实教师/学生 JWT + 真实服务重启）：
 * 授权基线：严格交集 = 应用层教师角色（requireAuth 'teacher'）AND 数据库白名单（app_is_teacher）。
 * - 当前沙箱无双重授权教师样本（白名单探针B无应用层教师元数据，role=student），
 *   探针B的草稿保存/复读断言预期为 HTTP 403（fail-closed 实证），非成功链路；
 * - HTTP 保存/列表/重启复读在双重授权样本就位前标注「未验」；
 * - Data API 直插/直读（RLS 层）独立记录，不受应用层样本限制；
 * - 学生A / 匿名 API 拒绝断言保持。
 * 运行：pnpm tsx scripts/verify-case-drafts.ts
 */
import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROBE_USER_A, PROBE_USER_B } from './probe-credentials';

const BASE = process.env.RESTART_BASE_URL || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5173}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const PROJECT_ROOT = resolve(process.cwd());

const TEACHER = PROBE_USER_B;
const STUDENT_A = PROBE_USER_A;

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
  // 退出码口径：不再使用 `ps | grep | head -1` 管道（head 恒返 0，会掩盖 grep 未命中与 ps 自身失败）。
  // 直接执行 ps 并在 JS 内过滤，ps 失败时 execSync 抛出原始非零退出码，不被管道末端命令掩盖。
  const ps = execSync('ps -eo pid,cmd', { encoding: 'utf8' });
  const line = ps.split('\n').find((l) => l.includes('loader.mjs src/server.ts') && !l.includes('grep'));
  return line ? line.trim().split(/\s+/)[0] : '';
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

  // 0. 登录：白名单探针B + 学生A
  const teacherToken = await login(TEACHER);
  const teacherCookie = await establishSession(teacherToken);
  const meProbe = await api('/api/auth/me', teacherCookie);
  const probeRole = meProbe.body?.data?.user?.role ?? meProbe.body?.data?.role ?? 'unknown';
  const probeDualAuthorized = probeRole === 'teacher';
  console.log(`探针B应用层角色: ${probeRole}（双重授权: ${probeDualAuthorized ? '是' : '否，保存链路断言为 fail-closed 403'}）`);

  // 1. 非双重授权探针B：草稿 API 全部 403（严格交集 fail-closed 实证）
  const probeGet = await api('/api/teacher/case-drafts', teacherCookie);
  check('非双重授权探针B（白名单通过/应用层student）GET草稿被拒（403）',
    probeGet.status === 403, `status=${probeGet.status} role=${probeRole}`);
  const probePost = await api('/api/teacher/case-drafts', teacherCookie, {
    method: 'POST',
    body: JSON.stringify({ action: 'precheck', draftVersion: 'probe-denied', payload: { caseId: PROBE_CASE_ID, sections: {} } }),
  });
  check('非双重授权探针B POST precheck被拒（403）', probePost.status === 403, `status=${probePost.status}`);
  const probePage = await fetch(`${BASE}/teacher/case-drafts`, { headers: { Cookie: teacherCookie }, redirect: 'manual' });
  check('非双重授权探针B访问草稿页面被重定向（307）', probePage.status === 307, `status=${probePage.status} loc=${probePage.headers.get('location')}`);

  if (probeDualAuthorized) {
    // 双重授权样本就位时的成功链路（当前沙箱无样本，未执行）
    const save1 = await api('/api/teacher/case-drafts', teacherCookie, {
      method: 'POST',
      body: JSON.stringify({ action: 'save', draftVersion: PROBE_VERSION, desensitized: true, payload: probePayload() }),
    });
    check('双重授权教师保存草稿（saved）', save1.status === 200 && save1.body?.data?.result === 'saved', `status=${save1.status}`);
  } else {
    console.log('SKIP 双重授权教师保存链路：无样本，HTTP 保存/列表/重启复读标注「未验」');
  }

  // 2. 学生A / 匿名 API 拒绝
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

  // 3. Data API 直插/直读（RLS 层独立记录，不受应用层样本限制）
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

  // 4. 真实服务重启 → 权限基线不因重启漂移
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
  const probeGetAfter = await api('/api/teacher/case-drafts', teacherCookie2);
  check('重启后非双重授权探针B仍被拒（403，fail-closed不漂移）', probeGetAfter.status === 403, `status=${probeGetAfter.status}`);
  const studentGetAfter = await api('/api/teacher/case-drafts', await establishSession(studentToken));
  check('重启后学生仍被拒（403）', studentGetAfter.status === 403, `status=${studentGetAfter.status}`);
  if (!probeDualAuthorized) {
    console.log('SKIP 重启后教师复读草稿：无双重授权样本，HTTP 复读标注「未验」（数据库持久化由 RLS 层保证，应用层链路待样本）');
  }

  console.log(`\n结果: ${pass} pass / ${fail} fail`);
  console.log('未验项：双重授权教师 HTTP 保存/列表/重启复读（无样本）；探针历史草稿（2 份非患者测试数据）保留，表无 DELETE 权限需管理工具清理。');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
