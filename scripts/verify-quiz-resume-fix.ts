/* eslint-disable no-console */
/**
 * 题库续答修复验证（迁移 20261017000000 前后对照；2026-10-17 收紧轮第二阶段）：
 * 修复前（实测 artifacts/quiz-answer-loop.log）：演示学生 A 取题返回 poolExhausted=true 假空态
 *   （43 已分配/2 已作答，41 题已分配未作答永久搁浅）。
 * 修复后预期：A 取题返回本人已分配未作答题目（续答优先，assigned_at 升序），不足补新题；
 *   反复取题不重复分发（分配记录幂等）；作答后续答集合收敛。
 * 运行：pnpm tsx scripts/verify-quiz-resume-fix.ts --cred-a <A>
 */
export {};

import { readFileSync } from 'node:fs';

const BASE = process.env.QUIZ_BASE_URL ?? `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;
if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) throw new Error('缺少 Supabase 环境变量');

let passCount = 0;
let failCount = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passCount += 1; console.log(`PASS  ${name}${detail ? ` (${detail})` : ''}`); }
  else { failCount += 1; console.log(`FAIL  ${name}${detail ? ` (${detail})` : ''}`); }
}

function loadCred(argName: string): { email: string; password: string } {
  const idx = process.argv.indexOf(argName);
  const file = idx >= 0 ? process.argv[idx + 1] : '';
  if (!file) throw new Error(`缺少 ${argName}`);
  let email = '', password = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(email|password)\s*[:=]\s*(.+?)\s*$/i);
    if (m) { if (m[1].toLowerCase() === 'email') email = m[2]; else password = m[2]; }
  }
  return { email, password };
}

interface Question { id: string; options: string[] }

async function main(): Promise<void> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${SUPA_ANON_KEY}`, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(loadCred('--cred-a')),
  });
  const { access_token } = (await resp.json()) as { access_token?: string };
  if (!access_token) throw new Error('登录失败');

  const fetchQ = async (count: number): Promise<{ questions: Question[]; poolExhausted: boolean }> => {
    const r = await fetch(`${BASE}/api/quiz/questions?count=${count}`, { headers: { Authorization: `Bearer ${access_token}` } });
    const envelope = (await r.json()) as { ok?: boolean; data?: { questions?: Question[]; poolExhausted?: boolean } };
    return { questions: envelope.data?.questions ?? [], poolExhausted: envelope.data?.poolExhausted ?? false };
  };

  // 1) 修复后：A 取题返回未作答题（修复前为 poolExhausted=true 假空态）
  const batch1 = await fetchQ(5);
  check('修复后 A 取题返回续答题（非空态）', batch1.questions.length > 0 && batch1.poolExhausted === false, `题数=${batch1.questions.length}`);
  const ids1 = new Set(batch1.questions.map((q) => q.id));
  check('取题投影不含答案列', batch1.questions.every((q) => !('answer' in q) && !('explanation' in q)));

  // 2) 再次取题：续答优先（同一批未作答题先回来）——集合并集不重复计数
  const batch2 = await fetchQ(5);
  const ids2 = new Set(batch2.questions.map((q) => q.id));
  const overlap = [...ids1].filter((id) => ids2.has(id)).length;
  check('续答优先：未作答题重复取题先返回（重叠>0）', overlap > 0, `批1=${ids1.size} 批2=${ids2.size} 重叠=${overlap}`);

  // 3) 作答一题后再取：该题不再返回（收敛）
  const answerResp = await fetch(`${BASE}/api/quiz/answer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId: batch1.questions[0].id, answer: batch1.questions[0].options[0] }),
  });
  check('作答一题成功（200）', answerResp.status === 200, `status=${answerResp.status}`);
  const batch3 = await fetchQ(5);
  check('作答后该题不再返回（续答集合收敛）', !batch3.questions.some((q) => q.id === batch1.questions[0].id), `批3题数=${batch3.questions.length}`);

  console.log(`结果: ${passCount} PASS / ${failCount} FAIL`);
  process.exit(failCount === 0 ? 0 : 1);
}

void main();
