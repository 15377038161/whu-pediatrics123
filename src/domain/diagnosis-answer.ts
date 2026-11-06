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

export type DiagnosisSourceMeta = {
  /** 生成该得分点时引用的原件连续片段；用于审计，不参与匹配。 */
  sourceQuote?: string;
  sourceSection?: 'history' | 'exam' | 'tests' | 'diagnosis' | 'plan';
};

export type DiagnosisItem = {
  name: string;
  /** 教师确认可接受的同义写法（如「支气管肺炎」与「小叶性肺炎」）。 */
  aliases?: string[];
} & DiagnosisSourceMeta;

export type EvidencePoint = { id: string; label: string; keywords: string[] } & DiagnosisSourceMeta;

export type DifferentialItem = { id?: string; name: string; aliases?: string[] } & DiagnosisSourceMeta;

export type ManagementPoint = { id: string; label: string; keywords: string[] } & DiagnosisSourceMeta;

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

export type PointJudgementStatus = 'covered' | 'partial' | 'missing';

/** AI 只判断「学生有没有答到这个已确认的得分点」，不新增得分点、不直接给总分。 */
export type PointJudgement = {
  status: PointJudgementStatus;
  /** 学生原文中支撑该判断的连续片段；展示与审计用。 */
  evidence?: string;
  confidence?: number;
  reason?: string;
};

/** key 形式：`primary`、`secondary:<name>`、`evidence:<id>`、`differential:<id|index>`、`management:<id>`。 */
export type PointJudgementMap = Record<string, PointJudgement>;

export type DiagnosisPointResult = {
  section: 'primary' | 'secondary' | 'evidence' | 'differential' | 'management';
  /** 新增接诊阶段归属；历史报告缺省时由 section 推导。 */
  stage?: 'assessment' | 'plan';
  id: string;
  label: string;
  status: PointJudgementStatus;
  score: number;
  maxScore: number;
  evidence?: string;
  reason?: string;
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
  /** 逐点结果：报告展示命中/部分/未命中与原文证据；总分仍以各段汇总为准。 */
  points: DiagnosisPointResult[];
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

const STATUS_FRACTION: Record<PointJudgementStatus, number> = { covered: 1, partial: 0.5, missing: 0 };

function roundPoint(value: number): number {
  return Math.round(value * 10) / 10;
}

export function gradeDiagnosisAnswer(
  key: DiagnosisAnswerKey,
  input: DiagnosisAnswerInput,
  judgements?: PointJudgementMap,
): DiagnosisGrade {
  // 空段不计入满分：标答没有诊断依据/处理原则/并列诊断时，学生不该为不存在的段白丢分，
  // 也不该为空的并列诊断白拿 20 分。
  const maxSecondary = key.secondary.length > 0 ? WEIGHTS.secondary : 0;
  const maxEvidence = key.evidence.length > 0 ? WEIGHTS.evidence : 0;
  const differentialApplicable = (key.differentials?.length ?? 0) > 0;
  const maxDifferential = differentialApplicable ? WEIGHTS.differential : 0;
  const maxManagement = key.management.length > 0 ? WEIGHTS.management : 0;

  const points: DiagnosisPointResult[] = [];
  const missingPoints: string[] = [];

  // 诊断名走确定性别名匹配，不接受 AI 改判：写错诊断不能因为“说得像”而得分。
  const primaryHit = Boolean(input.primary) && matchesDiagnosisName(key.primary, input.primary!);
  const primaryStatus: PointJudgementStatus = primaryHit ? 'covered' : 'missing';
  const primaryScore = primaryHit ? WEIGHTS.primary : 0;
  points.push({ section: 'primary', id: 'primary', label: key.primary.name, status: primaryStatus, score: primaryScore, maxScore: WEIGHTS.primary });
  if (!primaryHit) missingPoints.push(`第一诊断：需给出「${key.primary.name}」或教师确认的同义写法`);

  const secondaryInput = (input.secondary ?? []).slice(0, MAX_SECONDARY);
  const secondaryHits: string[] = [];
  const secondaryMisses: string[] = [];
  const secondaryStatus = new Map<string, PointJudgementStatus>();
  const secondaryPointMax = key.secondary.length > 0 ? maxSecondary / key.secondary.length : 0;
  for (const item of key.secondary) {
    const status: PointJudgementStatus = secondaryInput.some((candidate) => matchesDiagnosisName(item, candidate))
      ? 'covered'
      : 'missing';
    secondaryStatus.set(item.name, status);
    if (status === 'covered') secondaryHits.push(item.name);
    else {
      secondaryMisses.push(item.name);
      missingPoints.push(`并列诊断：需写出「${item.name}」`);
    }
    points.push({ section: 'secondary', id: item.name, label: item.name, status, score: roundPoint(status === 'covered' ? secondaryPointMax : 0), maxScore: roundPoint(secondaryPointMax) });
  }
  const secondaryFractions = key.secondary.reduce((sum, item) => sum + STATUS_FRACTION[secondaryStatus.get(item.name) ?? 'missing'], 0);
  const secondaryScore = key.secondary.length > 0
    ? Math.round((secondaryFractions / key.secondary.length) * maxSecondary)
    : 0;

  const evidenceText = input.evidence ?? '';
  const evidenceHits: string[] = [];
  const evidenceMisses: string[] = [];
  const evidencePointMax = key.evidence.length > 0 ? maxEvidence / key.evidence.length : 0;
  let evidenceFractions = 0;
  for (const point of key.evidence) {
    const judgement = judgements?.[`evidence:${point.id}`];
    const fallbackHit = hitsAnyKeyword(evidenceText, point.keywords);
    const status: PointJudgementStatus = !evidenceText.trim() ? 'missing' : judgement?.status ?? (fallbackHit ? 'covered' : 'missing');
    evidenceFractions += STATUS_FRACTION[status];
    if (status !== 'missing') evidenceHits.push(point.label);
    else {
      evidenceMisses.push(point.label);
      missingPoints.push(`诊断依据：缺少「${point.label}」`);
    }
    if (status === 'partial') missingPoints.push(`诊断依据：「${point.label}」部分命中，需补充完整`);
    points.push({
      section: 'evidence',
      id: point.id,
      label: point.label,
      status,
      score: roundPoint(STATUS_FRACTION[status] * evidencePointMax),
      maxScore: roundPoint(evidencePointMax),
      ...(status !== 'missing' && judgement?.evidence ? { evidence: judgement.evidence } : {}),
      ...(status !== 'missing' && judgement?.reason ? { reason: judgement.reason } : {}),
    });
  }
  const evidenceScore = key.evidence.length > 0
    ? Math.round((evidenceFractions / key.evidence.length) * maxEvidence)
    : 0;

  const differentialText = input.differentials ?? '';
  const differentialItems = key.differentials ?? [];
  const differentialHits: string[] = [];
  const differentialMisses: string[] = [];
  const differentialPointMax = differentialItems.length > 0 ? maxDifferential / differentialItems.length : 0;
  let differentialFractions = 0;
  for (const [index, item] of differentialItems.entries()) {
    const id = item.id ?? String(index);
    const judgement = judgements?.[`differential:${id}`] ?? judgements?.[`differential:${item.name}`];
    const fallbackHit = matchesDiagnosisName(item, differentialText);
    const status: PointJudgementStatus = !differentialText.trim() ? 'missing' : judgement?.status ?? (fallbackHit ? 'covered' : 'missing');
    differentialFractions += STATUS_FRACTION[status];
    if (status !== 'missing') differentialHits.push(item.name);
    else {
      differentialMisses.push(item.name);
      missingPoints.push(`鉴别诊断：需写「${item.name}」`);
    }
    if (status === 'partial') missingPoints.push(`鉴别诊断：「${item.name}」部分命中，需补充完整`);
    points.push({
      section: 'differential',
      id,
      label: item.name,
      status,
      score: roundPoint(STATUS_FRACTION[status] * differentialPointMax),
      maxScore: roundPoint(differentialPointMax),
      ...(status !== 'missing' && judgement?.evidence ? { evidence: judgement.evidence } : {}),
      ...(status !== 'missing' && judgement?.reason ? { reason: judgement.reason } : {}),
    });
  }
  const differentialScore = differentialItems.length > 0
    ? Math.round((differentialFractions / differentialItems.length) * maxDifferential)
    : 0;

  const managementText = input.management ?? '';
  const managementHits: string[] = [];
  const managementMisses: string[] = [];
  const managementPointMax = key.management.length > 0 ? maxManagement / key.management.length : 0;
  let managementFractions = 0;
  for (const point of key.management) {
    const judgement = judgements?.[`management:${point.id}`];
    const fallbackHit = hitsAnyKeyword(managementText, point.keywords);
    const status: PointJudgementStatus = !managementText.trim() ? 'missing' : judgement?.status ?? (fallbackHit ? 'covered' : 'missing');
    managementFractions += STATUS_FRACTION[status];
    if (status !== 'missing') managementHits.push(point.label);
    else {
      managementMisses.push(point.label);
      missingPoints.push(`处理原则：缺少「${point.label}」`);
    }
    if (status === 'partial') missingPoints.push(`处理原则：「${point.label}」部分命中，需补充完整`);
    points.push({
      section: 'management',
      id: point.id,
      label: point.label,
      status,
      score: roundPoint(STATUS_FRACTION[status] * managementPointMax),
      maxScore: roundPoint(managementPointMax),
      ...(status !== 'missing' && judgement?.evidence ? { evidence: judgement.evidence } : {}),
      ...(status !== 'missing' && judgement?.reason ? { reason: judgement.reason } : {}),
    });
  }
  const managementScore = key.management.length > 0
    ? Math.round((managementFractions / key.management.length) * maxManagement)
    : 0;

  const totalScore = primaryScore + secondaryScore + evidenceScore + differentialScore + managementScore;
  const maxScore = WEIGHTS.primary + maxSecondary + maxEvidence + maxDifferential + maxManagement;

  return {
    totalScore,
    maxScore,
    diagnosis: { primaryHit, primaryScore, secondaryHits, secondaryMisses, secondaryScore },
    evidence: { hits: evidenceHits, misses: evidenceMisses, score: evidenceScore, maxScore: maxEvidence },
    differential: {
      applicable: differentialApplicable,
      hits: differentialHits,
      misses: differentialMisses,
      score: differentialScore,
      maxScore: maxDifferential,
    },
    management: { hits: managementHits, misses: managementMisses, score: managementScore, maxScore: maxManagement },
    points: points.map((point) => ({ ...point, stage: point.section === 'management' ? 'plan' : 'assessment' })),
    missingPoints,
  };
}

/** 学生提交条目数超过「第一 + 第二 + 第三」时给出提示，用于界面约束，不参与判分。 */
export function diagnoseSecondaryOverflow(input: DiagnosisAnswerInput): boolean {
  return splitEntries(input.secondary).length > MAX_SECONDARY;
}

export const DIAGNOSIS_DISCLAIMER = '本页为教学练习反馈：标准答案由授课教师提供并可核验，判分只做名称匹配与要点覆盖，不做语义推断，不计入临床成绩。';