import assert from 'node:assert/strict';
import test from 'node:test';
import { CASE_CATALOG } from '../src/domain/case-catalog';
import {
  classifyCase,
  isScorableCase,
  listSubjects,
  normalizeCategory,
  PAGE_SIZE,
  readRecentSelection,
  recentKey,
  searchCases,
  writeRecentSelection,
} from '../src/domain/case-classification';
import type { PublicCaseProfile } from '../src/domain/case-catalog';

/** 病例库七项重构：多维分类/搜索分页/资料完备度/最近选择隔离（纯函数域测试）。 */

test('学科归一：5 对同义分类合并，目录分类数收敛', () => {
  const subjects = listSubjects(CASE_CATALOG);
  assert.ok(!subjects.includes('内分泌系统'));
  assert.ok(!subjects.includes('心血管系统'));
  assert.ok(!subjects.includes('新生儿疾病'));
  assert.ok(!subjects.includes('神经系统疾病'));
  assert.ok(!subjects.includes('血液系统疾病'));
  assert.ok(subjects.includes('内分泌疾病'));
  assert.ok(subjects.includes('新生儿与新生儿疾病'));
});

test('资料完备度三档：53 原件来源 + 14 关联来源', () => {
  const classified = CASE_CATALOG.map(classifyCase);
  const independent = classified.filter((item) => item.readiness.readiness === 'independent').length;
  const linked = classified.filter((item) => item.readiness.readiness === 'linked').length;
  const insufficient = classified.filter((item) => item.readiness.readiness === 'insufficient');
  assert.equal(independent, 53); // 53 教师独立 folder 项（合成演示病例 2026-10-29 退役，不入目录）
  assert.equal(linked, 14);
  assert.equal(insufficient.length, 0);

});

test('可评分守卫：明确就绪的演示与材料病例可进入训练，资料不足状态仍拒绝', () => {
  for (const profile of CASE_CATALOG) {
    const insufficient = classifyCase(profile).readiness.readiness === 'insufficient';
    assert.equal(isScorableCase(profile), !insufficient, profile.id);
  }
});

test('搜索分页：病例库默认 9/页，页数正确', () => {
  assert.equal(PAGE_SIZE, 9);
  const result = searchCases(CASE_CATALOG, { keyword: '', subject: 'all', readiness: 'all', page: 1 });
  assert.equal(result.total, CASE_CATALOG.length);
  assert.equal(result.items.length, PAGE_SIZE);
  assert.equal(result.pageCount, Math.ceil(CASE_CATALOG.length / PAGE_SIZE));
});

test('九宫格分页：相邻页不重复，末页保留全部余项', () => {
  const first = searchCases(CASE_CATALOG, { keyword: '', subject: 'all', readiness: 'all', page: 1 });
  const second = searchCases(CASE_CATALOG, { keyword: '', subject: 'all', readiness: 'all', page: 2 });
  assert.equal(second.items.length, 9);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 18);
  const last = searchCases(CASE_CATALOG, { keyword: '', subject: 'all', readiness: 'all', page: first.pageCount });
  assert.equal(last.items.length, CASE_CATALOG.length - (first.pageCount - 1) * 9);
});

test('搜索分页：关键词 + 学科 + 来源组合筛选', () => {
  // 防透题收敛：病种关键词（如「肺炎」）不再可搜索；症状关键词仅命中开放主诉文本
  const byDisease = searchCases(CASE_CATALOG, { keyword: '肺炎', subject: 'all', readiness: 'all', page: 1 });
  assert.equal(byDisease.total, 0, '病种关键词不再出现在可搜索文本中（防透题）');
  // 合成演示病例退役后，以目录中任一开放主诉真实病例为探针，按其学科与来源档位组合筛选
  const probe = CASE_CATALOG.find((item) => item.presentingSymptoms.length > 0);
  assert.ok(probe, '目录中存在开放主诉的可检索病例');
  const probeSubject = normalizeCategory(probe.category);
  const probeReadiness = classifyCase(probe).readiness.readiness;
  const keyword = probe.presentingSymptoms[0];
  const result = searchCases(CASE_CATALOG, { keyword, subject: probeSubject, readiness: probeReadiness, page: 1 });
  assert.ok(result.total >= 1, '症状关键词命中真实病例主诉');
  for (const item of result.items) {
    assert.equal(item.classification.subject, probeSubject);
    assert.equal(item.classification.readiness.readiness, probeReadiness);
    assert.ok(item.classification.searchableText.includes(keyword.toLowerCase()));
  }
});

test('防透题：教师病例标题与可搜索文本不含病种名', () => {
  const teacherCases = CASE_CATALOG.filter((item) => item.id.startsWith('case-'));
  assert.ok(teacherCases.length >= 50);
  for (const profile of teacherCases) {
    if (profile.presentingSymptoms.length) {
      assert.equal(profile.presentingSymptoms.length, 1, '仅开放主诉，不预置完整症状清单');
      assert.ok(profile.title.includes(profile.age));
      assert.ok(profile.title.includes(profile.presentingSymptoms[0]));
      assert.ok(!/诊断|住院号|teacher-/.test(profile.title));
    } else {
      assert.ok(/(真实|教学模拟)病例 \d{2}$/.test(profile.title), '缺少主诉时保留中性名称');
    }
  }
});

test('搜索分页：无结果显示空页且不越界', () => {
  const result = searchCases(CASE_CATALOG, { keyword: '不存在的病名xyz', subject: 'all', readiness: 'all', page: 1 });
  assert.equal(result.total, 0);
  assert.equal(result.items.length, 0);
  assert.equal(result.pageCount, 1); // 保底单页，避免空目录无分页
  assert.equal(result.page, 1);
});

test('搜索分页：请求越界页码收敛到末页', () => {
  const pageCount = Math.ceil(CASE_CATALOG.length / PAGE_SIZE);
  const result = searchCases(CASE_CATALOG, { keyword: '', subject: 'all', readiness: 'all', page: 999 });
  assert.equal(result.page, pageCount);
  assert.ok(result.items.length > 0);
});

test('目录不再含已退役合成演示病例', () => {
  assert.ok(!CASE_CATALOG.some((item) => item.id === 'peds-respiratory-001'));
  assert.ok(!CASE_CATALOG.some((item) => item.id === 'peds-wheeze-002'));
});

test('最近选择：键按用户隔离，读写互不泄露', () => {
  const storage = new Map<string, string>();
  const shim: Storage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  const alice = 'user-alice';
  const bob = 'user-bob';
  assert.notEqual(recentKey(alice), recentKey(bob));
  writeRecentSelection(shim, alice, 'teacher-新生儿败血症');
  writeRecentSelection(shim, alice, 'peds-respiratory-001');
  assert.equal(readRecentSelection(shim, bob).length, 0, '其他账号读不到他人最近记录');
  assert.deepEqual(readRecentSelection(shim, alice), ['peds-respiratory-001', 'teacher-新生儿败血症']);
  assert.ok([...storage.keys()].every((k) => k.startsWith('case-library-recent:')), '存储键均带用户前缀');
});

test('最近选择：容量 6 上限、去重置顶、损坏数据降级为空', () => {
  const storage = new Map<string, string>();
  const shim: Storage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  const user = 'user-x';
  for (let index = 0; index < 8; index += 1) writeRecentSelection(shim, user, `case-${index}`);
  let list = readRecentSelection(shim, user);
  assert.equal(list.length, 6);
  assert.equal(list[0], 'case-7');
  writeRecentSelection(shim, user, 'case-7'); // 重复选择置顶不重复
  list = readRecentSelection(shim, user);
  assert.equal(list.filter((id) => id === 'case-7').length, 1);
  storage.set(recentKey(user), '{corrupted'); // 损坏数据安全降级
  assert.deepEqual(readRecentSelection(shim, user), []);
});

test('搜索文本包含标题/学科/主诉（大小写不敏感由调用方保证 lower）', () => {
  const profile = CASE_CATALOG.find((item) => item.presentingSymptoms.length > 0)!;
  const text = classifyCase(profile).searchableText;
  assert.ok(text.includes(profile.title.toLowerCase()));
  assert.ok(text.includes(normalizeCategory(profile.category).toLowerCase()));
  assert.ok(text.includes(profile.presentingSymptoms[0].toLowerCase()));
});
