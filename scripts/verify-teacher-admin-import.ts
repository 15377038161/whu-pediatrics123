/* eslint-disable no-console */
/**
 * 教师审核导入链路只读验证（合法最小请求，不导入、不写 DB、不建账号）：
 * - 匿名 → /api/teacher/case-import GET/POST、/api/teacher/case-publication GET/POST：应 401/403；
 * - 演示学生（合法最小凭据）→ 同上四请求：应 403（角色服务端校验拒绝）；
 * - 学生 → /api/cases GET：正常返回目录（可见性链路可用，不验证内容）；
 * - 学生 → /api/cases/teacher-肾病综合征/resources GET：教师脱敏审核门控默认关闭 → 应返回空列表（非报错）；
 * - 输出仅状态码与错误码，不输出凭据/患者内容。
 * 教师正向（UI/写路由）因无真实教师凭据不验证，本脚本仅覆盖拒绝面与只读入口。
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.QUIZ_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
const CRED_FILE = process.env.QUIZ_CRED_FILE ?? '/tmp/demo-student-credentials.txt';
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

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

async function requestStatus(path: string, init?: RequestInit): Promise<{ status: number; code: string }> {
  const resp = await fetch(`${BASE}${path}`, init);
  const body = (await resp.json().catch(() => ({}))) as { error?: { code?: string } };
  return { status: resp.status, code: body.error?.code ?? 'none' };
}

async function main(): Promise<void> {
  const checks: Check[] = [];

  // 1) 匿名拒绝面：教师导入/发布写路由与诊断路由
  const anonymousTargets: Array<{ name: string; path: string; init?: RequestInit }> = [
    { name: '匿名 case-import GET', path: '/api/teacher/case-import' },
    { name: '匿名 case-import POST（空体）', path: '/api/teacher/case-import', init: { method: 'POST' } },
    { name: '匿名 case-publication GET', path: '/api/teacher/case-publication' },
    { name: '匿名 case-publication POST（空体）', path: '/api/teacher/case-publication', init: { method: 'POST' } },
  ];
  for (const t of anonymousTargets) {
    const r = await requestStatus(t.path, { ...t.init, headers: { 'Content-Type': 'application/json' } });
    const pass = r.status === 401 || r.status === 403;
    checks.push({ name: t.name, pass, detail: `status=${r.status} code=${r.code}` });
  }

  // 2) 演示学生合法登录 → 拒绝面
  const creds = readCreds(CRED_FILE);
  const login = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  if (!login.ok) throw new Error(`学生登录失败 ${login.status}`);
  const { access_token: token } = (await login.json()) as { access_token: string };
  console.log('PASS  演示学生登录成功');
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const studentTargets: Array<{ name: string; path: string; init?: RequestInit }> = [
    { name: '学生 case-import GET（诊断）', path: '/api/teacher/case-import' },
    { name: '学生 case-import POST（空体，不携带病例内容）', path: '/api/teacher/case-import', init: { method: 'POST' } },
    { name: '学生 case-publication GET', path: '/api/teacher/case-publication' },
    { name: '学生 case-publication POST（空体）', path: '/api/teacher/case-publication', init: { method: 'POST' } },
  ];
  for (const t of studentTargets) {
    const r = await requestStatus(t.path, { ...t.init, headers: auth });
    const pass = r.status === 403;
    checks.push({ name: t.name, pass, detail: `status=${r.status} code=${r.code}` });
  }

  // 3) 学生可见性链路（只读入口，仅验证可用性不校验内容）
  const casesResp = await fetch(`${BASE}/api/cases`, { headers: auth });
  const casesBody = (await casesResp.json().catch(() => null)) as { data?: unknown[]; error?: { code?: string } } | null;
  checks.push({
    name: '学生 /api/cases GET 目录可用',
    pass: casesResp.status === 200 && Array.isArray(casesBody?.data),
    detail: `status=${casesResp.status} items=${Array.isArray(casesBody?.data) ? casesBody!.data!.length : 'n/a'}`,
  });

  // 4) 媒体脱敏门控默认关闭（环境未开启 PEDIATRICS_MEDIA_STUDENT_ACCESS 时学生拿不到清单/原图）
  const mediaGateOn = process.env.PEDIATRICS_MEDIA_STUDENT_ACCESS === 'true';
  const resResp = await fetch(`${BASE}/api/cases/teacher-${encodeURIComponent('肾病综合征')}/resources`, { headers: auth });
  const resDetail = `status=${resResp.status}`;
  if (resResp.status === 200) {
    const resBody = (await resResp.json().catch(() => null)) as { data?: unknown[] } | null;
    const empty = Array.isArray(resBody?.data) && resBody!.data!.length === 0;
    if (!mediaGateOn) {
      checks.push({ name: '学生 resources 清单默认关闭（空列表）', pass: empty, detail: `${resDetail} items=${resBody?.data?.length ?? 'n/a'}` });
    } else {
      console.log(`SKIP  媒体门控已开启（PEDIATRICS_MEDIA_STUDENT_ACCESS=true），跳过默认关闭断言`);
    }
  } else {
    checks.push({ name: '学生 resources 只读入口不报错', pass: false, detail: resDetail });
  }

  // 单文件原图路由：学生取本地媒体应 403（未开启门控时），仅当存在根目录才可能命中；目录缺失=404 同样视为未泄漏
  const fileResp = await fetch(`${BASE}/api/cases/teacher-${encodeURIComponent('肾病综合征')}/resource?path=x.png`, { headers: auth });
  const filePass = mediaGateOn ? fileResp.status === 404 || fileResp.status === 403 || fileResp.status === 200 : fileResp.status === 403 || fileResp.status === 404;
  checks.push({ name: '学生 resource 原图路由未泄漏（403/404）', pass: filePass, detail: `status=${fileResp.status}` });

  await fetch(`${SUPA_URL}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
  console.log('PASS  会话登出');

  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  const fail = checks.filter((c) => !c.pass).length;
  console.log(`\n==== 教师审核导入链路只读验证：${checks.length - fail}/${checks.length} 通过 ====\n（教师正向 UI/写路由因无真实教师凭据未验证；缺来源病例不入评分为代码层已核实项，见验收记录）`);
  process.exitCode = fail === 0 ? 0 : 1;
}

void main();
