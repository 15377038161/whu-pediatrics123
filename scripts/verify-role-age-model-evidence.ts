/* eslint-disable no-console */
/**
 * 自然年龄匹配多轮患者/家长会话与模型证据精确匹配（2026-10-17 收紧轮第四阶段 A；
 * 只读 DB 查询 + 正常业务会话写入，零账号新建零权限变更）：
 *
 * 1. 三个年龄段病例各建 guided 会话（自然年龄匹配样本）：
 *    - teacher-新生儿败血症（新生儿期）、teacher-急性毛细支气管炎（别名→源，婴儿期）、
 *      teacher-癫痫全面性发作阵挛性发作（学龄期）；
 *    - 年龄化表达由 role-agent 提示词 childAge 注入（儿语词/时间模糊/断续；家长短口语不重复问题），
 *      本脚本以结构证据入档（actor/childEmotion/长度计数），不打印回复正文。
 * 2. 每会话多轮（ASK_QUESTION×2 不同问法 + DOCTOR_INTERVENTION child_answer 对照）：
 *    - ASK_QUESTION 轮断言 runtime.execution='model'（真实模型路径 doubao-seed-1-8-251228），
 *      DOCTOR_INTERVENTION 轮断言 execution='deterministic'（干预确定性对照，两路径分列不混计）；
 *    - 模型证据精确匹配：agent_call_records 中 (session_id, client_event_id) 与本轮请求逐位一致、
 *      恰 1 行、execution 与响应 runtime 一致（sessionId+clientEventId 精确匹配口径）；
 *    - 幂等：同 clientEventId 重发，记录数不增（仍恰 1 行）。
 *
 * 输出仅 sessionId 前缀/clientEventId 前缀/actor/execution/duration/计数，零患者正文零凭据。
 * 运行（退出码规范）：
 *   pnpm tsx scripts/verify-role-age-model-evidence.ts --cred <0600 学生凭据>
 */
export {};

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.COVER_BASE_URL ?? `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('仅允许本地地址验证');
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

let passCount = 0;
let failCount = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passCount += 1; console.log(`PASS  ${name}${detail ? ` (${detail})` : ''}`); }
  else { failCount += 1; console.log(`FAIL  ${name}${detail ? ` (${detail})` : ''}`); }
}
function summary(): number {
  console.log(`结果: ${passCount} PASS / ${failCount} FAIL`);
  return failCount === 0 ? 0 : 1;
}

function loadCred(): { email: string; password: string } {
  const idx = process.argv.indexOf('--cred');
  const file = idx >= 0 ? process.argv[idx + 1] : '';
  if (!file) throw new Error('缺少 --cred <0600 凭据文件>');
  let email = '', password = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(email|password)\s*[:=]\s*(.+?)\s*$/i);
    if (m) { if (m[1].toLowerCase() === 'email') email = m[2]; else password = m[2]; }
  }
  if (!email || !password) throw new Error('凭据文件缺少 email/password');
  return { email, password };
}

interface TurnResponse {
  data?: {
    newMessages?: Array<{ actor?: string; content?: string }>;
    runtime?: { execution?: string; model?: string | null; durationMs?: number };
    session?: { id?: string; stage?: string; status?: string };
  };
}

async function main(): Promise<void> {
  const cred = loadCred();
  const authResp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${SUPA_ANON_KEY}`, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
  const auth = (await authResp.json()) as { access_token?: string };
  if (!auth.access_token) throw new Error('登录失败');
  const bearer = { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' };
  const dataHeaders = { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${auth.access_token}`, 'X-Instance-ID': SUPA_TENANT_ID };

  async function queryRecord(sessionId: string, clientEventId: string): Promise<Array<{ session_id: string; client_event_id: string; execution: string; model_name: string | null; duration_ms: number }>> {
    const url = `${SUPA_URL}/rest/v1/agent_call_records?session_id=eq.${sessionId}&client_event_id=eq.${encodeURIComponent(clientEventId)}&select=session_id,client_event_id,execution,model_name,duration_ms`;
    const resp = await fetch(url, { headers: dataHeaders });
    return (await resp.json()) as Array<{ session_id: string; client_event_id: string; execution: string; model_name: string | null; duration_ms: number }>;
  }

  // 三个年龄段病例（新生儿期/婴儿期别名→源/学龄期）
  const cases = [
    { caseId: 'teacher-新生儿败血症', stage: '新生儿期' },
    { caseId: 'teacher-急性毛细支气管炎', stage: '婴儿期（别名→源）' },
    { caseId: 'teacher-癫痫全面性发作阵挛性发作', stage: '学龄期' },
  ];

  for (const c of cases) {
    console.log(`\n===== 病例 ${c.caseId}（${c.stage}）=====`);
    const created = await fetch(`${BASE}/api/sessions`, {
      method: 'POST', headers: bearer,
      body: JSON.stringify({ mode: 'guided', caseId: c.caseId }),
    });
    const createdBody = (await created.json()) as { data?: { id?: string } };
    check(`[${c.stage}] 建会话成功（201）`, created.status === 201 && Boolean(createdBody.data?.id), `status=${created.status}`);
    const sessionId = createdBody.data?.id ?? '';
    if (!sessionId) continue;

    // 多轮：ASK_QUESTION×2（模型路径）+ DOCTOR_INTERVENTION（确定性对照）+ 幂等重发
    const questions = ['孩子这次主要的不舒服是什么时候开始的？', '这几天在家有没有发烧、咳嗽或者精神变差的情况？'];
    let assistantCount = 0;
    let modelRounds = 0;
    let deterministicRounds = 0;
    for (const [qi, text] of questions.entries()) {
      const clientEventId = randomUUID();
      const resp = await fetch(`${BASE}/api/agent/turn`, {
        method: 'POST', headers: bearer,
        body: JSON.stringify({ sessionId, clientEventId, event: { type: 'ASK_QUESTION', data: { text } } }),
      });
      const body = (await resp.json()) as TurnResponse;
      const msgs = body.data?.newMessages ?? [];
      const assistants = msgs.filter((m) => m.actor === 'child' || m.actor === 'parent' || m.actor === 'tutor');
      assistantCount += assistants.length;
      check(`[${c.stage}] 问诊轮${qi + 1} turn 200 且新增角色回复`, resp.status === 200 && assistants.length > 0, `status=${resp.status} 角色消息=${assistants.length} actor=${actorSummary(assistants)}`);
      const exec = body.data?.runtime?.execution ?? 'absent';
      check(`[${c.stage}] 问诊轮${qi + 1} execution=model（真实模型路径）`, exec === 'model', `execution=${exec} model=${body.data?.runtime?.model ?? 'null'}`);
      if (exec === 'model') modelRounds += 1;
      // 模型证据精确匹配：records 中 (session_id, client_event_id) 恰 1 行且逐位一致
      const records = await queryRecord(sessionId, clientEventId);
      const exact = records.length === 1 && records[0].session_id === sessionId && records[0].client_event_id === clientEventId;
      check(`[${c.stage}] 问诊轮${qi + 1} 模型证据精确匹配（sessionId+clientEventId 逐位一致恰 1 行）`, exact, `rows=${records.length} exec=${records[0]?.execution ?? 'n/a'}`);
      check(`[${c.stage}] 问诊轮${qi + 1} records.execution 与响应 runtime 一致`, records.length === 1 && records[0].execution === exec, `record=${records[0]?.execution ?? 'n/a'} runtime=${exec}`);

      if (qi === 0) {
        // 幂等：同 clientEventId 重发，记录数不增
        const retry = await fetch(`${BASE}/api/agent/turn`, {
          method: 'POST', headers: bearer,
          body: JSON.stringify({ sessionId, clientEventId, event: { type: 'ASK_QUESTION', data: { text: '幂等重发同问题' } } }),
        });
        const after = await queryRecord(sessionId, clientEventId);
        check(`[${c.stage}] 幂等：同 clientEventId 重发记录数不增（仍恰 1 行）`, after.length === 1, `retryStatus=${retry.status} rows=${after.length}`);
      }
    }

    // DOCTOR_INTERVENTION 确定性对照
    const ivEventId = randomUUID();
    const ivResp = await fetch(`${BASE}/api/agent/turn`, {
      method: 'POST', headers: bearer,
      body: JSON.stringify({ sessionId, clientEventId: ivEventId, event: { type: 'DOCTOR_INTERVENTION', data: { action: 'child_answer' } } }),
    });
    const ivBody = (await ivResp.json()) as TurnResponse;
    const ivExec = ivBody.data?.runtime?.execution ?? 'absent';
    check(`[${c.stage}] 干预轮响应不含 runtime（干预不调模型，与问诊轮 runtime=model 形成对照）`, ivExec === 'absent', `runtime=${ivExec}`);
    const ivRecords = await queryRecord(sessionId, ivEventId);
    check(`[${c.stage}] 干预轮 records.execution=deterministic（确定性对照，落库权威证据）`, ivRecords.length === 1 && ivRecords[0].execution === 'deterministic', `rows=${ivRecords.length} exec=${ivRecords[0]?.execution ?? 'n/a'}`);
    if (ivRecords[0]?.execution === 'deterministic') deterministicRounds += 1;
    check(`[${c.stage}] 干预轮模型证据精确匹配（恰 1 行逐位一致）`, ivRecords.length === 1 && ivRecords[0].session_id === sessionId && ivRecords[0].client_event_id === ivEventId, `rows=${ivRecords.length}`);

    console.log(`INFO  [${c.stage}] 会话 ${sessionId.slice(0, 8)} 角色回复累计 ${assistantCount} 条（模型轮 ${modelRounds}/2、确定性干预轮 ${deterministicRounds}/1）`);
  }

  console.log('注：会话为正常业务写入；agent_call_records 查询走本人 RLS SELECT（只读）；输出零患者正文零凭据。');
  process.exit(summary());
}

/** actor 分布摘要（不输出正文）。 */
function actorSummary(msgs: Array<{ actor?: string }>): string {
  const counts = new Map<string, number>();
  for (const m of msgs) counts.set(m.actor ?? 'unknown', (counts.get(m.actor ?? 'unknown') ?? 0) + 1);
  return [...counts.entries()].map(([k, v]) => `${k}×${v}`).join(',');
}

void main();
