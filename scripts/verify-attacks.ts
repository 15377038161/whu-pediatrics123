/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 真实残余攻击实测（核验阶段）：
 * 攻击1：学生完成自己会话后直调 report_save_completed 传自选 100 分（Data API，绕过 Next 路由）。
 * 攻击2：学生直接 UPDATE 本人 state 证据（events/messages/decision 等评分输入）。
 * 攻击3：学生逐步自改 stage / 直接置 status=completed 解锁 case_snapshot_get_reference 提前取诊断。
 * 判定规则：攻击成功 = VULN（记 fail，不改断言接受）；攻击被拒 = PASS。
 * 运行：pnpm tsx scripts/verify-attacks.ts
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.CODER_SUPABASE_URL;
const anonKey = process.env.CODER_SUPABASE_ANON_KEY;
const tenantId = process.env.CODER_SUPABASE_TENANT_ID;

if (!url || !anonKey || !tenantId) {
  console.error('FATAL: 缺少 CODER_SUPABASE_URL / CODER_SUPABASE_ANON_KEY / CODER_SUPABASE_TENANT_ID');
  process.exit(1);
}

const SUPA_URL = url as string;
const SUPA_ANON_KEY = anonKey as string;
const SUPA_TENANT_ID = tenantId as string;

const USER_A = { email: 'rls-probe-a@luojia.dev', password: 'RlsProbe#2026A' };
const USER_B = { email: 'rls-probe-b@luojia.dev', password: 'RlsProbe#2026B' };

type TokenResult = { access_token: string; user: { id: string; email?: string } };

async function login(email: string, password: string): Promise<TokenResult> {
  const resp = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPA_ANON_KEY, 'X-Instance-ID': SUPA_TENANT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await resp.json()) as TokenResult & { error_code?: string; msg?: string };
  if (!resp.ok || !body.access_token) {
    throw new Error(`登录失败 ${email}: ${body.error_code ?? body.msg ?? resp.status}`);
  }
  return body;
}

function userClient(token: string) {
  return createClient(SUPA_URL, SUPA_ANON_KEY, {
    global: { headers: { 'X-Instance-ID': SUPA_TENANT_ID, Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let pass = 0;
let vuln = 0;
function report(name: string, blocked: boolean, detail = ''): void {
  // blocked=true 表示攻击被数据库拦截（安全）；blocked=false 表示攻击成功（漏洞）
  if (blocked) { pass += 1; console.log(`PASS(拦截) ${name}${detail ? ` (${detail})` : ''}`); }
  else { vuln += 1; console.log(`VULN(攻击成功) ${name}${detail ? ` (${detail})` : ''}`); }
}

async function main() {
  const a = await login(USER_A.email, USER_A.password);
  const b = await login(USER_B.email, USER_B.password);
  const dbA = userClient(a.access_token);
  const dbB = userClient(b.access_token);
  const DEFAULT_COHORT_ID = '10000000-0000-4000-8000-000000000102';

  // 教师预写探针 facts/answers（供攻击3使用）
  const probeVersion = `atk-${Date.now()}`;
  await dbB.from('case_snapshot_facts').insert({
    case_id: 'teacher-atk-probe', version: probeVersion, source_name: 'atk-probe',
    facts: { caseId: 'teacher-atk-probe', sections: { history: 'atk', exam: 'atk', tests: 'atk' } },
  });
  await dbB.from('case_snapshot_answers').upsert({
    case_id: 'teacher-atk-probe', version: probeVersion, diagnosis: 'atk-诊断', plan: 'atk-方案', documents: [], media: [],
  }, { onConflict: 'case_id,version' });

  // ===== 攻击3前置：学生逐步自改 stage / 直接自置 completed 解锁 reference =====
  const atk3Session = crypto.randomUUID();
  const atk3State = {
    id: atk3Session, userId: a.user.id, mode: 'guided', caseId: 'teacher-atk-probe', caseVersion: 1,
    sourceSnapshotVersion: probeVersion, stage: 'history', status: 'active',
    messages: [], events: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await dbA.from('training_sessions').insert({
    id: atk3Session, user_id: a.user.id, cohort_id: DEFAULT_COHORT_ID, case_id: 'teacher-atk-probe', case_version: 1,
    mode: 'guided', stage: 'history', status: 'active', state: atk3State,
  });

  // 3a. 训练中直接调 reference（不完成）→ 应被完成态门控拒绝
  const refActive = await dbA.rpc('case_snapshot_get_reference', {
    p_case_id: 'teacher-atk-probe', p_version: probeVersion, p_session_id: atk3Session,
  });
  report('攻击3a：训练中(active)直调get_reference → 拒绝', refActive.data === null, JSON.stringify(refActive.data ?? null));

  // 3b. 跳级一步到位 history→report（active）→ guard 应拦截
  const jump = await dbA.from('training_sessions').update({ stage: 'report' }).eq('id', atk3Session);
  report('攻击3b：active会话stage跳级history→report → guard拦截', Boolean(jump.error), jump.error?.message ?? '');

  // 3c. 逐步推进 stage（history→exam→...→report，每次一格，guard 允许）
  let stepOk = true;
  for (const stage of ['exam', 'tests', 'assessment', 'plan', 'communication', 'report']) {
    const r = await dbA.from('training_sessions').update({ stage }).eq('id', atk3Session);
    if (r.error) { stepOk = false; break; }
  }
  // 逐步推进本身允许（owner_update + 单向有序），记录事实
  const { data: afterSteps } = await dbB.from('training_sessions').select('stage,status').eq('id', atk3Session).maybeSingle();
  console.log(`INFO 攻击3c：学生逐步推进stage（每次一格）${stepOk ? '全部成功' : '中断'}，当前 stage=${afterSteps?.stage} status=${afterSteps?.status}`);

  // 3d. 关键攻击：学生直接自置 status=completed（不经业务 finish 路由）→ 解锁 reference
  const selfComplete = await dbA.from('training_sessions').update({ status: 'completed' }).eq('id', atk3Session);
  const refUnlocked = await dbA.rpc('case_snapshot_get_reference', {
    p_case_id: 'teacher-atk-probe', p_version: probeVersion, p_session_id: atk3Session,
  });
  const unlockedData = refUnlocked.data as { diagnosis?: string } | null;
  const attack3d = !selfComplete.error && unlockedData?.diagnosis === 'atk-诊断';
  report('攻击3d：学生自置completed后直调get_reference提前取诊断 → 拦截', !attack3d,
    `selfComplete=${selfComplete.error ? '被拒' : '成功'}; reference=${JSON.stringify(unlockedData ?? null)}`);

  // 3e. completed 回退 active（二次刷写报告前置）→ guard 应拦截
  const regress = await dbA.from('training_sessions').update({ status: 'active', stage: 'history' }).eq('id', atk3Session);
  report('攻击3e：completed回退active重刷 → guard拦截', Boolean(regress.error), regress.error?.message ?? '');

  // ===== 攻击2：学生直接 UPDATE 本人 state 证据（finish 评分输入） =====
  const atk2Session = crypto.randomUUID();
  const atk2State = {
    id: atk2Session, userId: a.user.id, mode: 'guided', caseId: 'case-bronchiolitis', caseVersion: 1,
    stage: 'history', status: 'active',
    messages: [], events: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await dbA.from('training_sessions').insert({
    id: atk2Session, user_id: a.user.id, cohort_id: DEFAULT_COHORT_ID, case_id: 'case-bronchiolitis', case_version: 1,
    mode: 'guided', stage: 'history', status: 'active', state: atk2State,
  });
  // 学生伪造"完美证据"：向 state 注入伪造的问诊/查体/检查事件与决策（评分输入全在 state 内）
  const forged = await dbA.from('training_sessions').update({
    state: {
      ...atk2State,
      events: [{ type: 'QUESTION', data: { topic: '起病时间' } }, { type: 'EXAM', data: { item: '肺部听诊', correct: true } }],
      decision: { summary: '支气管炎', primaryDiagnosis: 'case-bronchiolitis' },
    },
  }).eq('id', atk2Session);
  const { data: afterForge } = await dbB.from('training_sessions').select('state').eq('id', atk2Session).maybeSingle();
  const forgedState = afterForge?.state as { decision?: { summary?: string } } | null;
  const attack2 = !forged.error && forgedState?.decision?.summary === '支气管炎';
  report('攻击2：学生直接UPDATE本人state注入伪造评分证据 → 拦截', !attack2,
    `update=${forged.error ? '被拒' : '成功'}; 伪造decision已入库=${Boolean(forgedState?.decision?.summary)}`);

  // ===== 攻击1：完成会话后直调 report_save_completed 传自选 100 分 =====
  const atk1Session = crypto.randomUUID();
  const atk1State = {
    id: atk1Session, userId: a.user.id, mode: 'guided', caseId: 'case-bronchiolitis', caseVersion: 1,
    stage: 'report', status: 'completed',
    messages: [], events: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await dbA.from('training_sessions').insert({
    id: atk1Session, user_id: a.user.id, cohort_id: DEFAULT_COHORT_ID, case_id: 'case-bronchiolitis', case_version: 1,
    mode: 'guided', stage: 'report', status: 'completed', state: atk1State,
  });
  const forgedReportId = crypto.randomUUID();
  const saved = await dbA.rpc('report_save_completed', {
    p_report_id: forgedReportId, p_session_id: atk1Session, p_case_id: 'case-bronchiolitis',
    p_mode: 'guided', p_total_score: 100, p_status: 'completed',
    p_data: { forged: true, totalScore: 100 },
  });
  // 用教师读回验证：自选分数是否真的落库
  const { data: forgedRow } = await dbB.from('training_reports').select('total_score').eq('id', forgedReportId).maybeSingle();
  const attack1 = saved.data === true && forgedRow?.total_score === 100;
  report('攻击1：学生直调report_save_completed自选100分落库 → 拦截', !attack1,
    `rpc=${JSON.stringify(saved.data ?? null)}; 落库分数=${forgedRow?.total_score ?? '未落库'}`);

  // ===== 清理探针 =====
  await dbB.from('training_reports').delete().eq('id', forgedReportId);
  await dbB.from('training_sessions').delete().in('id', [atk1Session, atk2Session, atk3Session]);
  await dbB.from('case_snapshot_facts').delete().eq('case_id', 'teacher-atk-probe').eq('version', probeVersion);
  await dbB.from('case_snapshot_answers').delete().eq('case_id', 'teacher-atk-probe').eq('version', probeVersion);

  console.log(`\n结果：拦截 ${pass} / 攻击成功(VULN) ${vuln}`);
  if (vuln > 0) {
    console.log('结论：存在残余攻击面 → 正式评分/可信成绩交付为【阻断项】，练习反馈可保留。');
    process.exit(2);
  }
}

main().catch((error) => {
  console.error('脚本执行失败:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
