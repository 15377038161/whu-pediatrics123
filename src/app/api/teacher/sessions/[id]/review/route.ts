import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { requireAuth } from '@/lib/request-auth';

/**
 * 教师复核学生报告（批次4）：POST 追加复核留痕（append-only），理由必填；
 * confirm 取原分，adjust 分数由服务端 clamp（不越过可评价满分/分项满分）。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request, 'teacher');
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail({ code: 'INVALID_REQUEST', message: '复核请求无效。', retryable: false }, undefined, 422);
    const action = body.action;
    if (action !== 'confirm' && action !== 'adjust') return fail({ code: 'INVALID_REQUEST', message: '复核类型无效。', retryable: false }, undefined, 422);
    const comment = typeof body.comment === 'string' ? body.comment : '';
    if (comment.trim() === '') return fail({ code: 'INVALID_REQUEST', message: '复核理由必填，请填写复核依据。', retryable: false }, undefined, 422);
    const adjustedTotalScore = typeof body.adjustedTotalScore === 'number' && Number.isFinite(body.adjustedTotalScore) ? body.adjustedTotalScore : 0;
    const rawEvidence = Array.isArray(body.adjustedEvidence) ? body.adjustedEvidence : [];
    const adjustedEvidence = rawEvidence.flatMap((item) => {
      const entry = item as { code?: unknown; score?: unknown };
      if (typeof entry.code !== 'string' || typeof entry.score !== 'number' || !Number.isFinite(entry.score)) return [];
      return [{ code: entry.code, score: entry.score }];
    });
    const result = await new AgentRepository(user).reviewStudentReport(id, {
      action,
      adjustedTotalScore,
      ...(adjustedEvidence.length > 0 ? { adjustedEvidence } : {}),
      comment,
    });
    return ok(result, undefined, 201);
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'SESSION_NOT_FOUND' || detail.code === 'REPORT_NOT_FOUND' ? 404 : detail.code === 'REVIEW_COMMENT_REQUIRED' || detail.code === 'INVALID_REQUEST' || detail.code === 'REVIEW_EVIDENCE_UNKNOWN' ? 422 : 500;
    return fail(detail, undefined, status);
  }
}
