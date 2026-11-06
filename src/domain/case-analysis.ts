import { z } from 'zod';
import type {
  DiagnosisAnswerKey,
  DiagnosisAnswerInput,
  DiagnosisItem,
  DifferentialItem,
  EvidencePoint,
  ManagementPoint,
} from '@/domain/diagnosis-answer';

export const CASE_ANALYSIS_PROMPT_VERSION = 'case-analysis-v1';
export const CASE_ANALYSIS_MAX_SECONDARY = 2;
export const CASE_ANALYSIS_MAX_EVIDENCE = 8;
export const CASE_ANALYSIS_MAX_DIFFERENTIALS = 4;
export const CASE_ANALYSIS_MAX_MANAGEMENT = 8;
export const CASE_ANALYSIS_MAX_SOURCE_QUOTE = 600;

export type CaseAnswerKeyStatus = 'auto' | 'not_assessable';
export type CaseAnalysisSourceSection = 'history' | 'exam' | 'tests' | 'diagnosis' | 'plan';

export interface CaseAnalysisSource {
  history: string;
  exam: string;
  tests: string;
  diagnosis: string;
  plan: string;
}

export interface CaseAnswerKeyRecord {
  caseId: string;
  version: string;
  status: CaseAnswerKeyStatus;
  key: DiagnosisAnswerKey | null;
  model: string;
  promptVersion: string;
  sourceFingerprint: string;
  generatedAt: string;
  reason?: string;
  dropped: DroppedPoint[];
}

export interface DroppedPoint {
  section: 'primary' | 'secondary' | 'evidence' | 'differential' | 'management';
  label: string;
  reason: string;
}

const aliasSchema = z.string().trim().min(1).max(80);
const quotesSchema = z.string().trim().min(1).max(CASE_ANALYSIS_MAX_SOURCE_QUOTE);

const diagnosisItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  aliases: z.array(aliasSchema).max(6).optional(),
  sourceQuote: quotesSchema.optional(),
  sourceSection: z.literal('diagnosis').optional(),
}).strict();

const evidencePointSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(120),
  keywords: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
  sourceQuote: quotesSchema.optional(),
  sourceSection: z.enum(['history', 'exam', 'tests']).optional(),
}).strict();

const differentialItemSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120),
  aliases: z.array(aliasSchema).max(6).optional(),
  sourceQuote: quotesSchema.optional(),
  sourceSection: z.enum(['diagnosis', 'plan']).optional(),
}).strict();

const managementPointSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(120),
  keywords: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
  sourceQuote: quotesSchema.optional(),
  sourceSection: z.literal('plan').optional(),
}).strict();

/** AI 只允许返回这个结构；多一个字段、少一个必填段都视为无效，不进入标答表。 */
export const generatedCaseAnswerKeySchema = z.object({
  primary: diagnosisItemSchema,
  secondary: z.array(diagnosisItemSchema).max(CASE_ANALYSIS_MAX_SECONDARY).default([]),
  evidence: z.array(evidencePointSchema).min(1).max(CASE_ANALYSIS_MAX_EVIDENCE),
  differentials: z.array(differentialItemSchema).max(CASE_ANALYSIS_MAX_DIFFERENTIALS).default([]),
  management: z.array(managementPointSchema).min(1).max(CASE_ANALYSIS_MAX_MANAGEMENT),
}).strict();

export type GeneratedCaseAnswerKey = z.infer<typeof generatedCaseAnswerKeySchema>;

export type CaseAnalysisSubmission = DiagnosisAnswerInput;

/** 从模型输出中取出 JSON 对象；允许模型在 JSON 前后带解释文字或代码围栏。 */
export function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('CASE_ANALYSIS_KEY_INVALID');
  return trimmed.slice(start, end + 1);
}

export function parseGeneratedCaseAnswerKey(content: string): GeneratedCaseAnswerKey {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJsonObject(content));
  } catch {
    throw new Error('CASE_ANALYSIS_KEY_INVALID');
  }
  const parsed = generatedCaseAnswerKeySchema.safeParse(raw);
  if (!parsed.success) throw new Error('CASE_ANALYSIS_KEY_INVALID');
  return parsed.data;
}

/** 原文定位只容忍空白差异；标点、数字、单位必须与原件一致。 */
export function normalizeGroundingText(value: string): string {
  return value.replace(/\s+/g, '');
}

export function isGroundedIn(sourceText: string, quote: string): boolean {
  const normalizedQuote = normalizeGroundingText(quote);
  return normalizedQuote.length > 0 && normalizeGroundingText(sourceText).includes(normalizedQuote);
}

function firstSentenceContaining(sourceText: string, needle: string): string | null {
  const normalizedNeedle = normalizeGroundingText(needle);
  if (!normalizedNeedle) return null;
  const sentences = sourceText.split(/[。\n；;]/).map((item) => item.trim()).filter(Boolean);
  const hit = sentences.find((sentence) => normalizeGroundingText(sentence).includes(normalizedNeedle));
  return hit ? hit.slice(0, CASE_ANALYSIS_MAX_SOURCE_QUOTE) : null;
}

function groundedDiagnosis(
  item: DiagnosisItem,
  sourceText: string,
): DiagnosisItem | null {
  const names = [item.name, ...(item.aliases ?? [])].filter(Boolean);
  const groundedName = names.find((name) => isGroundedIn(sourceText, name));
  const groundedQuote = item.sourceQuote && isGroundedIn(sourceText, item.sourceQuote) ? item.sourceQuote : null;
  if (!groundedName && !groundedQuote) return null;
  return {
    name: item.name,
    ...(item.aliases?.length ? { aliases: item.aliases } : {}),
    sourceSection: 'diagnosis',
    sourceQuote: groundedQuote ?? firstSentenceContaining(sourceText, groundedName ?? item.name) ?? item.name,
  };
}

function groundedPoint(
  point: EvidencePoint | ManagementPoint,
  sections: Array<[CaseAnalysisSourceSection, string]>,
): (EvidencePoint | ManagementPoint) | null {
  const candidates = point.sourceSection
    ? sections.filter(([section]) => section === point.sourceSection)
    : sections;
  const quote = point.sourceQuote;
  for (const [section, text] of candidates) {
    if (quote && isGroundedIn(text, quote)) return { ...point, sourceSection: section, sourceQuote: quote };
    if (isGroundedIn(text, point.label)) {
      return { ...point, sourceSection: section, sourceQuote: firstSentenceContaining(text, point.label) ?? point.label };
    }
  }
  return null;
}

function groundedDifferential(
  item: DifferentialItem,
  source: CaseAnalysisSource,
): DifferentialItem | null {
  const sections: Array<[CaseAnalysisSourceSection, string]> = [
    ['diagnosis', source.diagnosis],
    ['plan', source.plan],
  ];
  const names = [item.name, ...(item.aliases ?? [])].filter(Boolean);
  for (const [section, text] of sections) {
    const quote = item.sourceQuote && isGroundedIn(text, item.sourceQuote) ? item.sourceQuote : null;
    const groundedName = names.find((name) => isGroundedIn(text, name));
    if (quote || groundedName) {
      return {
        ...item,
        sourceSection: section,
        sourceQuote: quote ?? firstSentenceContaining(text, groundedName ?? item.name) ?? item.name,
      };
    }
  }
  return null;
}

function uniquePoints<T extends { id: string; label: string }>(points: T[]): T[] {
  const seenLabels = new Set<string>();
  const seenIds = new Set<string>();
  const result: T[] = [];
  for (const point of points) {
    const labelKey = normalizeGroundingText(point.label);
    if (!labelKey || seenLabels.has(labelKey)) continue;
    seenLabels.add(labelKey);
    let id = point.id;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${point.id}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(id);
    result.push({ ...point, id });
  }
  return result;
}

export interface GroundedCaseAnswerKey {
  key: DiagnosisAnswerKey;
  dropped: DroppedPoint[];
}

/**
 * 服务端回校：模型只能从原件里“指出”得分点，不能新增原件没有的诊断或处理。
 * 任何一条对不上原文的候选都丢弃并回报原因；丢弃后不足以构成五段标答时整例标记不可评分。
 */
export function groundCaseAnswerKey(
  generated: GeneratedCaseAnswerKey,
  source: CaseAnalysisSource,
): GroundedCaseAnswerKey | { notAssessableReason: string; dropped: DroppedPoint[] } {
  const dropped: DroppedPoint[] = [];
  const primary = groundedDiagnosis(generated.primary, source.diagnosis);
  if (!primary) {
    return { notAssessableReason: 'PRIMARY_NOT_GROUNDED', dropped: [{ section: 'primary', label: generated.primary.name, reason: '诊断名不在原件诊断段' }] };
  }

  const secondary: DiagnosisItem[] = [];
  for (const item of generated.secondary) {
    const grounded = groundedDiagnosis(item, source.diagnosis);
    if (grounded) secondary.push(grounded);
    else dropped.push({ section: 'secondary', label: item.name, reason: '并列诊断不在原件诊断段' });
  }

  const evidenceCandidates = generated.evidence.map((point) => {
    const grounded = groundedPoint(point, [['history', source.history], ['exam', source.exam], ['tests', source.tests]]);
    if (!grounded) dropped.push({ section: 'evidence', label: point.label, reason: '病史/查体/辅助检查段未见该依据' });
    return grounded;
  });
  const evidence = uniquePoints(evidenceCandidates.filter((point): point is EvidencePoint => Boolean(point)));
  if (evidence.length === 0) {
    return { notAssessableReason: 'NO_GROUNDED_EVIDENCE', dropped };
  }

  const differentials: DifferentialItem[] = [];
  for (const [index, item] of generated.differentials.entries()) {
    const grounded = groundedDifferential({ ...item, id: item.id ?? `diff-${index + 1}` }, source);
    if (grounded) differentials.push(grounded);
    else dropped.push({ section: 'differential', label: item.name, reason: '原件未见该鉴别诊断，已丢弃' });
  }

  const managementCandidates = generated.management.map((point) => {
    const grounded = groundedPoint(point, [['plan', source.plan]]);
    if (!grounded) dropped.push({ section: 'management', label: point.label, reason: '诊疗计划段未见该处理要点' });
    return grounded;
  });
  const management = uniquePoints(managementCandidates.filter((point): point is ManagementPoint => Boolean(point)));
  if (management.length === 0) {
    return { notAssessableReason: 'NO_GROUNDED_MANAGEMENT', dropped };
  }

  return {
    key: {
      primary,
      secondary,
      evidence,
      differentials: differentials.length > 0 ? differentials : undefined,
      management,
    },
    dropped,
  };
}

export function isCaseAnswerKeyRecord(value: unknown): value is CaseAnswerKeyRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<CaseAnswerKeyRecord>;
  return typeof record.caseId === 'string'
    && typeof record.version === 'string'
    && (record.status === 'auto' || record.status === 'not_assessable')
    && typeof record.model === 'string'
    && typeof record.promptVersion === 'string'
    && typeof record.sourceFingerprint === 'string'
    && typeof record.generatedAt === 'string'
    && Array.isArray(record.dropped);
}