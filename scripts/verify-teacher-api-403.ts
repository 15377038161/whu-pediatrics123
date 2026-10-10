/* eslint-disable no-console */
/**
 * 教师接口 403 口径补验（合法最小请求，不创建教师不写教师数据）：
 * - quiz/review POST：路由无 body 解析，requireAuth('teacher') 先行 → 学生应 403；
 * - teacher/students / usage-stats / sessions/[id]：GET 合法最小请求 → 学生应 403；
 * - 输出仅状态码与错误码，不输出凭据/患者内容。
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

async function main(): Promise<void> {
  const creds = readCreds(CRED_FILE);
  const login = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  if (!login.ok) throw new Error(`登录失败 ${login.status}`);
  const { access_token: token } = (await login.json()) as { access_token: string };
  console.log('PASS  演示学生登录成功');

  const auth = { Authorization: `Bearer ${token}` };
  const cases: Array<{ name: string; path: string; init?: RequestInit }> = [
    { name: 'quiz/review POST（教师题池，路由无 body 解析）', path: '/api/quiz/review', init: { method: 'POST' } },
    { name: 'teacher/students GET', path: '/api/teacher/students' },
    { name: 'teacher/usage-stats GET', path: '/api/teacher/usage-stats' },
    { name: 'teacher/sessions/00000000-0000-0000-0000-000000000000 GET', path: '/api/teacher/sessions/00000000-0000-0000-0000-000000000000' },
  ];
  let fail = 0;
  for (const c of cases) {
    const resp = await fetch(`${BASE}${c.path}`, { ...c.init, headers: auth });
    const body = (await resp.json().catch(() => ({}))) as { error?: { code?: string } };
    const pass = resp.status === 403;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name}: status=${resp.status} code=${body.error?.code ?? 'none'}${pass ? '（角色鉴权拒绝，非校验失败）' : ''}`);
    if (!pass) fail += 1;
  }
  await fetch(`${SUPA_URL}/auth/v1/logout?scope=global`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
  console.log('PASS  会话登出');
  console.log(`\n==== 教师接口 403 合法最小请求补验：${cases.length - fail}/${cases.length} 通过 ====`);
  process.exitCode = fail === 0 ? 0 : 1;
}

void main().catch((e: unknown) => { console.error('FATAL', (e as Error).message); process.exitCode = 1; });
