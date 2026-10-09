import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveTeacherCaseVersion, type CaseVersionDeps, type VersionResolution } from '@/lib/case-version-select';
import { getCase } from '@/domain/case';
import { getTeacherSourceId } from '@/lib/teacher-case-data';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';

/**
 * 教师病例会话版本选择注入式单测（resolveTeacherCaseVersion 依赖注入，不触真实 DB/召回）：
 * - 完整 DB 版本与部分召回版本并存：优先 DB 完整导入版本（召回不完整不能挡住完整版本）；
 * - 本地完整审核版本存在：权威优先，不查 DB/不回退召回；
 * - 无本地冷启动：绑定 DB 导入版本（coldStart=true）；
 * - 旧会话固定版本：getCase 按绑定版本取事实，版本缺失/不一致返回"资料不足"形态（不漂移）；
 * - 恢复失败不回退：全部来源不可用时 version=null，不绑定漂移数据。
 *
 * 夹具环境（修复 2026-10-10）：此前用例 32 隐性依赖被 .gitignore 排除且沙箱缺失的
 * knowledge/ 目录，且传入从注入式测试复制的假指纹 'localfull0000000001'——永远不等于
 * 本地文件真实 sha256 指纹，导致 sourceFacts 恒为 null 而失败（夹具错误，非业务版本漂移）。
 * 现指向 tests/fixtures/knowledge（纯合成教学数据，无患者内容），并用与
 * computeLocalVersion 相同算法计算夹具真实指纹作为绑定版本。
 */
process.env.PEDIATRICS_KNOWLEDGE_ROOT = path.resolve(process.cwd(), 'tests', 'fixtures', 'knowledge');
const FIXTURE_FILE = path.join(process.env.PEDIATRICS_KNOWLEDGE_ROOT, 'teaching-cases', 'teacher-肾病综合征.json');

/** 与 src/lib/teacher-case-data.ts computeLocalVersion 同算法：documents sha256 聚合哈希截 16 位。 */
function computeFixtureVersion(): string {
  const record = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as { documents: Array<{ sha256: string }> };
  const shas = record.documents.map((doc) => doc.sha256).sort();
  return createHash('sha256').update(shas.join('\n')).digest('hex').slice(0, 16);
}

interface DepState {
  localVersion: string | null;
  dbVersion: string | null;
  recallVersion: string | null;
  restoreCalls: Array<{ caseId: string; version: string; role?: string }>;
  dbQueryCount: number;
  localQueryCount: number;
}

function makeDeps(state: DepState): CaseVersionDeps {
  return {
    getLocalImportVersion: (caseId: string) => {
      state.localQueryCount += 1;
      assert.ok(caseId.startsWith('teacher-'));
      return state.localVersion;
    },
    getSnapshotVersion: () => state.recallVersion,
    getDatabaseSnapshotVersion: async (caseId: string, accessToken: string | null) => {
      assert.ok(accessToken, 'DB 版本解析必须有 accessToken');
      state.dbQueryCount += 1;
      return state.dbVersion;
    },
    restoreCaseSnapshotFacts: async (caseId: string, version: string, _accessToken: string | null, role?: string) => {
      state.restoreCalls.push({ caseId, version, role });
      return {};
    },
  };
}

const CASE_ID = 'teacher-肾病综合征';

async function resolve(state: DepState, role: string, isPreview = false): Promise<VersionResolution> {
  return resolveTeacherCaseVersion(CASE_ID, { accessToken: role ? 'token-1' : null, role, isPreview }, makeDeps(state));
}

test('完整 DB 版本与部分召回版本并存：优先 DB 完整导入版本，学生不预取教师直读', async () => {
  const state: DepState = { localVersion: null, dbVersion: 'dbfull0000000001', recallVersion: 'recall000000001', restoreCalls: [], dbQueryCount: 0, localQueryCount: 0 };
  const result = await resolve(state, 'student');
  assert.equal(result.version, 'dbfull0000000001');
  assert.equal(result.source, 'db');
  assert.equal(result.coldStart, true);
  // 学生不触发教师直读恢复（教师直读仅教师角色）
  assert.equal(state.restoreCalls.length, 0);
  // 召回版本存在但未被选为绑定版本
  assert.equal(result.version, 'dbfull0000000001');
});

test('完整 DB 版本与部分召回版本并存：教师触发直读恢复', async () => {
  const state: DepState = { localVersion: null, dbVersion: 'dbfull0000000002', recallVersion: 'recall000000002', restoreCalls: [], dbQueryCount: 0, localQueryCount: 0 };
  const result = await resolve(state, 'teacher');
  assert.equal(result.version, 'dbfull0000000002');
  assert.equal(result.source, 'db');
  assert.equal(result.coldStart, true);
  assert.equal(state.restoreCalls.length, 1);
  assert.equal(state.restoreCalls[0].role, 'teacher');
  assert.equal(state.restoreCalls[0].version, 'dbfull0000000002');
});

test('本地完整审核版本存在时权威优先：不查 DB、不回退召回', async () => {
  const state: DepState = { localVersion: 'localfull0000001', dbVersion: 'dbfull0000000003', recallVersion: 'recall000000003', restoreCalls: [], dbQueryCount: 0, localQueryCount: 0 };
  const result = await resolve(state, 'student');
  assert.equal(result.version, 'localfull0000001');
  assert.equal(result.source, 'local');
  assert.equal(result.coldStart, false);
  assert.equal(state.dbQueryCount, 0, '本地权威版本存在时不应查询 DB');
  assert.equal(state.restoreCalls.length, 0);
});

test('无本地冷启动：本地与召回均无版本时绑定 DB 导入版本', async () => {
  const state: DepState = { localVersion: null, dbVersion: 'dbonly0000000004', recallVersion: null, restoreCalls: [], dbQueryCount: 0, localQueryCount: 0 };
  const result = await resolve(state, 'student');
  assert.equal(result.version, 'dbonly0000000004');
  assert.equal(result.source, 'db');
  assert.equal(result.coldStart, true);
});

test('DB 与本地均无、仅有召回版本：绑定召回指纹兜底', async () => {
  const state: DepState = { localVersion: null, dbVersion: null, recallVersion: 'recallo000000005', restoreCalls: [], dbQueryCount: 0, localQueryCount: 0 };
  const result = await resolve(state, 'student');
  assert.equal(result.version, 'recallo000000005');
  assert.equal(result.source, 'recall');
  assert.equal(result.coldStart, false);
});

test('恢复失败不回退：全部来源不可用返回 null（资料不足，不绑定漂移数据）', async () => {
  const state: DepState = { localVersion: null, dbVersion: null, recallVersion: null, restoreCalls: [], dbQueryCount: 0, localQueryCount: 0 };
  const result = await resolve(state, 'student');
  assert.equal(result.version, null);
  assert.equal(result.source, null);
  assert.equal(result.coldStart, false);
});

test('预览身份不查询 DB 版本（预览走进程内存，不触碰数据库）', async () => {
  const state: DepState = { localVersion: null, dbVersion: 'dbprev0000000006', recallVersion: null, restoreCalls: [], dbQueryCount: 0, localQueryCount: 0 };
  const result = await resolve(state, 'student', true);
  assert.equal(result.version, null);
  assert.equal(state.dbQueryCount, 0);
});

test('旧会话固定版本：getCase 按绑定版本取事实，版本不一致返回资料不足形态', () => {
  // 夹具真实指纹（与 computeLocalVersion 同算法计算）作为"本地权威版本一致"的绑定版本
  const FIXTURE_VERSION = computeFixtureVersion();
  const withVersion = getCase(CASE_ID, FIXTURE_VERSION);
  assert.ok(withVersion.sourceFacts, '绑定版本与本地权威版本一致时 sourceFacts 完整');
  assert.equal(withVersion.sourceFacts?.caseId, 'teacher-肾病综合征', 'sourceFacts 来自绑定的本地事实');
  // 版本不一致（本地内容已修订/未知指纹）：不回退新版本地数据换患者事实——
  // readTeacherCaseData 查 getCachedSnapshot 无该版本缓存返回 null，sourceFacts 保持资料不足
  const unknownVersion = getCase(CASE_ID, 'zzzz000000000009');
  assert.equal(unknownVersion.sourceFacts, null, '版本不一致时 sourceFacts 必须为 null（资料不足，不漂移）');
  assert.equal(unknownVersion.version, 2);
  assert.ok(unknownVersion, 'getCase 不因传入未知版本而抛错，返回结构完整');
  // 无绑定版本（新会话首次加载）：直接使用本地当前权威版本
  const unbound = getCase(CASE_ID, null);
  assert.ok(unbound.sourceFacts, '无绑定版本时使用本地当前权威版本（新会话选当前有效版本）');
});

test('旧会话版本漂移防护：绑定的召回指纹缓存缺失时不回退其他版本', () => {
  // getCachedSnapshot 语义：版本提供且缓存不命中时返回 null（不回退裸键漂移数据）
  // 通过 getCase 间接验证：未知版本下 exams 仍来自本地文件而非其他版本的缓存
  const unknown = getCase(CASE_ID, 'unknown0000000009');
  assert.equal(typeof unknown.triage, 'string');
  assert.ok(unknown.exams.length >= 1);
});

test('别名映射一致性：caseId 经 TEACHER_CASE_LINKS 解析到唯一 sourceId（版本缓存键不串）', () => {
  // 每个映射的 sourceId 都存在于 catalog（folder 有效），别名/子类型经 getTeacherSourceId 归一到同一源；
  // 未映射的 caseId 解析为自身（decodeURIComponent）。同源别名共用同一 sourceId@version 缓存键，
  // 不同病例（不同 sourceId）缓存键天然隔离——版本缓存不串。
  // 多对一映射（多个别名指向同一 sourceId）是有意设计，不视为歧义。
  for (const [aliasCaseId, link] of Object.entries(TEACHER_CASE_LINKS)) {
    assert.ok(TEACHER_CASE_CATALOG.some((item) => item.id === link.sourceId && item.folder), `映射目标必须存在于 catalog：${link.sourceId}`);
    assert.equal(getTeacherSourceId(aliasCaseId), link.sourceId, `别名解析必须稳定：${aliasCaseId}`);
    // 映射目标不得再是另一条映射的键（解析链无二级跳转，保证一次解析即最终 sourceId）
    assert.ok(!(link.sourceId in TEACHER_CASE_LINKS), `映射目标不得再被映射（无映射链）：${link.sourceId}`);
    assert.notEqual(link.sourceId, aliasCaseId, `映射必须改变 caseId（无自环）：${aliasCaseId}`);
  }
  assert.equal(getTeacherSourceId(CASE_ID), 'teacher-肾病综合征', '未映射 caseId 解析为自身（decodeURIComponent）');
});
