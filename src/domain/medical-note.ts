import { z } from 'zod';

/**
 * 批次6·独立病历书写模块领域定义。
 *
 * 模板边界（用户澄清确认 + CASE_WORKFLOW_AND_NOTE_WRITING.md 第4节第6条）：
 * 通用儿科大病历结构仅作为书写表单与完整性检查项，不做自动评分/扣分——
 * 不猜院校模板据此给学生扣分；AI 审阅为独立辅助反馈，不冒充医学审核、不改历史成绩。
 */

/** 通用儿科大病历模板结构版本；结构变化时必须换版（已提交病历保留原 template_version）。 */
export const NOTE_TEMPLATE_VERSION = 'pediatric-general-v1';

/** 模板段键白名单（zod 校验与类型收紧的共同来源）。 */
export const NOTE_SECTION_KEYS = [
  'chiefComplaint',
  'presentIllness',
  'pastHistory',
  'personalHistory',
  'familyHistory',
  'physicalExam',
  'auxiliaryTests',
  'preliminaryDiagnosis',
  'differentialDiagnosis',
  'treatmentPlan',
] as const;
export type NoteSectionKey = (typeof NOTE_SECTION_KEYS)[number];

export interface NoteSectionDef {
  /** content jsonb 中的稳定键 */
  key: NoteSectionKey;
  /** 中文段落名（表单与审阅展示） */
  label: string;
  /** 段落书写提示（引导，不构成计分） */
  hint: string;
  /** 表单必填段落（完整性检查基础项，不自动评分） */
  required: boolean;
}

export const NOTE_TEMPLATE: NoteSectionDef[] = [
  { key: 'chiefComplaint', label: '主诉', hint: '患儿最主要的症状及持续时间，如「发热咳嗽 2 天」。', required: true },
  { key: 'presentIllness', label: '现病史', hint: '起病情况、主要症状特点与演变、伴随症状、诊治经过、一般情况。', required: true },
  { key: 'pastHistory', label: '既往史', hint: '既往疾病、用药、过敏、外伤手术史及与本次发病相关的情况。', required: true },
  { key: 'personalHistory', label: '个人史', hint: '出生史、喂养史、生长发育史、预防接种史（按年龄适用性填写）。', required: false },
  { key: 'familyHistory', label: '家族史', hint: '家族遗传病及传染病接触史（按患儿情况适用性填写）。', required: false },
  { key: 'physicalExam', label: '体格检查', hint: '生命体征及系统查体所见（结合本次接诊实际操作填写）。', required: true },
  { key: 'auxiliaryTests', label: '辅助检查', hint: '已完成的检查项目、结果及时间点；未做的检查写「未做」。', required: false },
  { key: 'preliminaryDiagnosis', label: '初步诊断', hint: '按主次顺序列出诊断意见。', required: true },
  { key: 'differentialDiagnosis', label: '鉴别诊断', hint: '需要鉴别的疾病及鉴别依据。', required: false },
  { key: 'treatmentPlan', label: '诊疗计划', hint: '进一步检查、治疗与随访安排。', required: false },
];

export function sectionLabel(key: string): string {
  return NOTE_TEMPLATE.find((section) => section.key === key)?.label ?? key;
}

/** 病历内容校验（防御：仅已知段键、值必须为字符串；归一函数保证通过）。 */
export const noteContentSchema = z.object(
  Object.fromEntries(NOTE_TEMPLATE.map((section) => [section.key, z.string()])) as Record<NoteSectionKey, z.ZodString>,
).passthrough().superRefine((value, ctx) => {
  for (const [key, text] of Object.entries(value)) {
    if (!NOTE_SECTION_KEYS.includes(key as NoteSectionKey)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `未知段落：${key}` });
      continue;
    }
    if (typeof text !== 'string') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `段落「${sectionLabel(key)}」内容必须是文本` });
    }
  }
});

/**
 * 病历内容：模板段键 → 学生书写文本。
 * 显式 Record 类型（不依赖 z.infer）：zod passthrough 会给推断类型引入 unknown 索引签名，
 * 显式定义保证调用方拿到的值恒为 string。
 */
export type NoteContent = Record<NoteSectionKey, string>;

/** 完整性检查（不评分）：段落完成度由纯函数按内容判断，仅供 AI 审阅与界面提示使用。 */
export type SectionCompleteness = 'written' | 'partial' | 'missing' | 'not_applicable';

export function sectionCompleteness(text: string | undefined, required: boolean): SectionCompleteness {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) return required ? 'missing' : 'not_applicable';
  return trimmed.length >= 8 ? 'written' : 'partial';
}

/**
 * 内容归一（宽容归一，不因前端多传字段/类型漂移拒绝）：仅保留已知模板段键，
 * 值强制为字符串（对象/null 归一为空串）；未知键忽略。
 */
export function normalizeNoteContent(input: unknown): NoteContent {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  for (const section of NOTE_TEMPLATE) {
    const value = source[section.key];
    normalized[section.key] = typeof value === 'string' ? value : '';
  }
  noteContentSchema.parse(normalized);
  return normalized as NoteContent;
}

/** AI 审阅意见条目（引用学生原文或本例已获得证据；漏采提示只描述缺口方向，不输出标准答案结论）。 */
export const reviewIssueSchema = z.object({
  kind: z.enum(['inconsistency', 'omission_unwritten', 'omission_uncollected', 'timeline', 'expression']),
  sectionKey: z.string(),
  quote: z.string().optional(),
  evidence: z.string().optional(),
  suggestion: z.string(),
});

export const reviewSectionSchema = z.object({
  sectionKey: z.string(),
  completeness: z.enum(['written', 'partial', 'missing', 'not_applicable']),
  issues: z.array(reviewIssueSchema),
});

export const noteReviewSchema = z.object({
  summary: z.string(),
  sections: z.array(reviewSectionSchema),
  notableStrengths: z.array(z.string()),
});

export type NoteReviewResult = z.infer<typeof noteReviewSchema>;

/** AI 审阅状态（DB ai_review_status 列同义）。 */
export type NoteReviewStatus = 'pending' | 'ready' | 'failed';

/** 提交行（DB 语义；case_id 仅服务端与教师可见）。 */
export interface NoteSubmissionRecord {
  id: string;
  userId: string;
  sessionId: string;
  caseId: string;
  caseVersion: string | null;
  templateVersion: string;
  content: NoteContent;
  clientEventId: string | null;
  submittedAt: string;
  aiReviewStatus: NoteReviewStatus;
  aiReview: NoteReviewResult | null;
  aiPromptVersion: string | null;
  createdAt: string;
}

/** 草稿行（DB 语义；仅本人可见）。 */
export interface NoteDraftRecord {
  id: string;
  userId: string;
  sessionId: string;
  templateVersion: string;
  content: NoteContent;
  createdAt: string;
  updatedAt: string;
}
