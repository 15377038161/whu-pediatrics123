/**
 * 病例分析标准答案的结构与判分（执业医师实践技能第一站「病例分析」）。
 *
 * 边界：
 * - 本模块只承载**教师提供且可核验**的标准答案结构，以及按该结构做的确定性判分；
 *   不生成、不推测、不补全任何医学诊断或处理方案。
 * - 判分依据是「名称/别名匹配 + 要点关键词覆盖」，不做语义推断；因此它只能当教学练习反馈，
 *   不能替代考官评分，也不进临床成绩。
 * - 「诊断依据」与「鉴别诊断」的既有链路（medical-note 的 differentialDiagnosis、
 *   training-rubric 的 REASONING_DIFFERENTIAL）保持不动，本模块只补分级诊断与处理原则。
 */

export type DiagnosisItem = {
  name: string;
  /** 教师确认可接受的同义写法（如「支气管肺炎」与「小叶性肺炎」）。 */
  aliases?: string[];
};

export type EvidencePoint = { id: string; label: string; keywords: string[] };

export type DifferentialItem = { name: string; aliases?: string[] };

export type ManagementPoint = { id: string; label: string; keywords: string[] };

export type DiagnosisAnswerKey = {
  /** 第一诊断（主要诊断）。 */
  primary: DiagnosisItem;
  /** 第二、第三诊断，按重要性排列。 */
  secondary: DiagnosisItem[];
  evidence: EvidencePoint[];
  /** 可选：该病例要求写的鉴别诊断。 */
  differentials?: DifferentialItem[];
  management: ManagementPoint[];
};

export type DiagnosisAnswerInput = {
  primary?: string;
  secondary?: string[];
  evidence?: string;
  differentials?: string;
  management?: string;
};

export type DiagnosisGrade = {
  totalScore: number;
  maxScore: number;
  diagnosis: {
    primaryHit: boolean;
    primaryScore: number;
    secondaryHits: string[];
    secondaryMisses: string[];
    secondaryScore: number;
  };
  evidence: { hits: string[]; misses: string[]; score: number; maxScore: number };
  differential: { applicable: boolean; hits: string[]; misses: string[]; score: number; maxScore: number };
  management: { hits: string[]; misses: string[]; score: number; maxScore: number };
  /** 直接可展示给学生的补答提示（不含医学结论）。 */
  missingPoints: string[];
};

const WEIGHTS = { primary: 30, secondary: 20, evidence: 25, differential: 10, management: 25 } as const;
const MAX_SECONDARY = 2;
const MAX_TEXT = 4000;

/** 归一化：去空白与常见标点、全角转半角括号、英文小写，便于同义比较。 */
export function normalizeDiagnosisText(value: string): string {
  return (value ?? '')
    .slice(0, MAX_TEXT)
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[\s，,。；;、:：!！?？"'“”‘’]/g, '')
    .toLowerCase();
}

/** 名称命中：归一化后完全相等，或学生文本包含该名称（名称至少 2 字，避免单字误命中）。 */
export function matchesDiagnosisName(item: DiagnosisItem, candidate: string): boolean {
  const target = normalizeDiagnosisText(candidate);
  if (!target) return false;
  const names = [item.name, ...(item.aliases ?? [])].map(normalizeDiagnosisText).filter((name) => name.length >= 2);
  return names.some((name) => target === name || target.includes(name));
}

function hitsAnyKeyword(text: string, keywords: string[]): boolean {
  const normalized = normalizeDiagnosisText(text);
  return keywords.some((keyword) => {
    const key = normalizeDiagnosisText(keyword);
    return key.length >= 1 && normalized.includes(key);
  });
}

function splitEntries(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(/[\n；;]/);
  return list.map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

export function gradeDiagnosisAnswer(key: DiagnosisAnswerKey, input: DiagnosisAnswerInput): DiagnosisGrade {
  const maxSecondary = key.secondary.length * (WEIGHTS.secondary / 2);
  const maxEvidence = WEIGHTS.evidence;
  const differentialApplicable = (key.differentials?.length ?? 0) > 0;
  const maxDifferential = differentialApplicable ? WEIGHTS.differential : 0;

  const primaryHit = Boolean(input.primary) && matchesDiagnosisName(key.primary, input.primary!);
  const primaryScore = primaryHit ? WEIGHTS.primary : 0;

  const secondaryInput = (input.secondary ?? []).slice(0, MAX_SECONDARY);
  const secondaryHits: string[] = [];
  const secondaryMisses: string[] = [];
  for (const item of key.secondary) {
    if (secondaryInput.some((candidate) => matchesDiagnosisName(item, candidate))) secondaryHits.push(item.name);
    else secondaryMisses.push(item.name);
  }
  const secondaryScore = key.secondary.length === 0
    ? WEIGHTS.secondary
    : Math.round((secondaryHits.length / Math.max(key.secondary.length, 1)) * WEIGHTS.secondary);

  const evidenceText = input.evidence ?? '';
  const evidenceHits = key.evidence.filter((point) => hitsAnyKeyword(evidenceText, point.keywords));
  const evidenceMisses = key.evidence.filter((point) => !evidenceHits.includes(point));
  const evidenceScore = key.evidence.length === 0
    ? 0
    : Math.round((evidenceHits.length / key.evidence.length) * maxEvidence);

  const differentialText = input.differentials ?? '';
  const differentialItems = key.differentials ?? [];
  const differentialHits = differentialItems.filter((item) => matchesDiagnosisName(item, differentialText));
  const differentialMisses = differentialItems.filter((item) => !differentialHits.includes(item));
  const differentialScore = differentialApplicable && differentialItems.length > 0
    ? Math.round((differentialHits.length / differentialItems.length) * maxDifferential)
    : 0;

  const managementText = input.management ?? '';
  const managementHits = key.management.filter((point) => hitsAnyKeyword(managementText, point.keywords));
  const managementMisses = key.management.filter((point) => !managementHits.includes(point));
  const managementScore = key.management.length === 0
    ? 0
    : Math.round((managementHits.length / key.management.length) * WEIGHTS.management);

  const missingPoints: string[] = [];
  if (!primaryHit) missingPoints.push(`第一诊断：需给出「${key.primary.name}」或教师确认的同义写法`);
  for (const name of secondaryMisses) missingPoints.push(`并列诊断：需写出「${name}」`);
  for (const point of evidenceMisses) missingPoints.push(`诊断依据：缺少「${point.label}」`);
  for (const item of differentialMisses) missingPoints.push(`鉴别诊断：需写「${item.name}」`);
  for (const point of managementMisses) missingPoints.push(`处理原则：缺少「${point.label}」`);

  const totalScore = primaryScore + secondaryScore + evidenceScore + differentialScore + managementScore;
  const maxScore = WEIGHTS.primary + WEIGHTS.secondary + maxEvidence + maxDifferential + WEIGHTS.management;

  return {
    totalScore,
    maxScore,
    diagnosis: { primaryHit, primaryScore, secondaryHits, secondaryMisses, secondaryScore },
    evidence: { hits: evidenceHits.map((p) => p.label), misses: evidenceMisses.map((p) => p.label), score: evidenceScore, maxScore: maxEvidence },
    differential: {
      applicable: differentialApplicable,
      hits: differentialHits.map((item) => item.name),
      misses: differentialMisses.map((item) => item.name),
      score: differentialScore,
      maxScore: maxDifferential,
    },
    management: { hits: managementHits.map((p) => p.label), misses: managementMisses.map((p) => p.label), score: managementScore, maxScore: WEIGHTS.management },
    missingPoints,
  };
}

/** 学生提交条目数超过「第一 + 第二 + 第三」时给出提示，用于界面约束，不参与判分。 */
export function diagnoseSecondaryOverflow(input: DiagnosisAnswerInput): boolean {
  return splitEntries(input.secondary).length > MAX_SECONDARY;
}

export const DIAGNOSIS_DISCLAIMER = '本页为教学练习反馈：标准答案由授课教师提供并可核验，判分只做名称匹配与要点覆盖，不做语义推断，不计入临床成绩。';