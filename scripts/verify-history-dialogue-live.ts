import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const baseUrl = `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const supabaseUrl = process.env.CODER_SUPABASE_URL;
const supabaseAnonKey = process.env.CODER_SUPABASE_ANON_KEY;
const tenantId = process.env.CODER_SUPABASE_TENANT_ID;
const credentialFile = process.env.HISTORY_PROBE_CRED_FILE ?? '/workspace/.demo-secrets/demo-student-credentials.txt';
if (!supabaseUrl || !supabaseAnonKey || !tenantId) throw new Error('缺少平台 Supabase 环境变量');

function loadCredentials(): { email: string; password: string } {
  const raw = readFileSync(credentialFile, 'utf8');
  if (raw.trimStart().startsWith('{')) {
    const parsed = JSON.parse(raw) as { email?: string; password?: string };
    if (parsed.email && parsed.password) return { email: parsed.email, password: parsed.password };
  }
  const values = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([a-zA-Z_]+)\s*[:=]\s*(.+?)\s*$/);
    if (match) values.set(match[1].toLowerCase(), match[2]);
  }
  const email = values.get('email');
  const password = values.get('password');
  if (!email || !password) throw new Error('演示学生凭据文件缺少 email/password');
  return { email, password };
}

interface Envelope<T> { ok: boolean; data?: T; error?: { code?: string; message?: string } }
interface Runtime { execution: string; model: string | null; errorKind?: string; attempts?: number }
interface Message { actor: string; content: string }
interface TurnResult { newMessages: Message[]; runtime?: Runtime }
interface Session { id: string; caseId: string; sourceSnapshotVersion?: string | null }

async function api<T>(path: string, token: string | null, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  return { status: response.status, body: await response.json() as Envelope<T> };
}

async function main(): Promise<void> {
  const credentials = loadCredentials();
  const login = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey!, 'X-Instance-ID': tenantId!, 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  const auth = await login.json() as { access_token?: string; error_code?: string; msg?: string };
  if (!login.ok || !auth.access_token) throw new Error(`演示学生登录失败：${auth.error_code ?? auth.msg ?? login.status}`);
  const token = auth.access_token;
  const created = await api<Session>('/api/sessions', token, { method: 'POST', body: JSON.stringify({ mode: 'guided', caseId: 'teacher-急性喉炎' }) });
  if (created.status !== 201 || !created.body.data) throw new Error(`创建急性喉炎会话失败：${created.status} ${created.body.error?.code ?? ''}`);
  const session = created.body.data;
  console.log(`SESSION ${session.id} version=${session.sourceSnapshotVersion ?? 'null'}`);
  const turn = (text: string) => api<TurnResult>('/api/agent/turn', token, {
    method: 'POST',
    body: JSON.stringify({ sessionId: session.id, clientEventId: randomUUID(), event: { type: 'ASK_QUESTION', data: { text } } }),
  });
  const questions = [
    { text: '孩子多大了？', required: /8岁27天/, forbidden: /39℃|呼吸困难|起病以来|食欲|睡眠/ },
    { text: '持续多久了？', required: /1天/, forbidden: /8岁|39℃|呼吸困难|起病以来|食欲|睡眠/ },
    { text: '那发热呢？', required: /发热|发烧|体温/, forbidden: /8岁27天|起病以来，食欲及睡眠/ },
  ];
  let failures = 0;
  for (const item of questions) {
    const result = await turn(item.text);
    const messages = result.body.data?.newMessages.filter((message) => message.actor === 'parent' || message.actor === 'child') ?? [];
    const text = messages.map((message) => message.content).join(' ');
    const runtime = result.body.data?.runtime;
    const passed = result.status === 200 && Boolean(text.trim()) && item.required.test(text) && !item.forbidden.test(text);
    if (!passed) failures += 1;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${item.text} status=${result.status} execution=${runtime?.execution ?? 'none'} model=${runtime?.model ?? 'null'} error=${runtime?.errorKind ?? 'none'} attempts=${runtime?.attempts ?? 0}`);
    console.log(`REPLY ${text || '[空回复]'}`);
  }
  const empty = await turn('');
  const emptyPassed = empty.status === 422 && empty.body.error?.code === 'INVALID_REQUEST';
  if (!emptyPassed) failures += 1;
  console.log(`${emptyPassed ? 'PASS' : 'FAIL'} 空提问 status=${empty.status} code=${empty.body.error?.code ?? 'none'}`);
  if (failures) throw new Error(`真实问诊回归失败 ${failures} 项`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
