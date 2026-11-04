import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPA_URL = process.env.CODER_SUPABASE_URL;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID;
const BASE = `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const CRED_FILE = process.env.FOREIGN_BODY_CT_CRED_FILE ?? '/workspace/.demo-secrets/demo-student-credentials.txt';
const CASE_ID = 'teacher-异物吸入性窒息';
const ACTIVE_VERSION = '7838e2aa1c4c53af';
const TEST_ID = 'source-test-12';

if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少平台 Supabase 环境变量');

interface Credentials { email: string; password: string }
interface AuthTokens { access_token: string }
interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code?: string; message?: string } }
interface SessionState {
  id: string;
  sourceSnapshotVersion?: string | null;
  stage: string;
  orderedTests: string[];
  supplementalTests?: unknown[];
}
interface TurnData {
  session: SessionState;
  feedback: string | null;
  newMessages: Array<{ actor: string; content: string }>;
}

function loadCredentials(file: string): Credentials {
  const values = new Map<string, string>();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([a-zA-Z_]+)\s*[:=]\s*(.+?)\s*$/);
    if (match) values.set(match[1].toLowerCase(), match[2]);
  }
  const email = values.get('email');
  const password = values.get('password');
  if (!email || !password) throw new Error('演示学生凭据文件缺少 email/password');
  return { email, password };
}

async function login(credentials: Credentials): Promise<string> {
  const response = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY!, 'X-Instance-ID': SUPA_TENANT_ID!, 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  const body = await response.json() as AuthTokens & { error_code?: string };
  if (!response.ok || !body.access_token) throw new Error(`学生登录失败：${body.error_code ?? response.status}`);
  return body.access_token;
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  });
  const body = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  return { status: response.status, body };
}

async function turn(token: string, sessionId: string, event: Record<string, unknown>) {
  return api<TurnData>('/api/agent/turn', token, {
    method: 'POST',
    body: JSON.stringify({ sessionId, clientEventId: `foreign-body-ct-${randomUUID()}`, event }),
  });
}

async function listTests(token: string, sessionId: string): Promise<Array<{ id: string; label: string }>> {
  const response = await fetch(`${SUPA_URL}/rest/v1/rpc/case_snapshot_list_tests`, {
    method: 'POST',
    headers: {
      apikey: SUPA_ANON_KEY!,
      'X-Instance-ID': SUPA_TENANT_ID!,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_case_id: CASE_ID, p_version: ACTIVE_VERSION, p_session_id: sessionId }),
  });
  if (!response.ok) throw new Error(`检查目录读取失败：HTTP ${response.status}`);
  return response.json() as Promise<Array<{ id: string; label: string }>>;
}

function pass(message: string): void {
  console.log(`PASS | ${message}`);
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  pass(message);
}

async function runPath(token: string, kind: 'id' | 'text', expectedResult: string) {
  const created = await api<SessionState>('/api/sessions', token, {
    method: 'POST',
    body: JSON.stringify({ mode: 'guided', caseId: CASE_ID }),
  });
  requireCondition(created.status === 201 && created.body.data, `${kind} 路径：新会话创建成功`);
  const sessionId = created.body.data!.id;
  requireCondition(created.body.data!.sourceSnapshotVersion === ACTIVE_VERSION, `${kind} 路径：新会话绑定 ${ACTIVE_VERSION}`);

  const catalog = await listTests(token, sessionId);
  const catalogItem = catalog.find((item) => item.id === TEST_ID);
  requireCondition(catalogItem?.label === 'CT：肺部（平扫+MPR）', `${kind} 路径：目录包含 source-test-12 且无答案文本`);

  for (const stage of ['history', 'exam']) {
    const navigated = await turn(token, sessionId, { type: 'NAVIGATE_STAGE', data: { stage } });
    requireCondition(navigated.status === 200 && navigated.body.data?.session.stage === stage, `${kind} 路径：合法逐格进入 ${stage} 阶段`);
  }

  const event = kind === 'id'
    ? { type: 'ORDER_TEST', data: { testId: TEST_ID } }
    : { type: 'ORDER_TEST', data: { requestedTests: '胸部CT', reason: '复核气道影像' } };
  const ordered = await turn(token, sessionId, event);
  requireCondition(ordered.status === 200 && ordered.body.data, `${kind} 路径：CT 申请接口成功`);
  const data = ordered.body.data!;
  requireCondition(data.session.orderedTests.includes(TEST_ID), `${kind} 路径：开单记录绑定 source-test-12`);
  const report = data.newMessages.find((message) => message.content.includes('【检查所见】'))?.content ?? '';
  requireCondition(report === expectedResult, `${kind} 路径：逐字返回原病例 CT 报告`);
  requireCondition(!report.includes('报告暂未取得') && !report.includes('资料未提供'), `${kind} 路径：未落入资料缺失兜底`);
  requireCondition((data.session.supplementalTests ?? []).length === 0, `${kind} 路径：未生成 AI 补充检查`);

  const restored = await api<SessionState>(`/api/sessions/${sessionId}`, token);
  requireCondition(
    restored.status === 200
      && restored.body.data?.sourceSnapshotVersion === ACTIVE_VERSION
      && restored.body.data.orderedTests.includes(TEST_ID),
    `${kind} 路径：会话回读保持新版绑定与 CT 开单记录`,
  );
  console.log(`OBS | ${kind} sessionId=${sessionId} reportChars=${report.length}`);
  return report;
}

async function main(): Promise<void> {
  const source = JSON.parse(readFileSync(resolve('knowledge/teaching-cases', `${CASE_ID}.json`), 'utf8')) as {
    testDefinitions?: Array<{ testId: string; result: string }>;
  };
  const expectedResult = source.testDefinitions?.find((item) => item.testId === TEST_ID)?.result;
  requireCondition(expectedResult, '本地受控病例包含 source-test-12 原始报告');

  const token = await login(loadCredentials(CRED_FILE));
  pass('既有演示学生登录成功（凭据未输出）');
  const byId = await runPath(token, 'id', expectedResult);
  const byText = await runPath(token, 'text', expectedResult);
  requireCondition(byId === byText, '目录点选与胸部CT文本申请返回同一报告');
  console.log('RESULT | 异物吸入性窒息新版 CT 闭环全部通过');
}

main().catch((error: unknown) => {
  console.error(`FAIL | ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
