import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { resolveTeacherBankContext, updateItemSchema } from '@/lib/question-bank-api';
import {
  deleteQuestionBankItem,
  getQuestionBank,
  updateQuestionBankItem,
  isUuid,
} from '@/lib/question-bank';

export const dynamic = 'force-dynamic';

/**
 * 教师题目条目审核/编辑 API：
 * - PATCH  /api/teacher/question-banks/:id/items/:itemId   编辑题干/选项/答案/解析或审核（approve/reject/退回草稿）
 * - DELETE /api/teacher/question-banks/:id/items/:itemId   删除条目（不影响已发布版本快照与进行中批次）
 * 一致性：answer ∈ options 由 schema 与数据库 CHECK 双重校验；发布版本的题目以冻结快照为准，
 * 编辑仅影响下一次发布。
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { db } = await resolveTeacherBankContext(request);
    const { id, itemId } = await context.params;
    if (!isUuid(id) || !isUuid(itemId)) {
      return fail({ code: 'INVALID_REQUEST', message: '编号无效。', retryable: false }, undefined, 400);
    }
    const body = await request.json().catch(() => null);
    const parsed = updateItemSchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: `题目内容无效：${parsed.error.issues[0]?.message ?? '格式错误'}`, retryable: false }, undefined, 400);
    }
    const bank = await getQuestionBank(db, id);
    if (!bank) return fail({ code: 'BANK_NOT_FOUND', message: '未找到该题集（或不在你的管理范围内）。', retryable: false }, undefined, 404);
    const item = bank.items.find((entry) => entry.id === itemId);
    if (!item) return fail({ code: 'ITEM_NOT_FOUND', message: '未找到该题目条目。', retryable: false }, undefined, 404);

    await updateQuestionBankItem(db, id, itemId, {
      ...(parsed.data.stem !== undefined ? { stem: parsed.data.stem } : {}),
      ...(parsed.data.options !== undefined ? { options: parsed.data.options } : {}),
      ...(parsed.data.answer !== undefined ? { answer: parsed.data.answer } : {}),
      ...(parsed.data.explanation !== undefined ? { explanation: parsed.data.explanation } : {}),
      ...(parsed.data.knowledgePoint !== undefined ? { knowledgePoint: parsed.data.knowledgePoint } : {}),
      ...(parsed.data.difficulty !== undefined ? { difficulty: parsed.data.difficulty } : {}),
      ...(parsed.data.reviewStatus !== undefined ? { reviewStatus: parsed.data.reviewStatus } : {}),
    });
    const next = await getQuestionBank(db, id);
    return ok({ item: next?.items.find((entry) => entry.id === itemId) ?? null });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503
      : detail.code === 'BANK_NOT_FOUND' ? 404
      : detail.code === 'ITEM_NOT_FOUND' ? 404
      : 500;
    return fail(detail, undefined, status);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { db } = await resolveTeacherBankContext(request);
    const { id, itemId } = await context.params;
    if (!isUuid(id) || !isUuid(itemId)) {
      return fail({ code: 'INVALID_REQUEST', message: '编号无效。', retryable: false }, undefined, 400);
    }
    const bank = await getQuestionBank(db, id);
    if (!bank) return fail({ code: 'BANK_NOT_FOUND', message: '未找到该题集（或不在你的管理范围内）。', retryable: false }, undefined, 404);
    if (!bank.items.some((entry) => entry.id === itemId)) {
      return fail({ code: 'ITEM_NOT_FOUND', message: '未找到该题目条目。', retryable: false }, undefined, 404);
    }
    await deleteQuestionBankItem(db, id, itemId);
    return ok({ deleted: true });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503
      : detail.code === 'BANK_NOT_FOUND' ? 404
      : detail.code === 'ITEM_NOT_FOUND' ? 404
      : 500;
    return fail(detail, undefined, status);
  }
}
