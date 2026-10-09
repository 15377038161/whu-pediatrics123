import type { PublicCaseProfile } from '@/domain/case-catalog';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';

/**
 * 病例库多维分类与检索（2026-10-16 七项重构）：
 * - 学科归一：教师目录存在 5 对同义分类（内分泌疾病/内分泌系统、心血管系统疾病/心血管系统、
 *   新生儿与新生儿疾病/新生儿疾病、神经系统/神经系统疾病、造血系统疾病/血液系统疾病），归一后 13 学科。
 * - 资料完备度（可解释、不伪造）：独立来源（folder 项，53）| 关联来源（alias/subtype 复用源病例，14）
 *   | 资料不足（无 folder 无 link，3 项）——资料不足项如实标注且不得进入可评分测试。
 * - 教学难度星级（可解释映射）：演示病例 1★（引导式完整支架）；独立来源 2★（真实材料自主问诊）；
 *   关联来源 2★（依托源病例学习）。星级仅为入口导览提示，不代表评分权重。
 * - 搜索分页：客户端过滤（72 项静态目录），12/页，筛选变化重置页码。
 */

export const PAGE_SIZE = 12;
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
  disease: string;
  stars: 1 | 2;
  starReason: string;
  readiness: CaseReadinessInfo;
  searchableText: string;
}

/** 单病例分类画像（纯函数）。资料不足 = teacher 病例无 folder 且无 alias/subtype 链接（结构判定）。 */
export function classifyCase(profile: PublicCaseProfile): CaseClassification {
  const teacherItem = profile.id.startsWith('teacher-')
    ? TEACHER_CASE_CATALOG.find((item) => item.id === profile.id) ?? null
    : null;
  const link = TEACHER_CASE_LINKS[profile.id];
  const hasFolder = Boolean(teacherItem?.folder);
  const isInsufficient = profile.id.startsWith('teacher-') && !hasFolder && !link;
  const searchableText = `${profile.title} ${profile.category} ${profile.presentingSymptoms.join(' ')}`.toLowerCase();
  if (!profile.id.startsWith('teacher-')) {
    return {
      subject: normalizeCategory(profile.category),
      disease: profile.title,
      stars: 1,
      starReason: '引导式完整支架，含结构与方向性提示',
      readiness: { readiness: 'independent', label: '独立来源', note: '演示病例' },
      searchableText,
    };
  }
  if (isInsufficient) {
    return {
      subject: normalizeCategory(profile.category),
      disease: profile.title,
      stars: 2,
      starReason: '本病种尚无独立病例正文，仅可记录诊疗思路',
      readiness: { readiness: 'insufficient', label: '资料不足', note: '无独立来源，不进入可评分测试' },
      searchableText,
    };
  }
  const source = TEACHER_CASE_CATALOG.find((item) => item.id === (link?.sourceId ?? ''));
  return {
    subject: normalizeCategory(profile.category),
    disease: profile.title,
    stars: 2,
    starReason: hasFolder
      ? '真实材料自主问诊与检查'
      : `依托源病例「${source?.name ?? link?.sourceId}」${link?.relation === 'subtype' ? '（具体亚型）' : '（名称对应）'}学习`,
    readiness: hasFolder
      ? { readiness: 'independent', label: '独立来源', note: `${teacherItem?.documentCount ?? 0} 份文档 · ${teacherItem?.mediaCount ?? 0} 项媒体` }
      : { readiness: 'linked', label: '关联来源', note: `复用源病例「${source?.name ?? link?.sourceId}」教学材料` },
    searchableText,
  };
}

export interface CaseSearchQuery {
  keyword: string;
  subject: string;
  readiness: CaseReadiness | 'all';
  page: number;
}

export interface CaseSearchResult {
  items: Array<PublicCaseProfile & { classification: CaseClassification }>;
  total: number;
  pageCount: number;
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
