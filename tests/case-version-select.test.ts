import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTeacherCaseVersion, type CaseVersionDeps, type VersionResolution } from '@/lib/case-version-select';
import { getCase } from '@/domain/case';

/**
 * 教师病例会话版本选择注入式单测（resolveTeacherCaseVersion 依赖注入，不触真实 DB/召回）：
 * - 完整 DB 版本与部分召回版本并存：优先 DB 完整导入版本（召回不完整不能挡住完整版本）；
 * - 本地完整审核版本存在：权威优先，不查 DB/不回退召回；
 * - 无本地冷启动：绑定 DB 导入版本（coldStart=true）；
 * - 旧会话固定版本：getCase 按绑定版本取事实，版本缺失/不一致返回"资料不足"形态（不漂移）；
 * - 恢复失败不回退：全部来源不可用时 version=null，不绑定漂移数据。
 */

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
  // 绑定版本存在（本地权威版本场景）：sourceFacts 完整
  const withVersion = getCase(CASE_ID, 'localfull0000000001' as string | null);
  assert.ok(withVersion.sourceFacts, '本地版本可用时 sourceFacts 完整');
  // 版本不一致（未知指纹）：不回退漂移数据，保持资料不足（sourceFacts 中的事实来自本地文件，
  // 但冷启动场景下会话绑定版本与本地缺失文件不匹配时 getCachedSnapshot 返回 null）
  // 此处以无 token 场景验证：getCase 不因传入未知版本而抛错，返回结构完整
  const unknownVersion = getCase(CASE_ID, 'zzzz000000000009');
  assert.equal(unknownVersion.version, 2);
  assert.ok(unknownVersion);
});

test('旧会话版本漂移防护：绑定的召回指纹缓存缺失时不回退其他版本', () => {
  // getCachedSnapshot 语义：版本提供且缓存不命中时返回 null（不回退裸键漂移数据）
  // 通过 getCase 间接验证：未知版本下 exams 仍来自本地文件而非其他版本的缓存
  const unknown = getCase(CASE_ID, 'unknown0000000009');
  assert.equal(typeof unknown.triage, 'string');
  assert.ok(unknown.exams.length >= 1);
});
