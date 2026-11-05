import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, ok } from '@/lib/api-result';
import { DiagnosisExtractionError, extractCaseAnswer } from '@/lib/diagnosis-answer-extract';
import { platformForwardHeaders } from '@/lib/platform-forward-headers';
import { requireAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  caseId: z.string().trim().min(1),
  version: z.string().regex(/^[a-f0-9]{16}$/).nullish(),
}).strict();

const ERROR_STATUS: Record<string, { status: number; message: string; retryable: boolean }> = {
  AUTH_REQUIRED: { status: 401, message: '请先登录。', retryable: false },
  FORBIDDEN: { status: 403, message: '仅授课教师可抽取并复核本例标答。', retryable: false },
  CASE_NOT_FOUND: { status: 404, message: '未找到该病例的可核验原件。', retryable: false },
  SOURCE_ANSWER_EMPTY: { status: 422, message: '本例原件没有诊断或诊疗计划内容，无可抽取的标答。', retryable: false },
  MODEL_UNAVAILABLE: { status: 503, message: '模型暂时不可用，请稍后重试；本次不产出任何标答。', retryable: true },
  MODEL_RESPONSE_INVALID: { status: 503, message: '模型输出无法核对，已整批丢弃，请重试。', retryable: true },
  EXTRACTION_EMPTY: { status: 503, message: '模型没有摘取到任何可核对的原文片段，请重试。', retryable: true },
};

/**
 * 教师标答抽取（B6）：把病例原件的诊断段/诊疗计划段交给模型做**逐字切分**，
 * 再由服务端回校原文后返回带行号的条目，供教师复核。
 *
 * 边界：模型不能新增原件以外的内容（每条必须是原件逐字子串，否则丢弃并回报）；
 * 结果只是复核素材，未接入判分，也不下发给学生。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'teacher');
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '请提供有效的 caseId。', retryable: false }, undefined, 422);
    }
    const result = await extractCaseAnswer(parsed.data.caseId, {
      version: parsed.data.version ?? null,
      forwardHeaders: platformForwardHeaders(request.headers, user.accessToken),
    });
    return ok(result);
  } catch (error) {
    const code = error instanceof DiagnosisExtractionError ? error.code : error instanceof Error ? error.message : 'INTERNAL_ERROR';
    const detail = ERROR_STATUS[code] ?? { status: 500, message: '标答抽取暂时不可用，请稍后重试。', retryable: true };
    return fail({ code, message: detail.message, retryable: detail.retryable }, undefined, detail.status);
  }
}
