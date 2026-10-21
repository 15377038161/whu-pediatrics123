/**
 * AI 题目生成服务（阶段 F / AI 题库闭环）：
 * - 统一经 invokeCozeAI（重试/超时/降级由网关层处理），不新建 LLM 客户端；
 * - 生成结果为草稿：Zod schema 严格校验（选项唯一、answer ∈ options、题干/解析非空），
 *   任何字段不合格即整批拒绝（AI_GENERATION_INVALID），不落库半残题目；
 * - 教师审核（approve/reject/edit）后才可能进入发布版本快照；发布仅经 quiz_bank_publish RPC。
 * - 生成参数：主题 + 数量（3-10）+ 难度分布 + 补充要求；输出 JSON 数组严格解析。
 */

import { z } from 'zod';
import { invokeCozeAI, type InvokeCozeAIDeps, type InvokeCozeAIOptions } from '@/lib/coze-ai';
import type { ItemDifficulty } from '@/lib/question-bank';

export const generatedQuestionSchema = z.object({
  stem: z.string().trim().min(8).max(600),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(8),
  answer: z.string().trim().min(1).max(200),
  explanation: z.string().trim().min(8).max(2000),
  knowledgePoint: z.string().trim().min(2).max(120).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
}).superRefine((value, context) => {
  const distinct = new Set(value.options);
  if (distinct.size !== value.options.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: '选项存在重复' });
  }
  if (!value.options.includes(value.answer)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['answer'], message: '答案必须为选项之一' });
  }
});

export const generationBatchSchema = z.object({
  topic: z.string().trim().min(2).max(120),
  count: z.number().int().min(3).max(10),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).default('mixed'),
  extraRequirements: z.string().trim().max(400).optional(),
  requestId: z.string().uuid(),
});

export type GenerationBatchInput = z.infer<typeof generationBatchSchema>;

export interface GeneratedQuestion {
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
  knowledgePoint: string | null;
  difficulty: ItemDifficulty;
}

export interface GenerateQuestionsDeps extends InvokeCozeAIDeps {
  /** 测试注入：替代真实 AI 调用，直接返回原始文本。 */
  invokeAI?: (options: InvokeCozeAIOptions) => Promise<string>;
}

const SYSTEM_PROMPT = [
  '你是儿科临床教学命题专家，负责为医学生训练平台编写单项选择题。',
  '要求：',
  '- 题干为自包含的儿科临床情境题（可含简要病史），不引用外部编号或图表；',
  '- 每题 4-5 个选项（A-D 或 A-E 内容本身，不要字母前缀），恰好一个正确答案；',
  '- 解析说明正确答案的依据与常见错误选项的辨析，面向医学本科生；',
  '- 难度梯度准确：easy 为基础记忆与直接判读，medium 需要鉴别诊断推理，hard 需要多步临床决策；',
  '- 只输出 JSON，不要任何解释文字或代码块标记。',
].join('\n');

function buildUserPrompt(input: GenerationBatchInput): string {
  const difficultyText = input.difficulty === 'mixed'
    ? '难度混合分布（约 30% easy、50% medium、20% hard）'
    : `全部为 ${input.difficulty} 难度`;
  const lines = [
    `主题：${input.topic}`,
    `命题数量：${input.count} 题`,
    difficultyText,
    input.extraRequirements ? `补充要求：${input.extraRequirements}` : null,
    '',
    '输出格式（JSON 数组，每个元素结构如下）：',
    '{"stem":"题干","options":["选项1","选项2","选项3","选项4"],"answer":"正确选项（必须与 options 中某项完全一致）","explanation":"解析","knowledgePoint":"知识点（一句话）","difficulty":"easy|medium|hard"}',
    `只输出包含 ${input.count} 个元素的 JSON 数组。`,
  ];
  return lines.filter((line) => line !== null).join('\n');
}

/** 剥离可能的代码块围栏后解析 JSON（LLM 常见包裹形态容错）。 */
export function parseGeneratedQuestions(content: string): GeneratedQuestion[] {
  const stripped = content.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  const raw = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AI_GENERATION_INVALID');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('AI_GENERATION_INVALID');
  return parsed.map((item, index) => {
    const result = generatedQuestionSchema.safeParse(item);
    if (!result.success) {
      throw new Error(`AI_GENERATION_INVALID:第 ${index + 1} 题校验失败（${result.error.issues[0]?.message ?? '格式错误'}）`);
    }
    return {
      stem: result.data.stem,
      options: result.data.options,
      answer: result.data.answer,
      explanation: result.data.explanation,
      knowledgePoint: result.data.knowledgePoint ?? null,
      difficulty: result.data.difficulty,
    };
  });
}

export interface GenerateQuestionsResult {
  questions: GeneratedQuestion[];
  rawContentLength: number;
}

/** 调用 AI 生成题目草稿（不落库；落库幂等由仓储层按 generationId 处理）。 */
export async function generateQuestions(
  input: GenerationBatchInput,
  deps?: GenerateQuestionsDeps,
): Promise<GenerateQuestionsResult> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(input) },
  ];
  const options: InvokeCozeAIOptions = {
    messages,
    timeoutMs: 60_000,
    maxAttempts: 2,
  };
  const response = deps?.invokeAI
    ? { content: await deps.invokeAI(options), attempts: 1 }
    : await invokeCozeAI(options, deps);
  const questions = parseGeneratedQuestions(response.content);
  if (questions.length < input.count) {
    throw new Error(`AI_GENERATION_INVALID:生成数量不足（${questions.length}/${input.count}）`);
  }
  return { questions: questions.slice(0, input.count), rawContentLength: response.content.length };
}
