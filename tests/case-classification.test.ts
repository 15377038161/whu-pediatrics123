import { publicCaseId } from '../src/lib/case-identity';
import assert from 'node:assert/strict';
import test from 'node:test';
import { CASE_CATALOG } from '../src/domain/case-catalog';
import {
  classifyCase,
  isScorableCase,
  listSubjects,
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

test('资料完备度三档：53 独立来源 + 14 关联来源 + 3 资料不足 + 2 演示独立', () => {
  const classified = CASE_CATALOG.map(classifyCase);
  const independent = classified.filter((item) => item.readiness.readiness === 'independent').length;
  const linked = classified.filter((item) => item.readiness.readiness === 'linked').length;
  const insufficient = classified.filter((item) => item.readiness.readiness === 'insufficient');
  assert.equal(independent, 55); // 53 教师独立 folder 项 + 2 演示病例
  assert.equal(linked, 14);
  assert.equal(insufficient.length, 3);
  // 防透题收敛：insufficient 判定按 id 断言（病种名不再进入分类模块）
  // 防透题收敛：insufficient 判定按 id 断言（病种名不再进入分类模块）
  assert.deepEqual(
    CASE_CATALOG.filter((item) => classifyCase(item).readiness.readiness === 'insufficient').map((item) => item.id).sort(),
    ['teacher-新生儿脑梗死', 'teacher-支气管肺炎', 'teacher-格林巴利综合征'].map(publicCaseId).sort(),
  );
});

test('可评分守卫：3 项资料不足不可评分，其余可评分', () => {
  for (const profile of CASE_CATALOG) {
    const insufficient = classifyCase(profile).readiness.readiness === 'insufficient';
    assert.equal(isScorableCase(profile), !insufficient, profile.id);
  }
});

test('搜索分页：72 项默认 12/页，页数正确', () => {
  const result = searchCases(CASE_CATALOG, { keyword: '', subject: 'all', readiness: 'all', page: 1 });
  assert.equal(result.total, CASE_CATALOG.length);
  assert.equal(result.items.length, PAGE_SIZE);
  assert.equal(result.pageCount, Math.ceil(CASE_CATALOG.length / PAGE_SIZE));
});

test('搜索分页：关键词 + 学科 + 来源组合筛选', () => {
  // 防透题收敛：病种关键词（如「肺炎」）不再可搜索；症状关键词仅演示病例命中
  const byDisease = searchCases(CASE_CATALOG, { keyword: '肺炎', subject: 'all', readiness: 'all', page: 1 });
  assert.equal(byDisease.total, 0, '病种关键词不再出现在可搜索文本中（防透题）');
  const result = searchCases(CASE_CATALOG, { keyword: '发热', subject: '呼吸系统', readiness: 'independent', page: 1 });
  assert.ok(result.total >= 1, '症状关键词命中演示病例');
  for (const item of result.items) {
    assert.equal(item.classification.subject, '呼吸系统');
    assert.equal(item.classification.readiness.readiness, 'independent');
    assert.ok(item.classification.searchableText.includes('发热'));
  }
});

test('防透题：教师病例标题与可搜索文本不含病种名', () => {
  const teacherCases = CASE_CATALOG.filter((item) => item.id.startsWith('case-'));
  assert.ok(teacherCases.length >= 50);
  for (const profile of teacherCases) {
    assert.ok(/真实病例 \d{2}$/.test(profile.title), `${profile.id} 标题应为中性学科+序号：${profile.title}`);
    assert.equal(profile.presentingSymptoms.length, 0, `${profile.id} 不得预置症状清单`);
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

test('星级映射：演示 1 星可解释，教师项 2 星', () => {
  const demo = classifyCase(CASE_CATALOG.find((item) => item.id === 'peds-respiratory-001')!);
  assert.equal(demo.stars, 1);
  assert.ok(demo.starReason.length > 0);
  const teacher = classifyCase(CASE_CATALOG.find((item) => item.id === publicCaseId('teacher-新生儿败血症'))!);
  assert.equal(teacher.stars, 2);
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

test('搜索文本包含病种/学科/症状（大小写不敏感由调用方保证 lower）', () => {
  const profile = CASE_CATALOG.find((item) => item.id === 'peds-respiratory-001')!;
  const text = classifyCase(profile).searchableText;
  assert.ok(text.includes('发热') && text.includes('呼吸系统') && text.includes('咳嗽'));
});
