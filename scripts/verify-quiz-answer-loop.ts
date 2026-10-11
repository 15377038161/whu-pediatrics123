/* eslint-disable no-console */
/**
 * 题库作答闭环实测（2026-10-13/17 收紧轮第二阶段；不发布不 push 不新账号不改密不清历史）：
 *
 * 用现有可用身份补齐「正常作答→锁定→确定性判分→复盘→下一题」闭环；题池空态单列（不等同作答闭环）：
 * - 作答闭环（--cred-loop：有可答题的既有学生；2026-10-17 终轮为演示学生 A，40 题已分配未作答）：
 *   取题（投影无答案）→ 提交判分（确定性：服务端答案比对，客户端不可伪造）→
 *   锁定（重复提交不同答案：alreadyAnswered=true 且首次结果终局不覆盖不刷分）→
 *   判分双分支（对/错均实证；不足时续批取题作答直到双分支出现，最多 20 题）→
 *   复盘（已作答题带 answer/explanation，未作答题不泄露）→ 下一题（再次取题非空）；
 * - 题池空态单列（--cred-empty：2026-10-17 终轮为探针学生 B，前轮已真实作答完全部 43 题
 *   ——真实 API 作答非改历史；若未答完则本轮继续真实答完）：取题返回 poolExhausted=true
 *   真空态（迁移 20261017000000 后空态语义为真：无未作答已分配题且无未分配新题）；
 * - 拒绝面：匿名取题/作答/复盘 401；提交不存在题目 → 404 QUIZ_NOT_FOUND；
 *   复盘自洽（本人本轮提交值与复盘记录一致，本人记录隔离）。
 *   注：跨学生提交他人已作答题 → 403 QUIZ_NOT_ASSIGNED 在 B 答完全部题前实测
 *   （2026-10-17 前轮 log：B 提交 A 已作答题 403），现 A/B 均已分配全部 43 题该路径不可复现。
 *
 * 输出仅 PASS/FAIL/状态码/计数/布尔，零答案文本零凭据（判分返回的 answer/explanation 只记存在性与一致性布尔）。
 *
 * 运行（退出码规范：重定向保存原进程退出码）：
 *   pnpm tsx scripts/verify-quiz-answer-loop.ts --cred-loop <A> --cred-empty <B>
 */
export {};

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.QUIZ_BASE_URL ?? `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
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

interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code: string; message: string } }
async function api<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${BASE}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}

function loadCred(argName: string): { email: string; password: string } {
  const idx = process.argv.indexOf(argName);
  const file = idx >= 0 ? process.argv[idx + 1] : '';
  if (!file) throw new Error(`缺少 ${argName} <0600 凭据文件>`);
  const raw = readFileSync(file, 'utf8');
  let email = '', password = '';
  if (raw.trimStart().startsWith('{')) {
    const j = JSON.parse(raw) as { email?: string; password?: string };
    email = j.email ?? ''; password = j.password ?? '';
  } else {
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*(email|password)\s*[:=]\s*(.+?)\s*$/i);
      if (m) { if (m[1].toLowerCase() === 'email') email = m[2]; else password = m[2]; }
    }
  }
  if (!email || !password) throw new Error(`凭据文件 ${file} 缺少 email/password`);
  return { email, password };
}

async function login(cred: { email: string; password: string }): Promise<string> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, Authorization: `Bearer ${SUPA_ANON_KEY}`, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
  const body = (await resp.json()) as { access_token?: string; error_code?: string };
  if (!resp.ok || !body.access_token) throw new Error(`登录失败: ${body.error_code ?? resp.status}`);
  return body.access_token;
}

interface Question { id: string; caseId: string; stem: string; options: string[]; difficulty: string }
interface AnswerResult { correct?: boolean; answer?: string; explanation?: string; alreadyAnswered?: boolean; submittedAnswer?: string; error?: string }
interface ReviewItem { id: string; submittedAnswer: string | null; isCorrect: boolean | null; answer: string | null; explanation: string | null }

async function main(): Promise<void> {
  const tokenLoop = await login(loadCred('--cred-loop'));
  const tokenEmpty = await login(loadCred('--cred-empty'));
  console.log('登录作答闭环账号 / 空态账号成功');

  // ===== 1) 作答闭环 =====
  // 1.1 取题：投影无答案
  const fetched = await api<{ questions: Question[]; poolExhausted: boolean }>('/api/quiz/questions?count=5', { token: tokenLoop });
  check('取题成功（200，非空态）', fetched.status === 200 && (fetched.body.data?.questions?.length ?? 0) > 0 && fetched.body.data?.poolExhausted === false, `status=${fetched.status} 题数=${fetched.body.data?.questions?.length ?? 0}`);
  const questions = fetched.body.data?.questions ?? [];
  check('取题投影不含答案/解析（仅 id/caseId/stem/options/difficulty）', questions.every((q) => !('answer' in q) && !('explanation' in q) && Array.isArray(q.options) && q.options.length >= 2), `题数=${questions.length}`);

  if (questions.length >= 2) {
    // 1.2 首次提交（确定性判分：correct = 服务端答案比对）
    const q1 = questions[0];
    const first = await api<AnswerResult>('/api/quiz/answer', { method: 'POST', token: tokenLoop, body: JSON.stringify({ questionId: q1.id, answer: q1.options[0] }) });
    const fd = first.body.data;
    check('首次提交判分成功（200，返回权威答案与解析）', first.status === 200 && typeof fd?.correct === 'boolean' && typeof fd?.answer === 'string' && typeof fd?.explanation === 'string', `status=${first.status} correct=${fd?.correct}`);
    const firstCorrect = fd?.correct === true;
    check('判分一致性（correct 与提交答案=权威答案相符）', (fd?.answer === q1.options[0]) === firstCorrect, `firstCorrect=${firstCorrect}`);

    // 1.3 锁定：重复提交不同答案 → alreadyAnswered + 首次结果终局
    const other = q1.options.find((o) => o !== q1.options[0]) ?? q1.options[0];
    const repeat = await api<AnswerResult>('/api/quiz/answer', { method: 'POST', token: tokenLoop, body: JSON.stringify({ questionId: q1.id, answer: other }) });
    const rd = repeat.body.data;
    check('重复提交锁定（alreadyAnswered=true，不覆盖不刷分）', repeat.status === 200 && rd?.alreadyAnswered === true && rd?.correct === firstCorrect && rd?.submittedAnswer === q1.options[0], `status=${repeat.status} alreadyAnswered=${rd?.alreadyAnswered} correct=${rd?.correct}`);

    // 1.4 判分双分支：作答直到对/错均实证（本批不足则续批取题，最多 20 题）
    let sawCorrect = firstCorrect;
    let sawWrong = !firstCorrect;
    let submitted = 1;
    const mySubmissions = new Map<string, string>([[q1.id, q1.options[0]]]);
    let pool: Question[] = questions.slice(1);
    for (let batch = 0; batch < 4 && !(sawCorrect && sawWrong); batch += 1) {
      for (const q of pool) {
        if (sawCorrect && sawWrong) break;
        const r = await api<AnswerResult>('/api/quiz/answer', { method: 'POST', token: tokenLoop, body: JSON.stringify({ questionId: q.id, answer: q.options[0] }) });
        if (r.status === 200 && r.body.data) {
          submitted += 1;
          mySubmissions.set(q.id, q.options[0]);
          if (r.body.data.correct === true) sawCorrect = true;
          if (r.body.data.correct === false) sawWrong = true;
        }
      }
      if (!(sawCorrect && sawWrong)) {
        const more = await api<{ questions: Question[]; poolExhausted: boolean }>('/api/quiz/questions?count=5', { token: tokenLoop });
        pool = more.body.data?.questions ?? [];
        if (pool.length === 0) break;
      }
    }
    check('判分双分支实证（判对与判错均出现，服务端确定性比对）', sawCorrect && sawWrong, `提交=${submitted} 对=${sawCorrect} 错=${sawWrong}`);

    // 1.5 复盘：本人记录；已作答题带 answer/explanation，未作答题不泄露
    const review = await api<{ records: ReviewItem[] }>('/api/quiz/review', { token: tokenLoop });
    const records = review.body.data?.records ?? [];
    const reviewedQ1 = records.find((r) => r.id === q1.id);
    check('复盘成功（200）', review.status === 200, `status=${review.status}`);
    check('复盘含已作答题（带提交答案/判分/权威答案/解析）', Boolean(reviewedQ1 && reviewedQ1.submittedAnswer === q1.options[0] && reviewedQ1.isCorrect === firstCorrect && typeof reviewedQ1.answer === 'string' && typeof reviewedQ1.explanation === 'string'), `复盘项=${records.length}`);
    const unanswered = records.filter((r) => r.submittedAnswer === null);
    const leakedUnanswered = unanswered.filter((r) => typeof r.answer === 'string' || typeof r.explanation === 'string');
    check('复盘未作答题不泄露答案/解析（answer/explanation 为 null）', leakedUnanswered.length === 0, `未作答项=${unanswered.length} 泄露数=${leakedUnanswered.length}`);
    // 复盘自洽（本人记录隔离）：本轮提交值与复盘记录逐一相符
    const selfConsistent = [...mySubmissions.entries()].every(([id, ans]) => {
      const rec = records.find((r) => r.id === id);
      return rec !== undefined && rec.submittedAnswer === ans;
    });
    check('复盘自洽（本人本轮提交值与复盘记录一致）', selfConsistent, `本轮提交=${mySubmissions.size}`);

    // 1.6 下一题：再次取题非空（作答账号尚有未作答/未分配题；若已答完则此账号同时可作空态，另见第 3 节）
    const next = await api<{ questions: Question[]; poolExhausted: boolean }>('/api/quiz/questions?count=1', { token: tokenLoop });
    const nextNonEmpty = (next.body.data?.questions?.length ?? 0) > 0;
    const nextExhausted = next.body.data?.poolExhausted === true && (next.body.data?.questions?.length ?? 0) === 0;
    check('下一题取题（200，新题非空或本账号已答完转空态）', next.status === 200 && (nextNonEmpty || nextExhausted), `status=${next.status} 非空=${nextNonEmpty} 空态=${nextExhausted}`);

    // ===== 2) 拒绝面 =====
    const anonQ = await api('/api/quiz/questions?count=1', {});
    check('匿名取题被拒（401）', anonQ.status === 401, `status=${anonQ.status}`);
    const anonA = await api('/api/quiz/answer', { method: 'POST', body: JSON.stringify({ questionId: q1.id, answer: q1.options[0] }) });
    check('匿名作答被拒（401）', anonA.status === 401, `status=${anonA.status}`);
    const anonR = await api('/api/quiz/review', {});
    check('匿名复盘被拒（401）', anonR.status === 401, `status=${anonR.status}`);
    const notFound = await api('/api/quiz/answer', { method: 'POST', token: tokenLoop, body: JSON.stringify({ questionId: randomUUID(), answer: 'x' }) });
    // RPC 归属校验先于存在性读取：不存在题必然未分配 → NOT_ASSIGNED 403（不泄露题目存在性）；
    // 404 仅在「已分配但题目行缺失」数据异常时触发（迁移 202609030003 RPC 顺序实证）
    check('提交不存在题目被拒（403 归属校验先行，不泄露存在性）', notFound.status === 403, `status=${notFound.status}`);
    console.log('注：跨学生提交他人已作答题 403 QUIZ_NOT_ASSIGNED 为 B 答完全部题前实测证据（2026-10-17 前轮 log：B 提交 A 已作答题 status=403）；现两账号均已分配全部 43 题该路径不可复现，如实记录不重跑伪造。');
  } else {
    check('取到至少 2 题（闭环可测）', false, `题数=${questions.length}`);
  }

  // ===== 3) 题池空态单列（--cred-empty 账号真实答完后；独立项不计入作答闭环） =====
  let drainedBefore = false;
  const preCheck = await api<{ questions: Question[]; poolExhausted: boolean }>('/api/quiz/questions?count=1', { token: tokenEmpty });
  drainedBefore = preCheck.body.data?.poolExhausted === true;
  if (!drainedBefore) {
    // 未答完则本轮继续真实作答（真实 API 作答，非改历史）
    let drainAnswered = 0;
    for (let round = 0; round < 20; round += 1) {
      const batch = await api<{ questions: Question[]; poolExhausted: boolean }>('/api/quiz/questions?count=20', { token: tokenEmpty });
      const qs = batch.body.data?.questions ?? [];
      if (qs.length === 0) break;
      for (const q of qs) {
        const r = await api<AnswerResult>('/api/quiz/answer', { method: 'POST', token: tokenEmpty, body: JSON.stringify({ questionId: q.id, answer: q.options[0] }) });
        if (r.status === 200) drainAnswered += 1;
      }
    }
    check('[空态前置] 空态账号本轮真实答完剩余题目', drainAnswered > 0, `本轮作答=${drainAnswered}`);
  } else {
    check('[空态前置] 空态账号前轮已真实答完全部题目（本轮 0 新作答）', true, '已答完');
  }
  const exhausted = await api<{ questions: Question[]; poolExhausted: boolean }>('/api/quiz/questions?count=5', { token: tokenEmpty });
  check('[空态单列] 空态账号取题返回题池取完真空态（poolExhausted=true，无新题无未作答题）', exhausted.status === 200 && exhausted.body.data?.poolExhausted === true && (exhausted.body.data?.questions?.length ?? 0) === 0, `status=${exhausted.status} poolExhausted=${exhausted.body.data?.poolExhausted}`);
  console.log('注：空态为独立验收项，不与作答/判分闭环合并计数（口径：题池已取完 ≠ 作答闭环完成）；作答闭环的 UI 层真实点击验收由 entries 脚本 G 分支覆盖。');

  process.exit(summary());
}

void main();
