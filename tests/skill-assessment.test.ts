import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSESSMENT_SCORE_LEVELS,
  SKILL_RUBRIC_VERSION,
  RUBRIC_SEED_ITEM_KEYS,
  computeSkillAssessmentTotal,
  formatAssessmentTotal,
  isAssessmentScoreValue,
  isValidRubricItemKeys,
} from '@/domain/skill-assessment';
import { SKILL_SEED_SLUGS } from '@/domain/skill-learning';


/** 迁移种子对照：8 项技能 × 5 个观察项（与 20261030110000_skill_assessment.sql 完全一致）。 */
const MIGRATION_SEED: Record<string, string[]> = {
  'pediatric-cpr': ['cpr-01', 'cpr-02', 'cpr-03', 'cpr-04', 'cpr-05'],
  'neonatal-resuscitation': ['neo-01', 'neo-02', 'neo-03', 'neo-04', 'neo-05'],
  'lumbar-puncture': ['lp-01', 'lp-02', 'lp-03', 'lp-04', 'lp-05'],
  'bone-marrow-aspiration': ['bma-01', 'bma-02', 'bma-03', 'bma-04', 'bma-05'],
  'thoracentesis': ['tc-01', 'tc-02', 'tc-03', 'tc-04', 'tc-05'],
  'abdominal-paracentesis': ['ap-01', 'ap-02', 'ap-03', 'ap-04', 'ap-05'],
  'urinary-catheterization': ['uc-01', 'uc-02', 'uc-03', 'uc-04', 'uc-05'],
  'venipuncture': ['vp-01', 'vp-02', 'vp-03', 'vp-04', 'vp-05'],
};


test('评分口径常量：rubric 版本 1，三档 2 达标 / 1 部分达标 / 0 未达标', () => {
  assert.equal(SKILL_RUBRIC_VERSION, 1);
  assert.deepEqual(ASSESSMENT_SCORE_LEVELS, { 2: '达标', 1: '部分达标', 0: '未达标' });
});


test('评分项快照与迁移种子完全对齐：8 技能 × 5 项 = 40 项', () => {
  assert.deepEqual(Object.keys(RUBRIC_SEED_ITEM_KEYS).sort(), [...SKILL_SEED_SLUGS].sort());
  for (const [slug, keys] of Object.entries(MIGRATION_SEED)) {
    assert.deepEqual(RUBRIC_SEED_ITEM_KEYS[slug], keys, `技能 ${slug} 评分项与迁移种子不一致`);
  }
  const total = Object.values(RUBRIC_SEED_ITEM_KEYS).reduce((acc, keys) => acc + keys.length, 0);
  assert.equal(total, 40);
});


test('isAssessmentScoreValue：仅 0/1/2 为有效档位', () => {
  assert.equal(isAssessmentScoreValue(0), true);
  assert.equal(isAssessmentScoreValue(1), true);
  assert.equal(isAssessmentScoreValue(2), true);
  assert.equal(isAssessmentScoreValue(null), false);
  assert.equal(isAssessmentScoreValue(undefined), false);
  assert.equal(isAssessmentScoreValue(3), false);
  assert.equal(isAssessmentScoreValue('2'), false);
});


test('isValidRubricItemKeys：有效子集通过，重复/越界/未知技能拒绝', () => {
  assert.equal(isValidRubricItemKeys('pediatric-cpr', ['cpr-01', 'cpr-05']), true);
  assert.equal(isValidRubricItemKeys('pediatric-cpr', []), true);
  assert.equal(isValidRubricItemKeys('pediatric-cpr', ['cpr-01', 'cpr-01']), false);
  assert.equal(isValidRubricItemKeys('pediatric-cpr', ['cpr-01', 'neo-01']), false);
  assert.equal(isValidRubricItemKeys('unknown-skill', ['x-01']), false);
  assert.equal(isValidRubricItemKeys('venipuncture', ['vp-01', 'vp-02', 'vp-03', 'vp-04', 'vp-05']), true);
});


test('computeSkillAssessmentTotal：全未观察 → null（不计 0 分）', () => {
  assert.equal(computeSkillAssessmentTotal([]), null);
  assert.equal(computeSkillAssessmentTotal([null, null, null]), null);
});


test('computeSkillAssessmentTotal：满分/零分/半分（与 DB round(x,2) 口径一致）', () => {
  assert.equal(computeSkillAssessmentTotal([2, 2, 2, 2, 2]), 100);
  assert.equal(computeSkillAssessmentTotal([0, 0, 0, 0, 0]), 0);
  assert.equal(computeSkillAssessmentTotal([1, 1, 1, 1, 1]), 50);
  assert.equal(computeSkillAssessmentTotal([2, 1]), 75);
  assert.equal(computeSkillAssessmentTotal([1]), 50);
  assert.equal(computeSkillAssessmentTotal([0]), 0);
});


test('computeSkillAssessmentTotal：未观察不计分母', () => {
  // 只观察 1 项得 2 分 → 2/2×100 = 100（未观察项不拉低总分）
  assert.equal(computeSkillAssessmentTotal([2, null, null, null, null]), 100);
  assert.equal(computeSkillAssessmentTotal([1, null]), 50);
  // 观察 3 项共 3 分 → 3/6×100 = 50
  assert.equal(computeSkillAssessmentTotal([2, 1, 0, null, null]), 50);
  // 观察 3 项共 5 分 → 5/6×100 = 83.33
  assert.equal(computeSkillAssessmentTotal([2, 2, 1, null, null]), 83.33);
});


test('computeSkillAssessmentTotal：忽略非法档位（防御性过滤）', () => {
  assert.equal(computeSkillAssessmentTotal([2, 99 as number, null]), 100);
  assert.equal(computeSkillAssessmentTotal([-1 as number, null]), null);
});


test('formatAssessmentTotal：null 展示 --，数字保留两位小数', () => {
  assert.equal(formatAssessmentTotal(null), '--');
  assert.equal(formatAssessmentTotal(100), '100.00');
  assert.equal(formatAssessmentTotal(83.33), '83.33');
});
