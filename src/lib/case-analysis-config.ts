/**
 * 病例分析 AI 判分的灰度开关。
 * - CASE_ANALYSIS_ENABLED 默认关闭：关闭时报告完全走旧流程，不读写标答表。
 * - CASE_ANALYSIS_CASE_IDS 默认只开 DKA 一例；逗号分隔可扩到更多病例。
 * 报告采用影子分：caseAnalysis 单独展示，不改变旧 totalScore，便于先对比再切主分数。
 */
export const CASE_ANALYSIS_DEFAULT_CASE_ID = 'teacher-1型糖尿病伴有酮症酸中毒';

export function isCaseAnalysisEnabled(): boolean {
  const value = process.env.CASE_ANALYSIS_ENABLED?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

export function caseAnalysisCaseIds(): Set<string> {
  const raw = process.env.CASE_ANALYSIS_CASE_IDS?.trim();
  if (!raw) return new Set([CASE_ANALYSIS_DEFAULT_CASE_ID]);
  return new Set(raw.split(',').map((item) => decodeURIComponent(item.trim())).filter(Boolean));
}

export function isCaseAnalysisCase(caseId: string): boolean {
  return caseAnalysisCaseIds().has(decodeURIComponent(caseId));
}