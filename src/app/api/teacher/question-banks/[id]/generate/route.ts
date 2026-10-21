import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { resolveTeacherBankContext } from '@/lib/question-bank-api';
import { findGeneratedItems, getQuestionBank, insertGeneratedItems, isUuid } from '@/lib/question-bank';
import { generateQuestions, generationBatchSchema } from '@/lib/question-generation';
import { hasAICredentials } from '@/lib/coze-ai';

export const dynamic = 'force-dynamic';

/**
 * AI 题目生成（教师触发，阶段 F）：
 * - POST /api/teacher/question-banks/:id/generate  { topic, count, difficulty?, extraRequirements?, requestId }
 * - 结果一律为草稿（review_status='draft'），教师审核通过后才可能进入发布版本；
 * - 幂等：同一 requestId（generation_id）重复请求返回既有草稿，不重复插入、不重复消耗 AI 调用；
 * - 生成内容经 Zod 严格校验，任何题目不合格即整批拒绝（不落半残题目）；
 * - AI 凭据未配置时明确返回 AI_NOT_CONFIGURED（不静默降级为假数据）。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await resolveTeacherBankContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '题集编号无效。', retryable: false }, undefined, 400);
    const body = await request.json().catch(() => null);
    const parsed = generationBatchSchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '生成参数无效（主题必填；数量 3-10 题；requestId 必填）。', retryable: false }, undefined, 400);
    }
    const bank = await getQuestionBank(db, id);
    if (!bank) return fail({ code: 'BANK_NOT_FOUND', message: '未找到该题集（或不在你的管理范围内）。', retryable: false }, undefined, 404);

    const existing = await findGeneratedItems(db, id, parsed.data.requestId);
    if (existing.length > 0) {
      return ok({ items: existing, reused: true });
    }

    if (!hasAICredentials()) {
      return fail({ code: 'AI_NOT_CONFIGURED', message: 'AI 服务尚未配置，请联系项目管理员后再试。', retryable: false }, undefined, 503);
    }

    const { questions } = await generateQuestions(parsed.data);
    const items = await insertGeneratedItems(db, id, parsed.data.requestId, questions);
    return ok({ items, reused: false });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503
      : detail.code === 'AI_GENERATION_INVALID' ? 502
      : detail.code === 'AI_TIMEOUT' ? 504
      : 500;
    return fail(detail, undefined, status);
  }
}
