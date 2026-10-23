/* eslint-disable no-console */
/**
 * 旧会话固定版本冷启动恢复验证（阶段 A：合成 HTTP 上游，全部子进程真实独立执行）。
 *
 * 场景模型（与生产修订链路同构）：
 * 1) 教师病例本地 V1（tests/fixtures 合成夹具原样）曾导入 DB（facts+answers 双行）；
 * 2) 本地修订为 V2（只改年龄/病史，原文与其哈希不变）并再次导入，DB 保有旧原件指纹V1/内容指纹V2；
 * 3) 旧会话绑定 V1：本地已是 V2、进程重启（子进程 spawn=空缓存）后，
 *    旧会话必须按 V1 绑定版本从 DB 恢复 facts/answers，不换成 V2 患者；
 * 4) 新会话必须绑定当前已发布版本（本地存在=V2；本地缺失=冷启动绑 DB 最新版本）；
 * 5) 缺失绑定版本 / 会话归属不匹配 → 明确资料不足（null），不以新版代替、不放行。
 *
 * 上游与安全边界：
 * - 合成 HTTP 上游仅监听 127.0.0.1，模拟 PostgREST 协议（rest/v1 表查询 + rpc），
 *   仅实现本项目真实使用的 5 个端点；真实 RLS/RPC 校验由阶段 B 真实平台测试覆盖；
 * - 子进程环境显式剔除 CODER_SUPABASE_*（平台注入的真实平台地址优先级高于 COZE_*，
 *   必须删除才能保证仅指向本地上游），并剔除 CODER_CODING_*（禁用知识库召回）；
 * - 令牌为字面量 'synthetic-token'（非 JWT），仅上游自校验；
 * - 输出仅结构性字段与指纹前缀，不输出病例内容。
 *
 * 运行：pnpm tsx scripts/verify-coldstart-restore.ts
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCaseDataVersion } from '../src/lib/case-data-version';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASE_ID = 'teacher-肾病综合征';
const SYNTH_USER_ID = '00000000-0000-0000-0000-0000000000aa';
const SYNTH_TOKEN = 'synthetic-token';
const SESSION_V1 = '11111111-1111-1111-1111-111111111111'; // 旧会话：绑定 V1
const SESSION_V2 = '33333333-3333-3333-3333-333333333333'; // 新会话：绑定 V2（missinglocal 场景）
const SESSION_PROJ = '44444444-4444-4444-4444-444444444444'; // 阶段化投影场景：RPC 剥离 exam/tests（模拟未解锁查体/检查）
const SESSION_A_FULL = '55555555-5555-5555-5555-555555555555'; // 双会话交叉污染：已解锁会话 A（RPC 返回完整投影）
const FOREIGN_SESSION = '22222222-2222-2222-2222-222222222222'; // 不存在/非本人会话：必须拒绝

/** Shared content contract; unchanged source documents must not conceal field edits. */
function computeVersion(record: CaseRecord): string {
  return computeCaseDataVersion(record);
}

/** 与 buildFactsPayloadForInit 同形态的教学事实子集（不含诊断/原文/媒体）。 */
function buildFacts(record: CaseRecord): FactsPayload {
  return {
    caseId: record.caseId,
    sourceName: record.sourceName,
    sourceDocument: record.sourceDocument,
    age: record.age,
    sex: record.sex,
    complaint: record.complaint,
    sections: { history: record.sections.history, exam: record.sections.exam, tests: record.sections.tests },
    vitals: record.vitals,
  };
}

// ---------- 合成数据（全部源自合成夹具，非真实病例） ----------
interface Doc { source: string; text: string; sha256: string }
interface CaseRecord {
  caseId: string; sourceName: string; sourceDocument: string;
  age: string; sex: string; complaint: string;
  sections: { history: string; exam: string; tests: string; diagnosis: string; plan: string };
  vitals: { temperature: number | null; heartRate: number | null; respiratoryRate: number | null; spo2: number | null };
  documents: Doc[];
}
interface FactsPayload {
  caseId: string; sourceName: string; sourceDocument: string;
  age: string; sex: string; complaint: string;
  sections: { history: string; exam: string; tests: string };
  vitals: CaseRecord['vitals'];
}

const fixturePath = path.join(PROJECT_ROOT, 'tests/fixtures/knowledge/teaching-cases/teacher-肾病综合征.json');
const v1 = JSON.parse(readFileSync(fixturePath, 'utf8')) as CaseRecord;
// V2 only changes fixed facts; the original documents intentionally stay unchanged.
const v2: CaseRecord = {
  ...v1,
  age: '7岁',
  complaint: v1.complaint.replace('5天', '6天'),
  sections: {
    ...v1.sections,
    history: v1.sections.history.replace('6岁', '7岁').replace('5天', '6天'),
  },
  documents: v1.documents,
};
// Historical sessions keep their legacy document-only key; no alias to local v2.
const V1 = createHash('sha256').update(v1.documents.map(doc => doc.sha256).sort().join('\n')).digest('hex').slice(0, 16);
const V2 = computeVersion(v2);
const V1_DIAG_SHA = createHash('sha256').update(v1.sections.diagnosis).digest('hex').slice(0, 12);

// ---------- 合成 PostgREST 上游（仅 127.0.0.1，仅本项目真实使用的端点） ----------
const factsRows = new Map<string, FactsPayload>([
  [`${CASE_ID}|${V1}`, buildFacts(v1)],
  [`${CASE_ID}|${V2}`, buildFacts(v2)],
]);
const answersRows = new Map<string, { diagnosis: string; plan: string }>([
  [`${CASE_ID}|${V1}`, { diagnosis: v1.sections.diagnosis, plan: v1.sections.plan }],
  [`${CASE_ID}|${V2}`, { diagnosis: v2.sections.diagnosis, plan: v2.sections.plan }],
]);
/** 会话归属+版本绑定+病例匹配（对应真实 RPC 的三重校验；失败返回 null）。 */
const sessionOwners = new Map<string, { userId: string; caseId: string; version: string }>([
  [SESSION_V1, { userId: SYNTH_USER_ID, caseId: CASE_ID, version: V1 }],
  [SESSION_V2, { userId: SYNTH_USER_ID, caseId: CASE_ID, version: V2 }],
  [SESSION_PROJ, { userId: SYNTH_USER_ID, caseId: CASE_ID, version: V1 }],
  [SESSION_A_FULL, { userId: SYNTH_USER_ID, caseId: CASE_ID, version: V1 }],
]);

const requestLog: Array<{ method: string; path: string; authed: boolean }> = [];

function eqFilter(value: string | null): string {
  return value?.startsWith('eq.') ? value.slice(3) : value ?? '';
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}));
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const authed = req.headers.authorization === `Bearer ${SYNTH_TOKEN}`;
  requestLog.push({ method: req.method ?? '', path: url.pathname, authed });
  const json = (payload: unknown, status = 200): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  if (!authed) return json({ message: 'unauthorized' }, 401);
  const body = await readBody(req);
  const rpcName = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
  if (req.method === 'POST' && rpcName) {
    const p = body as { p_case_id?: string; p_version?: string; p_session_id?: string };
    const owner = p.p_session_id ? sessionOwners.get(p.p_session_id) : undefined;
    const owned = Boolean(owner
      && owner.userId === SYNTH_USER_ID
      && owner.caseId === p.p_case_id
      && owner.version === p.p_version);
    if (rpcName === 'case_snapshot_get_facts') {
      const facts = p.p_case_id && p.p_version ? factsRows.get(`${p.p_case_id}|${p.p_version}`) : undefined;
      if (owned && facts) {
        // 阶段化投影（真实迁移 20261010120000 语义）：SESSION_PROJ 模拟"未执行查体/开检查"
        // 的训练中会话——sections.exam/tests 被安全剥离，diagnosis/plan 永不返回
        if (p.p_session_id === SESSION_PROJ) {
          const projected = { ...facts, sections: { ...facts.sections } } as FactsPayload;
          const sections = projected.sections as Partial<Record<'history' | 'exam' | 'tests', string>>;
          delete sections.exam;
          delete sections.tests;
          return json(projected);
        }
        return json(facts);
      }
      return json(null);
    }
    if (rpcName === 'case_snapshot_get_reference') {
      const answers = p.p_case_id && p.p_version ? answersRows.get(`${p.p_case_id}|${p.p_version}`) : undefined;
      return json(owned && answers ? answers : null);
    }
    if (rpcName === 'case_snapshot_latest_version') return json(V2);
    return json({ message: 'unknown rpc' }, 404);
  }
  if (req.method === 'GET' && url.pathname === '/rest/v1/case_snapshot_facts') {
    const facts = factsRows.get(`${eqFilter(url.searchParams.get('case_id'))}|${eqFilter(url.searchParams.get('version'))}`);
    return json(facts ? [{ facts }] : []);
  }
  if (req.method === 'GET' && url.pathname === '/rest/v1/case_snapshot_answers') {
    const answers = answersRows.get(`${eqFilter(url.searchParams.get('case_id'))}|${eqFilter(url.searchParams.get('version'))}`);
    return json(answers ? [{ ...answers }] : []);
  }
  return json({ message: 'not found' }, 404);
}

// ---------- 子进程执行（每条指令独立新进程 = 真实重启语义） ----------
const tempRoot = mkdtempSync(path.join(tmpdir(), 'coldstart-verify-'));
const v2Root = path.join(tempRoot, 'v2local');
const emptyRoot = path.join(tempRoot, 'emptylocal');
mkdirSync(path.join(v2Root, 'teaching-cases'), { recursive: true });
mkdirSync(emptyRoot, { recursive: true });
writeFileSync(path.join(v2Root, 'teaching-cases', `${CASE_ID}.json`), JSON.stringify(v2, null, 2), 'utf8');

interface ChildSummary { cmd: string; ok?: boolean; error?: string; [key: string]: unknown }

function runChild(cmd: string, fixtureRoot: string, sessionId: string): Promise<ChildSummary> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env };
    // 剔除真实平台注入（CODER_* 优先级高于 COZE_*，必须删除才能仅指向本地上游）；禁用知识库召回
    for (const key of [
      'CODER_SUPABASE_URL', 'CODER_SUPABASE_ANON_KEY', 'CODER_SUPABASE_TENANT_ID',
      'COZE_SUPABASE_URL', 'COZE_SUPABASE_ANON_KEY', 'COZE_SUPABASE_TENANT_ID',
      'CODER_CODING_API_KEY', 'CODER_CODING_BASE_URL', 'PEDIATRICS_KNOWLEDGE_ROOT',
    ]) delete env[key];
    env.FIXTURE_ROOT = fixtureRoot;
    env.V1 = V1;
    env.V2 = V2;
    env.SESSION_ID = sessionId;
    env.V1_DIAG_SHA = V1_DIAG_SHA;
    env.V1_AGE = v1.age;
    env.V1_EXAM_MARK = v1.sections.exam.slice(0, 10);
    env.V1_TESTS_MARK = v1.sections.tests.slice(0, 10);
    env.COZE_SUPABASE_URL = `http://127.0.0.1:${port}`;
    env.COZE_SUPABASE_ANON_KEY = 'synthetic-anon-key';
    env.COZE_SUPABASE_TENANT_ID = 'synthetic-tenant';
    const tsxCli = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const child = spawn(process.execPath, [tsxCli, 'scripts/coldstart-child.ts', cmd], {
      cwd: PROJECT_ROOT,
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: Buffer) => { process.stderr.write(chunk); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = stdout.trim().split('\n').filter(Boolean).pop();
      if (!line) return reject(new Error(`child ${cmd} 无输出（exit ${code}）`));
      try { resolve(JSON.parse(line) as ChildSummary); } catch {
        reject(new Error(`child ${cmd} 输出非 JSON：${line.slice(0, 160)}`));
      }
    });
  });
}

// ---------- 断言与汇总 ----------
interface Check { name: string; pass: boolean }
const checks: Check[] = [];
function check(name: string, pass: boolean): void {
  checks.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
}

const server = createServer((req, res) => { void handle(req, res); });
let port = 0;

async function main(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  console.log(`合成上游 127.0.0.1:${port}（V1=${V1} / V2=${V2}）`);

  // 场景 1：本地已修订为 V2，新进程绑定版本读取应为空（资料不足，不以 V2 代替）
  const restore = await runChild('restore', v2Root, SESSION_V1);
  console.log(`[restore] ${JSON.stringify(restore)}`);
  check('旧会话恢复：新进程空缓存下按 V1 读取本地=资料不足（beforeNull）', restore.beforeNull === true);
  check('旧会话恢复：教师直读路径恢复 V1 事实（teacherRestored）', restore.teacherRestored === true);
  check('旧会话恢复：恢复后按 V1 绑定版本读取成功（afterRestored）', restore.afterRestored === true);
  check('旧会话恢复：恢复事实为 V1 年龄而非 V2（afterAge=V1）', restore.afterAge === v1.age);
  check('旧会话恢复：恢复态为 facts 子集（documents 为空）', restore.afterDocsCount === 0);
  check('旧会话恢复：学生受控 RPC 恢复 V1（studentRpcRestored）', restore.studentRpcRestored === true);
  check('旧会话恢复：会话归属不匹配被 RPC 拒绝（wrongSessionRejected）', restore.wrongSessionRejected === true);
  check('旧会话恢复：评分对照恢复且与 V1 版本行一致（referenceV1Match）', restore.referenceV1Match === true);

  // 场景 2：同源 V1/V2 版本键缓存隔离
  const v1v2 = await runChild('v1v2', v2Root, SESSION_V1);
  console.log(`[v1v2] ${JSON.stringify(v1v2)}`);
  check('V1/V2 缓存隔离：两版本均可读（bothPresent）', v1v2.bothPresent === true);
  check('V1/V2 缓存隔离：V1 缓存为 V1 年龄（v1Age）', v1v2.v1Age === v1.age);
  check('V1/V2 缓存隔离：V2 本地为 V2 年龄（v2Age）', v1v2.v2Age === v2.age);
  check('V1/V2 缓存隔离：V1 恢复态无分片/本地 V2 完整（v1Docs=0, v2Docs=2）', v1v2.v1Docs === 0 && v1v2.v2Docs === v2.documents.length);
  check('V1/V2 缓存隔离：两版本事实不串（notCrossed）', v1v2.notCrossed === true);

  // 场景 3：缺失绑定版本 → 资料不足
  const missing = await runChild('missing', v2Root, SESSION_V1);
  console.log(`[missing] ${JSON.stringify(missing)}`);
  check('缺失绑定版本：明确资料不足不代新版（missingNull）', missing.missingNull === true);

  // 场景 4：本地缺失冷启动 → 绑定 DB 当前已发布版本并恢复
  const missinglocal = await runChild('missinglocal', emptyRoot, SESSION_V2);
  console.log(`[missinglocal] ${JSON.stringify(missinglocal)}`);
  check('本地缺失冷启动：本地版本指纹为空（localVersionNull）', missinglocal.localVersionNull === true);
  check('本地缺失冷启动：版本解析绑定 DB（source=db, coldStart）', missinglocal.isDb === true && missinglocal.coldStart === true);
  check('本地缺失冷启动：绑定版本=当前已发布 V2（version=V2）', missinglocal.version === V2);
  check('本地缺失冷启动：按绑定版本经 RPC 恢复事实（restored）', missinglocal.restored === true);
  check('本地缺失冷启动：恢复后按绑定版本读取成功（afterRestored）', missinglocal.afterRestored === true);

  // 场景 5：本地存在时新会话版本解析 → 权威本地版本（当前已发布）
  const resolve = await runChild('resolve', v2Root, SESSION_V1);
  console.log(`[resolve] ${JSON.stringify(resolve)}`);
  check('新会话版本解析：绑定本地权威版本 V2（source=local）', resolve.source === 'local' && resolve.version === V2);
  check('新会话版本解析：使用当前已发布版本（isCurrent）', resolve.isCurrent === true);

  // 场景 6：引擎层新会话形态（不绑定版本，绑定发生在 repository resolve 之后）
  const newsession = await runChild('newsession', v2Root, SESSION_V1);
  console.log(`[newsession] ${JSON.stringify(newsession)}`);
  check('引擎层新会话：病例与开场消息形态正常（triageOk）', newsession.caseId === CASE_ID && newsession.triageOk === true);
  check('引擎层新会话：引擎层不绑定版本（engineNoVersion）', newsession.engineNoVersion === true);

  // 场景 9：阶段化投影剥离（真实迁移 20261010120000 语义）——RPC 剥离 exam/tests 后恢复态必须可读
  const projected = await runChild('projected', v2Root, SESSION_PROJ);
  console.log(`[projected] ${JSON.stringify(projected)}`);
  check('投影剥离：RPC 剥离 exam/tests 后恢复成功（rpcRestored）', projected.rpcRestored === true);
  check('投影剥离：规范化缺键后 readTeacherCaseData 可读（normalizedReadable）', projected.normalizedReadable === true);
  check('投影剥离：exam/tests 规范化为空串（examEmpty/testsEmpty）', projected.examEmpty === true && projected.testsEmpty === true);
  check('投影剥离：未剥离字段保留（historyKept/ageKept）', projected.historyKept === true && projected.ageKept === true);

  // 场景 10：双会话交叉污染（顺序 AB：A已解锁先恢复，B未解锁后恢复）
  const crossAB = await runChild('crosssessionAB', v2Root, SESSION_V1);
  console.log(`[crosssessionAB] ${JSON.stringify(crossAB)}`);
  check('双会话AB：A完整投影未因B恢复丢失（aNotLost/aExamKept/aTestsKept）', crossAB.aNotLost === true && crossAB.aExamKept === true && crossAB.aTestsKept === true);
  check('双会话AB：B剥离态未因A恢复泄露（bNotLeaked）', crossAB.bNotLeaked === true);
  check('双会话AB：共享版本键未被学生投影态污染（sharedClean）', crossAB.sharedClean === true);

  // 场景 11：双会话交叉污染（顺序 BA：B未解锁先恢复，A已解锁后恢复）
  const crossBA = await runChild('crosssessionBA', v2Root, SESSION_V1);
  console.log(`[crosssessionBA] ${JSON.stringify(crossBA)}`);
  check('双会话BA：A完整投影未因B恢复丢失（aNotLost/aExamKept/aTestsKept）', crossBA.aNotLost === true && crossBA.aExamKept === true && crossBA.aTestsKept === true);
  check('双会话BA：B剥离态未因A恢复泄露（bNotLeaked）', crossBA.bNotLeaked === true);
  check('双会话BA：共享版本键未被学生投影态污染（sharedClean）', crossBA.sharedClean === true);

  // 场景 12：旧会话绑定 V1 的评分链路（本地已是 V2）：事实与对照均来自 V1，非生成式过程分口径
  const score = await runChild('score', v2Root, SESSION_A_FULL);
  console.log(`[score] ${JSON.stringify(score)}`);
  check('V1评分：RPC 恢复 V1 事实（factsRestored）', score.factsRestored === true);
  check('V1评分：评分对照为 V1 版本行（referenceV1Match）', score.referenceRestored === true && score.referenceV1Match === true);
  check('V1评分：评分事实为 V1 年龄而非本地 V2（factsIsV1）', score.factsIsV1 === true);
  check('V1评分：teacher 病例走过程分口径（scoreBasis=process）', score.scoreBasis === 'process');

  // 场景 13：无有效事实会话（版本解析失败，本地缺失）→ 非生成式过程分兜底，不补造对照
  const scoremissing = await runChild('scoremissing', emptyRoot, SESSION_V1);
  console.log(`[scoremissing] ${JSON.stringify(scoremissing)}`);
  check('无事实评分：非生成式过程分口径（scoreBasis=process）', scoremissing.scoreBasis === 'process');
  check('无事实评分：六维全 0 不生成事实评分（allZero）', scoremissing.allZero === true);
  check('无事实评分：无诊断/处置对照回填（noReference）', scoremissing.noReference === true);

  // 场景 7：别名（URL 编码）解析一致
  const alias = await runChild('alias', v2Root, SESSION_V1);
  console.log(`[alias] ${JSON.stringify(alias)}`);
  check('别名解析：直接与解码一致（stable）', alias.stable === true);

  // 场景 8：本地版本指纹绑定（bind）
  const bind = await runChild('bind', v2Root, SESSION_V1);
  console.log(`[bind] ${JSON.stringify(bind)}`);
  check('本地绑定：当前本地版本指纹=V2（bind）', bind.version === V2);

  // 上游卫生断言
  check('上游卫生：全部请求携带合成令牌', requestLog.length > 0 && requestLog.every((r) => r.authed));
  check('上游卫生：无未实现端点被请求（无 404 路径）', requestLog.every((r) => !r.path.includes('unknown')));

  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n==== 合成上游冷启动恢复验证：${checks.length - failed}/${checks.length} 通过，上游请求数 ${requestLog.length} ====`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error('验证脚本异常：', error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.close();
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结果 */ }
  });
