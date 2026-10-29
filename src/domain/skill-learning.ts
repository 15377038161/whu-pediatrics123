/**
 * 批次7·独立技能学习模块领域定义（功能包批次7：技能学习目录+观看进度）。
 *
 * 边界（与批次5资源中心口径一致）：
 * - 技能目录是学习资源的组织维度：一项技能聚合多个视频/图文资源，供学生按技能学习；
 * - 完成度仅由「资源观看完成标记」聚合展示（观看位置达时长 90% 由服务端 RPC 标记），
 *   不伪装掌握程度、不接入学情评分、不构成任何临床能力判定；
 * - 8 项技能为儿科常见技能学习目录种子（迁移落库），描述为通用学习目标，
 *   不构成评分标准，不猜院校技能清单口径。
 */

/** 技能目录条目（学生/教师通用基础字段）。 */
export interface SkillCatalogItem {
  skillId: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  /** 该技能下对学生可见的已发布资源数（服务端 RPC 按可见性谓词聚合）。 */
  resourceCount: number;
  /** 本人已标记完成的资源数（completed_at 非空）。 */
  completedCount: number;
  sortOrder: number;
}

/** 技能绑定选项（教师端资源绑定下拉用，轻量字段）。 */
export interface SkillOption {
  skillId: string;
  slug: string;
  title: string;
  category: string;
}

/** 迁移种子的 8 项技能 slug（顺序即 sort_order 1..8；用于测试与展示对照，真实清单以数据库为准）。 */
export const SKILL_SEED_SLUGS = [
  'pediatric-cpr',
  'neonatal-resuscitation',
  'lumbar-puncture',
  'bone-marrow-aspiration',
  'thoracentesis',
  'abdominal-paracentesis',
  'urinary-catheterization',
  'venipuncture',
] as const;

/** 观看完成阈值：位置秒数达到资源时长 90% 视为完成（与服务端 resource_progress_upsert 同一口径）。 */
export const RESOURCE_COMPLETION_RATIO = 0.9;

/** 纯函数：观看位置是否达到完成阈值（时长未知时不判定，返回 false）。 */
export function isResourcePositionComplete(positionSeconds: number | null, durationSeconds: number | null): boolean {
  if (positionSeconds == null || durationSeconds == null || durationSeconds <= 0) return false;
  if (positionSeconds < 0) return false;
  return positionSeconds >= durationSeconds * RESOURCE_COMPLETION_RATIO;
}

/** 纯函数：技能完成度展示文案（无资源时不显示进度，避免「0/0=完成」的误导）。 */
export function skillProgressLabel(item: Pick<SkillCatalogItem, 'resourceCount' | 'completedCount'>): string {
  if (item.resourceCount <= 0) return '待上架学习资源';
  if (item.completedCount >= item.resourceCount) return '已看完本技能全部资源';
  return `已看完 ${item.completedCount}/${item.resourceCount} 个资源`;
}

/** 纯函数：技能目录展示排序（sort_order 升序，其次标题字典序；与 RPC 聚合口径一致，供前端分组兜底）。 */
export function sortSkillCatalog(items: SkillCatalogItem[]): SkillCatalogItem[] {
  return [...items].sort((a, b) => (a.sortOrder - b.sortOrder) || a.title.localeCompare(b.title, 'zh-Hans-CN'));
}
