import type { PublicCaseProfile } from '@/domain/case-catalog';

/**
 * 病例库多维分类与检索（防透题收敛，2026-10-12 第一批任务1）：
 * - 本模块可被客户端组件引入（case-library），因此**不再引用** teacher-case-catalog /
 *   teacher-case-links（含病种名/源病种名，会进客户端 bundle）——判定仅依赖
 *   PublicCaseProfile 的中性字段（sourceRelation / contentStatus / 计数）。
 * - 学科归一：教师目录存在 5 对同义分类，归一后 13 学科（保留）。
 * - 资料完备度（可解释、不伪造）：独立来源（contentStatus=teacher-materials-indexed，
 *   53）| 关联来源（sourceRelation 非 null，14）| 资料不足（教师项无 folder 且无关联，3 项）
 *   ——资料不足项如实标注且不得进入可评分测试。
 * - 教学难度星级（可解释映射）：演示病例 1★；真实材料病例 2★。
 * - 搜索分页：客户端过滤公开目录，9/页，筛选变化重置页码。
 *   searchableText 不含病种名（教师病例 title 为中性学科+序号）——按病种关键词搜索
 *   属于透题面，本轮移除；症状关键词搜索仅对演示病例 presentingSymptoms 生效。
 */

export const PAGE_SIZE = 9;
export const RECENT_LIMIT = 6;
export const RECENT_KEY_PREFIX = 'case-library-recent:';

/** 同义学科归一表（教师目录原始 category → 归一学科）。 */
const CATEGORY_NORMALIZATION: Record<string, string> = {
  '内分泌系统': '内分泌疾病',
  '心血管系统': '心血管系统疾病',
  '新生儿疾病': '新生儿与新生儿疾病',
  '神经系统疾病': '神经系统',
  '血液系统疾病': '造血系统疾病',
};

export function normalizeCategory(raw: string): string {
  return CATEGORY_NORMALIZATION[raw] ?? raw;
}

export type CaseReadiness = 'independent' | 'linked' | 'insufficient';

export interface CaseReadinessInfo {
  readiness: CaseReadiness;
  label: string;
  note: string;
}

export interface CaseClassification {
  subject: string;
  stars: 1 | 2;
  starReason: string;
  readiness: CaseReadinessInfo;
  searchableText: string;
}

/** 独立来源判定：教师病例含可索引材料（folder 目录，材料已提取）。 */
function hasIndexedMaterials(profile: PublicCaseProfile): boolean {
  return profile.contentStatus === 'teacher-materials-indexed' || profile.contentStatus === 'teacher-folder-only';
}

/** 单病例分类画像（纯函数，仅依赖中性目录字段）。资料不足 = 教师病例无独立材料且无源关联。 */
export function classifyCase(profile: PublicCaseProfile): CaseClassification {
  const isTeacher = !profile.id.startsWith('peds-');
  const linked = isTeacher && profile.sourceRelation !== null;
  const hasFolder = isTeacher && hasIndexedMaterials(profile);
  const isInsufficient = isTeacher && !hasFolder && !linked;
  // searchableText：标题（中性）+ 归一学科 + 症状（演示病例）——不含病种名
  const searchableText = `${profile.title} ${normalizeCategory(profile.category)} ${profile.presentingSymptoms.join(' ')}`.toLowerCase();
  if (!isTeacher) {
    return {
      subject: normalizeCategory(profile.category),
      stars: 1,
      starReason: '引导式完整支架，含结构与方向性提示',
      readiness: { readiness: 'independent', label: '独立来源', note: '演示病例' },
      searchableText,
    };
  }
  if (profile.contentStatus === 'teaching-simulation') return {
    subject: normalizeCategory(profile.category), stars: 2,
    starReason: '已配置完整虚构教学场景，过程反馈不代表临床能力认证',
    readiness: {readiness: 'independent', label: '教学模拟', note: 'AI生成，非真实患者；原始病例来源仍缺失'},
    searchableText,
  };
  if (isInsufficient) {
    return {
      subject: normalizeCategory(profile.category),
      stars: 2,
      starReason: '本病种尚无独立病例正文，仅可记录诊疗思路',
      readiness: { readiness: 'insufficient', label: '资料不足', note: '无独立来源，不进入可评分测试' },
      searchableText,
    };
  }
  return {
    subject: normalizeCategory(profile.category),
    stars: 2,
    starReason: hasFolder
      ? '真实材料自主问诊与检查'
      : '依托关联源病例教学材料学习',
    readiness: hasFolder
      ? { readiness: 'independent', label: '独立来源', note: `${profile.documentCount ?? 0} 份文档 · ${profile.mediaCount ?? 0} 项媒体` }
      : { readiness: 'linked', label: '关联来源', note: '复用关联源病例教学材料' },
    searchableText,
  };
}

export interface CaseSearchResult {
  items: Array<PublicCaseProfile & { classification: CaseClassification }>;
  total: number;
  pageCount: number;
  page: number;
}

export interface CaseSearchQuery {
  keyword: string;
  subject: string;
  readiness: CaseReadiness | 'all';
  page: number;
}

/** 搜索 + 三维筛选 + 分页（纯函数）。筛选变化由调用方重置页码。 */
export function searchCases(catalog: PublicCaseProfile[], query: CaseSearchQuery): CaseSearchResult {
  const keyword = query.keyword.trim().toLowerCase();
  const classified = catalog
    .map((item) => ({ item, classification: classifyCase(item) }))
    .filter(({ item, classification }) => {
      if (query.subject !== 'all' && classification.subject !== query.subject) return false;
      if (query.readiness !== 'all' && classification.readiness.readiness !== query.readiness) return false;
      if (keyword && !classification.searchableText.includes(keyword)) return false;
      return true;
    })
    .map(({ item, classification }) => ({ ...item, classification }));
  const total = classified.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page), pageCount);
  const start = (page - 1) * PAGE_SIZE;
  return { items: classified.slice(start, start + PAGE_SIZE), total, pageCount, page };
}

export function listSubjects(catalog: PublicCaseProfile[]): string[] {
  return [...new Set(catalog.map((item) => normalizeCategory(item.category)))];
}

/** 资料不足项不得进入可评分（osce）测试——供 UI 禁用与服务端守卫共用同一判定。 */
export function isScorableCase(profile: PublicCaseProfile): boolean {
  return classifyCase(profile).readiness.readiness !== 'insufficient';
}

/** 最近选择：按用户隔离的存储键（值仅为 caseId 数组，不含诊疗内容）。 */
export function recentKey(userId: string): string {
  return `${RECENT_KEY_PREFIX}${userId}`;
}

export function readRecentSelection(storage: Storage, userId: string): string[] {
  try {
    const raw = storage.getItem(recentKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string').slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function writeRecentSelection(storage: Storage, userId: string, caseId: string): string[] {
  const existing = readRecentSelection(storage, userId).filter((id) => id !== caseId);
  const next = [caseId, ...existing].slice(0, RECENT_LIMIT);
  try {
    storage.setItem(recentKey(userId), JSON.stringify(next));
  } catch {
    // 写入失败（隐私模式/配额）静默降级，不影响主流程。
  }
  return next;
}
