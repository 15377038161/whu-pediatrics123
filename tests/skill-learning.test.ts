import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOURCE_COMPLETION_RATIO,
  SKILL_SEED_SLUGS,
  type SkillCatalogItem,
  isResourcePositionComplete,
  skillProgressLabel,
  sortSkillCatalog,
} from '@/domain/skill-learning';


/** 种子清单：8 项儿科 OSCE 技能，slug 唯一且 kebab-case（与迁移种子对照）。 */
test('SKILL_SEED_SLUGS：8 项技能，slug 唯一且 kebab-case', () => {
  assert.equal(SKILL_SEED_SLUGS.length, 8);
  assert.equal(new Set(SKILL_SEED_SLUGS).size, 8);
  for (const slug of SKILL_SEED_SLUGS) {
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});


test('RESOURCE_COMPLETION_RATIO：与服务端 resource_progress_upsert 同口径 0.9', () => {
  assert.equal(RESOURCE_COMPLETION_RATIO, 0.9);
});


/** 完成阈值纯函数：时长未知/0、位置缺失/负数一律不判定；断言避开 90% 整点的浮点敏感区间（SQL numeric 口径为准）。 */
test('isResourcePositionComplete：缺失/非法输入不判定，达阈值返回 true', () => {
  assert.equal(isResourcePositionComplete(null, 100), false);
  assert.equal(isResourcePositionComplete(50, null), false);
  assert.equal(isResourcePositionComplete(50, 0), false);
  assert.equal(isResourcePositionComplete(50, -1), false);
  assert.equal(isResourcePositionComplete(-5, 100), false);
  assert.equal(isResourcePositionComplete(50, 100), false);
  assert.equal(isResourcePositionComplete(86, 100), false);
  assert.equal(isResourcePositionComplete(95, 100), true);
  assert.equal(isResourcePositionComplete(100, 100), true);
  assert.equal(isResourcePositionComplete(200, 100), true);
});


/** 完成度文案：0 资源不显示进度（避免「0/0=完成」的误导）。 */
test('skillProgressLabel：无资源/全部看完/部分看完三种文案', () => {
  assert.equal(skillProgressLabel({ resourceCount: 0, completedCount: 0 }), '待上架学习资源');
  assert.equal(skillProgressLabel({ resourceCount: 3, completedCount: 3 }), '已看完本技能全部资源');
  assert.equal(skillProgressLabel({ resourceCount: 3, completedCount: 4 }), '已看完本技能全部资源');
  assert.equal(skillProgressLabel({ resourceCount: 5, completedCount: 2 }), '已看完 2/5 个资源');
  assert.equal(skillProgressLabel({ resourceCount: 5, completedCount: 0 }), '已看完 0/5 个资源');
});


/** 目录排序：sort_order 升序优先，其次标题字典序；纯函数不得原地修改入参。 */
test('sortSkillCatalog：sortOrder 升序 + 标题字典序兜底，不改动入参', () => {
  const base: SkillCatalogItem = {
    skillId: 's',
    slug: 's',
    title: 'x',
    description: '',
    category: '',
    resourceCount: 0,
    completedCount: 0,
    sortOrder: 1,
  };
  const input: SkillCatalogItem[] = [
    { ...base, skillId: 'b', sortOrder: 2, title: '腰椎穿刺' },
    { ...base, skillId: 'a', sortOrder: 1, title: '心肺复苏' },
    { ...base, skillId: 'd', sortOrder: 2, title: '骨髓穿刺' },
    { ...base, skillId: 'c', sortOrder: 1, title: '新生儿复苏' },
  ];
  const snapshot = input.map((item) => item.skillId);
  const sorted = sortSkillCatalog(input);
  assert.deepEqual(sorted.map((item) => item.skillId), ['a', 'c', 'd', 'b']);
  assert.deepEqual(input.map((item) => item.skillId), snapshot);
});
