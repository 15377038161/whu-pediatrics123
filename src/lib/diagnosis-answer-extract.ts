import type { Message } from 'coder-coding-dev-sdk';
import {
  buildExtractionPrompt,
  buildExtractedAnswer,
  type ExtractedCaseAnswer,
} from '@/domain/diagnosis-answer-extract';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { invokeCozeAI } from '@/lib/coze-ai';
import { readTeacherCaseData, type TeacherCaseData } from '@/lib/teacher-case-data';

const MODEL_NAME = process.env.COZE_AI_ROLE_MODEL || 'doubao-seed-1-8-251228';
/** 结果按病例内容指纹缓存，避免教师反复复核时重复消耗模型配额；进程内即可，重启后重新生成。 */
const CACHE_LIMIT = 120;
const cache = new Map<string, ExtractedCaseAnswer>();

export class DiagnosisExtractionError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'DiagnosisExtractionError';
    this.code = code;
  }
}

export interface ExtractionDeps {
  readCase?: (caseId: string, version?: string | null) => TeacherCaseData | null;
  /** 注入式模型调用，测试可替换，不消耗配额。 */
  generate?: (messages: Message[]) => Promise<string>;
}

async function defaultGenerate(messages: Message[], forwardHeaders?: Record<string, string>): Promise<string> {
  const result = await invokeCozeAI({
    messages,
    llmConfig: { model: MODEL_NAME, temperature: 0, thinking: 'disabled', caching: 'disabled', maxTokens: 1600 },
    forwardHeaders,
    maxAttempts: 2,
  });
  return result.content;
}

function remember(key: string, value: ExtractedCaseAnswer): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/** 仅供测试与进程内诊断使用，不参与业务逻辑。 */
export function clearExtractionCache(): void {
  cache.clear();
}

export interface ExtractionResult extends ExtractedCaseAnswer {
  caseId: string;
  /** 病例内容指纹：内容一变，缓存与复核结论自动失效。 */
  version: string;
  model: string;
  cached: boolean;
}

/**
 * 教师复核用的标答抽取：读原件 → 让模型只做逐字切分 → 本地回校原文 → 返回可核对条目。
 * 模型失败或输出不合法都明确抛错，不返回半成品、不用规则猜测兜底。
 */
export async function extractCaseAnswer(
  caseId: string,
  options: { version?: string | null; forwardHeaders?: Record<string, string>; deps?: ExtractionDeps } = {},
): Promise<ExtractionResult> {
  const record = (options.deps?.readCase ?? readTeacherCaseData)(caseId, options.version ?? null);
  if (!record) throw new DiagnosisExtractionError('CASE_NOT_FOUND');
  const diagnosisText = record.sections.diagnosis.trim();
  const planText = record.sections.plan.trim();
  if (!diagnosisText && !planText) throw new DiagnosisExtractionError('SOURCE_ANSWER_EMPTY');

  const version = computeCaseDataVersion(record);
  const key = `${record.caseId}:${version}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, caseId: record.caseId, version, model: MODEL_NAME, cached: true };

  const prompt = buildExtractionPrompt({
    complaint: record.complaint,
    age: record.age,
    sex: record.sex,
    diagnosisText,
    planText,
  });
  const generate = options.deps?.generate ?? ((messages: Message[]) => defaultGenerate(messages, options.forwardHeaders));

  let content: string;
  try {
    content = await generate([{ role: 'user', content: prompt }]);
  } catch (error) {
    throw new DiagnosisExtractionError(error instanceof DiagnosisExtractionError ? error.code : 'MODEL_UNAVAILABLE');
  }

  let answer: ExtractedCaseAnswer;
  try {
    answer = buildExtractedAnswer(content, { diagnosisText, planText });
  } catch {
    throw new DiagnosisExtractionError('MODEL_RESPONSE_INVALID');
  }
  if (answer.diagnoses.length === 0 && answer.management.length === 0) {
    throw new DiagnosisExtractionError('EXTRACTION_EMPTY');
  }

  remember(key, answer);
  return { ...answer, caseId: record.caseId, version, model: MODEL_NAME, cached: false };
}
