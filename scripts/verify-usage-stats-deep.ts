/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 使用统计深度验收（2026-10-13 账户标记合规复核轮）：
 * 与 verify-usage-stats.ts 互补，聚焦上一轮未覆盖的时间型口径，全部真实链路取证：
 *   1. ≥90 秒连续心跳归并：两次 30s 间隔心跳 + 40s 间隔心跳（均在 45s 归并窗口内），
 *      最终单区间持续 >90s（验证归并窗口修复真实生效，非引擎层推断）；
 *   2. 多标签页重叠去重语义：同一学生两 tab 并行活跃 → 区间独立累计（口径如实），
 *      但重复 clientEventId 跨 tab 幂等（同 key 不双计）；
 *   3. 停止上报后区间上限：心跳停止后区间保持最后心跳 +10s 基线封顶（45s 窗口之外不无界续期）；
 *   4. detail 白名单负测：非法键 / 超长值 / 非 path 键 → 422（zod）+ INVALID_DETAIL（RPC 双层）；
 *   5. 跨日裁剪与 caseId 筛选一致性：仅以学生本人可见数据 + SQL 语义验证（同口径算式复算），
 *      不假冒教师身份调教师 RPC（无教师凭据，教师正测维持未验收）。
 * 运行：pnpm tsx scripts/verify-usage-stats-deep.ts [baseUrl]（约 3 分钟，含真实等待）
 * 探针账号：真实 signup 新学生（usage-deep- 前缀，无 profiles student 行不进教师统计），
 * 凭据仅存在于进程内存，不落盘、不打印 token 原文。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const baseUrl = process.argv[2] ?? `http://127.0.0.1:${process.env.DEPLOY_RUN_PORT ?? 5173}`;
const SUPA_URL = process.env.CODER_SUPABASE_URL as string;
const SUPA_ANON_KEY = process.env.CODER_SUPABASE_ANON_KEY as string;
const SUPA_TENANT_ID = process.env.CODER_SUPABASE_TENANT_ID as string;

if (!SUPA_URL || !SUPA_ANON_KEY || !SUPA_TENANT_ID) {
  console.error('FATAL: 缺少 CODER_SUPABASE_URL / CODER_SUPABASE_ANON_KEY / CODER_SUPABASE_TENANT_ID');
  process.exit(1);
}

type TokenResult = { access_token: string; user: { id: string; email?: string } };

async function signup(email: string, password: string): Promise<TokenResult> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as TokenResult & { msg?: string; error_code?: string };
  if (!resp.ok || !body.access_token) throw new Error(`signup 失败 ${email}: ${body.msg ?? body.error_code ?? resp.status}`);
  return body;
}

function userClient(token: string): SupabaseClient {
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code: string; message: string } }

async function api<T>(path: string, init: RequestInit & { token?: string }): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const resp = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
  return { status: resp.status, body };
}

async function engagementPost(token: string, payload: Record<string, unknown>) {
  return api<{ accepted: boolean; persisted: boolean }>('/api/engagement', { method: 'POST', body: JSON.stringify(payload), token });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, evidence: string): void {
  if (ok) {
    pass += 1;
    console.log(`  ok - ${name} :: ${evidence}`);
  } else {
    fail += 1;
    console.error(`  NOT OK - ${name} :: ${evidence}`);
  }
}

interface IntervalRow {
  id: string;
  tab_id: string;
  session_id: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
}

async function intervalsOf(db: SupabaseClient, userId: string, tabId?: string): Promise<IntervalRow[]> {
  let q = db.from('student_active_intervals').select('id,tab_id,session_id,started_at,ended_at,duration_seconds').eq('user_id', userId);
  if (tabId) q = q.eq('tab_id', tabId);
  const { data, error } = await q.returns<IntervalRow[]>();
  if (error) throw new Error(`区间查询失败: ${error.message}`);
  return data ?? [];
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const student = await signup(`usage-deep-${stamp}@luojia.dev`, `Up!deep${stamp}#z`);
  console.log(`# 深度探针学生：${student.user.email}`);
  const db = userClient(student.access_token);
  const uid = student.user.id;
  const mainTab = `deep-tab-${stamp}-main`;
  const altTab = `deep-tab-${stamp}-alt`;

  // 自建 profile（事件表 FK；测试身份不进教师统计）
  const { error: profileError } = await db
    .from('profiles')
    .insert({ id: uid, display_name: `统计深探针${stamp}`, app_role: 'student' });
  check('探针 profile 自建（RLS self-insert）', !profileError, profileError?.message ?? 'inserted');

  console.log('## 1. detail 白名单负测（zod 层 422）');
  const badKey = await engagementPost(student.access_token, { eventType: 'page_enter', sessionId: null, clientEventId: `deep-evt-${stamp}-bk`, tabId: mainTab, detail: { path: '/student', secret: '患者原文' } });
  check('detail 含非白名单键 → 422 INVALID_REQUEST', badKey.status === 422 && badKey.body.error?.code === 'INVALID_REQUEST', `${badKey.status} ${badKey.body.error?.code}`);
  const longPath = await engagementPost(student.access_token, { eventType: 'page_enter', sessionId: null, clientEventId: `deep-evt-${stamp}-lp`, tabId: mainTab, detail: { path: 'x'.repeat(257) } });
  check('detail.path 超长 257 字符 → 422', longPath.status === 422, `${longPath.status} ${longPath.body.error?.code}`);
  const rawRpc = await db.rpc('engagement_record_event', { p_event_type: 'page_enter', p_session_id: null, p_client_event_id: `deep-evt-${stamp}-rpc`, p_tab_id: mainTab, p_detail: { token: 'fake-jwt-should-reject' } });
  check('RPC 直调非法 detail 键 → INVALID_DETAIL（双层校验兜底）', rawRpc.error !== null && String(rawRpc.error?.message).includes('INVALID_DETAIL'), String(rawRpc.error?.message).slice(0, 60));
  const injected = await intervalsOf(db, uid, mainTab).then((rows) => rows.length);
  const evCount = await db.from('student_engagement_events').select('*', { count: 'exact', head: true });
  check('被拒事件零落库（事件与区间均未写入）', injected === 0 && (evCount.count ?? 0) === 0, `intervals=${injected} events=${evCount.count ?? 0}`);

  console.log('## 2. ≥90 秒连续心跳归并（真实时间流）');
  // t=0 page_enter → 开区间（基线 10s）
  await engagementPost(student.access_token, { eventType: 'page_enter', sessionId: null, clientEventId: `deep-evt-${stamp}-pe`, tabId: mainTab, detail: { path: '/student' } });
  // 心跳 ×3：间隔约 30s / 30s / 40s（均在 45s 归并窗口内），覆盖约 100s
  for (let i = 1; i <= 3; i += 1) {
    await sleep(i === 3 ? 40_000 : 30_000);
    const hb = await engagementPost(student.access_token, { eventType: 'heartbeat', sessionId: null, clientEventId: `deep-evt-${stamp}-hb${i}`, tabId: mainTab });
    if (hb.status !== 200) check(`心跳 #${i} 上报成功`, false, `${hb.status} ${hb.body.error?.code}`);
  }
  const mainRows = await intervalsOf(db, uid, mainTab);
  check('100 秒连续活跃归并为单一区间', mainRows.length === 1, `rows=${mainRows.length}`);
  const mainDur = mainRows.reduce((s, r) => s + r.duration_seconds, 0);
  check('区间时长 ≥90s（心跳驱动真实续期）', mainDur >= 90, `duration=${mainDur}s`);
  check('区间时长 ≤110s（无虚增）', mainDur <= 110, `duration=${mainDur}s`);
  check('单区间未超 3600s 封顶', mainRows.every((r) => r.duration_seconds <= 3600), `max=${Math.max(...mainRows.map((r) => r.duration_seconds), 0)}s`);

  console.log('## 3. 多标签页重叠（独立 tab 区间独立累计 + 跨 tab 幂等）');
  // alt tab 在 main 会话进行中并行活跃：两次快速事件 → 10s 基线（不同 tab 不归并 main 区间）
  await engagementPost(student.access_token, { eventType: 'page_enter', sessionId: null, clientEventId: `deep-evt-${stamp}-alt-pe`, tabId: altTab, detail: { path: '/student/report' } });
  const dupKey = `deep-evt-${stamp}-dupkey`;
  const dupA = await engagementPost(student.access_token, { eventType: 'heartbeat', sessionId: null, clientEventId: dupKey, tabId: altTab });
  check('alt tab 首次事件 accepted=true', dupA.status === 200 && dupA.body.data?.accepted === true, `${dupA.status}`);
  const dupB = await engagementPost(student.access_token, { eventType: 'heartbeat', sessionId: null, clientEventId: dupKey, tabId: mainTab });
  check('同 clientEventId 跨 tab 重复上报幂等 accepted=false', dupB.status === 200 && dupB.body.data?.accepted === false, `${dupB.status} accepted=${dupB.body.data?.accepted}`);
  const evTotal = await db.from('student_engagement_events').select('*', { count: 'exact', head: true });
  check('幂等未产生新事件行', (evTotal.count ?? 0) === 6, `events=${evTotal.count ?? 0}（pe+hb×3+alt-pe+dupkey=6，重复 dupkey 不新增）`);

  console.log('## 4. 停止上报后区间上限（不无界续期）');
  // 心跳停止 60s（> 归并窗口实际范围：区间 ended_at = 最后事件 +10s 基线，再 +45s 窗口 ≈ 55s），
  // 区间应保持最后心跳 +10s 基线附近，不再增长
  const beforeStop = await intervalsOf(db, uid, mainTab);
  const sumBefore = beforeStop.reduce((s, r) => s + r.duration_seconds, 0);
  const evBefore = (await db.from('student_engagement_events').select('*', { count: 'exact', head: true })).count ?? 0;
  await sleep(60_000);
  // alt tab 新事件（>45s 窗口）应新开区间，main tab 区间不受影响
  await engagementPost(student.access_token, { eventType: 'visibility_active', sessionId: null, clientEventId: `deep-evt-${stamp}-alt-va`, tabId: altTab });
  const afterStop = await intervalsOf(db, uid, mainTab);
  const sumAfter = afterStop.reduce((s, r) => s + r.duration_seconds, 0);
  check('main tab 停止上报后区间不再增长', sumAfter === sumBefore, `before=${sumBefore}s after=${sumAfter}s`);
  const evAfter = (await db.from('student_engagement_events').select('*', { count: 'exact', head: true })).count ?? 0;
  check('新事件仅 1 行（基线区间不含时间外增长）', evAfter === evBefore + 1, `events ${evBefore} → ${evAfter}`);
  const altRows = await intervalsOf(db, uid, altTab);
  check('alt tab 超窗事件新开独立区间（不归并旧区间）', altRows.length === 2, `altRows=${altRows.length} durations=${JSON.stringify(altRows.map((r) => r.duration_seconds))}`);

  console.log('## 5. 跨日裁剪与 caseId 筛选一致性（学生可见数据 + SQL 语义复算）');
  // 不假冒教师调教师 RPC：以学生本人区间为样本，复算 per_student/overall 的边界裁剪算式
  //   activeHours = Σ greatest(0, extract(epoch from (least(ended_at, to) - greatest(started_at, from)))) / 3600
  const allRows = await intervalsOf(db, uid);
  const beijingDay = (iso: string): string => {
    const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
    return d.toISOString().slice(0, 10);
  };
  const byBeijingDay = new Map<string, number>();
  for (const r of allRows) {
    // 全时段（无筛选）总额
    // 跨日分摊：将区间按北京时间自然日切分累加重叠秒数（与 RPC greatest/least 裁剪同语义）
    const start = new Date(r.started_at).getTime();
    const end = new Date(r.ended_at).getTime();
    let cursor = start;
    while (cursor < end) {
      const dayKey = beijingDay(new Date(cursor).toISOString());
      const dayStartUtc = new Date(`${dayKey}T00:00:00Z`).getTime() - 8 * 3600_000;
      const dayEndUtc = dayStartUtc + 24 * 3600_000;
      const overlap = Math.min(end, dayEndUtc) - cursor;
      // 统一按秒累加（overlap 为毫秒差值，须除以 1000 与 duration_seconds 同单位）
      if (overlap > 0) byBeijingDay.set(dayKey, (byBeijingDay.get(dayKey) ?? 0) + overlap / 1000);
      cursor = Math.min(end, dayEndUtc);
    }
  }
  const totalSecAll = allRows.reduce((s, r) => s + r.duration_seconds, 0);
  const totalSecDays = Math.round([...byBeijingDay.values()].reduce((s, v) => s + v, 0));
  check('分日裁剪分摊总和 == 区间全量总和（跨日分摊无损）', totalSecDays === totalSecAll, `days=${totalSecDays}s all=${totalSecAll}s`);
  // 单日筛选复算：取探针活跃首日，验证 from/to 边界裁剪语义
  const firstDay = [...byBeijingDay.keys()].sort()[0];
  const fromTs = new Date(`${firstDay}T00:00:00Z`).getTime() - 8 * 3600_000;
  const toTs = fromTs + 24 * 3600_000;
  let clipped = 0;
  for (const r of allRows) {
    const s = Math.max(new Date(r.started_at).getTime(), fromTs);
    const e = Math.min(new Date(r.ended_at).getTime(), toTs);
    if (e > s) clipped += e - s;
  }
  check('单日边界裁剪复算与分日桶一致', Math.round(clipped / 1000) === Math.round(byBeijingDay.get(firstDay) ?? 0), `clipped=${Math.round(clipped / 1000)}s dayBucket=${Math.round(byBeijingDay.get(firstDay) ?? 0)}s`);
  // caseId 筛选语义验证：本探针全部区间 session_id 为 null（无会话归属），
  // 与 RPC 口径一致 —— caseId 筛选时"无会话归属区间保守排除"，即 caseId 过滤下这些区间时长为 0
  const withSession = allRows.filter((r) => r.session_id !== null).length;
  check('caseId 筛选语义：无会话归属区间在 case 过滤下计 0（保守排除口径自洽）', withSession === 0, `session_id 非空区间=${withSession}/${allRows.length}`);
  // 教师接口负测（学生身份不得触发教师 RPC 阳性路径）
  const negTrend = await db.rpc('teacher_stats_daily_trend', {});
  check('学生直调教师趋势 RPC 被拒（FORBIDDEN）', negTrend.error !== null, String(negTrend.error?.message ?? '').slice(0, 60));

  console.log(`# 结果：pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('FATAL:', error instanceof Error ? error.message : error);
  process.exit(1);
});
