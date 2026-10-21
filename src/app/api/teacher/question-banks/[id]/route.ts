import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { resolveTeacherBankContext, updateBankSchema } from '@/lib/question-bank-api';
import {
  canTransitionBankStatus,
  deleteQuestionBank,
  getQuestionBank,
  updateQuestionBank,
  isUuid,
} from '@/lib/question-bank';

export const dynamic = 'force-dynamic';

/**
 * 教师题集单项 API：
 * - GET    /api/teacher/question-banks/:id   题集详情（含条目与版本历史；RLS owner/项目管理员）
 * - PATCH  /api/teacher/question-banks/:id   更新元信息或工作流状态（白名单迁移；published 只经发布 RPC）
 * - DELETE /api/teacher/question-banks/:id   删除草稿题集（已发布过版本的一律拒绝，保护学生练习记录）
 */

function failStatus(code: string): number {
  if (code === 'AUTH_REQUIRED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'DATABASE_NOT_CONFIGURED') return 503;
  if (code === 'BANK_NOT_FOUND' || code === 'BANK_HAS_VERSIONS') return 404;
  return 500;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await resolveTeacherBankContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '题集编号无效。', retryable: false }, undefined, 400);
    const bank = await getQuestionBank(db, id);
    if (!bank) return fail({ code: 'BANK_NOT_FOUND', message: '未找到该题集（或不在你的管理范围内）。', retryable: false }, undefined, 404);
    return ok({ bank });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failStatus(detail.code));
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await resolveTeacherBankContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '题集编号无效。', retryable: false }, undefined, 400);
    const body = await request.json().catch(() => null);
    const parsed = updateBankSchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '题集更新内容无效。', retryable: false }, undefined, 400);
    }
    const bank = await getQuestionBank(db, id);
    if (!bank) return fail({ code: 'BANK_NOT_FOUND', message: '未找到该题集（或不在你的管理范围内）。', retryable: false }, undefined, 404);
    if (parsed.data.status && !canTransitionBankStatus(bank.status, parsed.data.status)) {
      return fail({ code: 'INVALID_STATUS_TRANSITION', message: '题集状态不允许这样变更（发布需经「发布」操作完成）。', retryable: false }, undefined, 400);
    }
    await updateQuestionBank(db, id, {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.topic !== undefined ? { topic: parsed.data.topic } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    });
    return ok({ bank: await getQuestionBank(db, id) });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failStatus(detail.code));
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await resolveTeacherBankContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '题集编号无效。', retryable: false }, undefined, 400);
    const bank = await getQuestionBank(db, id);
    if (!bank) return fail({ code: 'BANK_NOT_FOUND', message: '未找到该题集（或不在你的管理范围内）。', retryable: false }, undefined, 404);
    await deleteQuestionBank(db, id);
    return ok({ deleted: true });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, failStatus(detail.code));
  }
}
