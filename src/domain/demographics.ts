/**
 * 人口学占位串判定（客户端与服务端共用，依赖为零）。
 *
 * 建快照时若病史头窗口漏掉人口学句，顶层 age/sex 会以这些字面值落库；
 * 客户端渲染人物形象与服务端恢复病例都要按同一口径识别它们，避免「标题有年龄、查体显示未记录」。
 */

const DEMOGRAPHIC_PLACEHOLDERS = new Set(['', '年龄未记录', '性别未记录']);

export function isPlaceholderDemographic(value: string | null | undefined): boolean {
  return value === null || value === undefined || DEMOGRAPHIC_PLACEHOLDERS.has(value.trim());
}

/** 快照/会话里的值仍是占位串时沿用已解析值；真实值以快照为准。 */
export function preferResolvedDemographics(
  resolved: { age: string; sex: string },
  snapshot: { age?: string | null; sex?: string | null },
): { age: string; sex: string } {
  return {
    age: isPlaceholderDemographic(snapshot.age) ? resolved.age : snapshot.age!,
    sex: isPlaceholderDemographic(snapshot.sex) ? resolved.sex : snapshot.sex!,
  };
}