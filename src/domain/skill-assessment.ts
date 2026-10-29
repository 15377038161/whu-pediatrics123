/**
 * 批次8·教师手机现场考核评分（领域层）。
 *
 * 评分口径（2026-10-30 澄清确认）：
 * - 内置统一评分项（rubric_version=1 迁移种子，8 项技能 × 5 个观察项），教师不可增删；
 * - 逐项三档：2 达标 / 1 部分达标 / 0 未达标；null = 未观察（不计分）；
 * - 总分 = 得分和 / 计分项满分 × 100（未观察不计分母），与训练报告 total_score 口径对齐；
 * - 发布制：draft → 教师确认发布后学生才可见；补考生成新记录（retake_of 关联原考核）。
 *
 * 边界：现场考核成绩独立于 OSCE 模拟参考评分与训练报告成绩，不互换算、不入 AI 生成，
 * 仅作教学记录展示，不构成唯一能力判定。
 */

export const SKILL_RUBRIC_VERSION = 1;

export const ASSESSMENT_SCORE_LEVELS = {
  2: '达标',
  1: '部分达标',
  0: '未达标',
} as const;

export type AssessmentScoreValue = 0 | 1 | 2;

export const ASSESSMENT_SCORE_VALUES: readonly AssessmentScoreValue[] = [2, 1, 0];

export function isAssessmentScoreValue(value: unknown): value is AssessmentScoreValue {
  return value === 0 || value === 1 || value === 2;
}

/**
 * 评分项快照（rubric_version=1 迁移种子，供单测对照与客户端兜底展示；
 * 运行时评分口径一律以 skill_rubric_items 表为准）。
 */
export const RUBRIC_SEED_ITEM_KEYS: Readonly<Record<string, readonly string[]>> = {
  'pediatric-cpr': ['cpr-01', 'cpr-02', 'cpr-03', 'cpr-04', 'cpr-05'],
  'neonatal-resuscitation': ['neo-01', 'neo-02', 'neo-03', 'neo-04', 'neo-05'],
  'lumbar-puncture': ['lp-01', 'lp-02', 'lp-03', 'lp-04', 'lp-05'],
  'bone-marrow-aspiration': ['bma-01', 'bma-02', 'bma-03', 'bma-04', 'bma-05'],
  'thoracentesis': ['tc-01', 'tc-02', 'tc-03', 'tc-04', 'tc-05'],
  'abdominal-paracentesis': ['ap-01', 'ap-02', 'ap-03', 'ap-04', 'ap-05'],
  'urinary-catheterization': ['uc-01', 'uc-02', 'uc-03', 'uc-04', 'uc-05'],
  'venipuncture': ['vp-01', 'vp-02', 'vp-03', 'vp-04', 'vp-05'],
};

/** 校验评分项 key 集合是否为某技能 rubric 的有效子集（无重复、全部属于该技能）。 */
export function isValidRubricItemKeys(skillSlug: string, keys: readonly string[]): boolean {
  const expected = RUBRIC_SEED_ITEM_KEYS[skillSlug];
  if (!expected) return false;
  const unique = new Set(keys);
  if (unique.size !== keys.length) return false;
  return keys.every((key) => expected.includes(key));
}

/**
 * 总分计算（纯函数，与 skill_assessment_publish 内 SQL 口径一致）：
 * 全未观察 → null；否则 round(得分和 / (计分项数 × 2) × 100, 2)。
 */
export function computeSkillAssessmentTotal(scores: ReadonlyArray<number | null>): number | null {
  const scored = scores.filter((s): s is number => s !== null && isAssessmentScoreValue(s));
  if (scored.length === 0) return null;
  const sum = scored.reduce((acc, s) => acc + s, 0);
  return Math.round((sum * 5000) / scored.length) / 100;
}

/** 总分展示（null=全未观察，展示为 --）。 */
export function formatAssessmentTotal(total: number | null): string {
  return total === null ? '--' : total.toFixed(2);
}
