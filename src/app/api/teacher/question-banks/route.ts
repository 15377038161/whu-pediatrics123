import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { resolveTeacherBankContext, createBankSchema } from '@/lib/question-bank-api';
import { createQuestionBank, listQuestionBanks } from '@/lib/question-bank';

export const dynamic = 'force-dynamic';

/**
 * 教师题集管理 API（阶段 F / AI 题库闭环）：
 * - GET  /api/teacher/question-banks          题集列表（RLS：本人题集；项目管理员可见全部）
 * - POST /api/teacher/question-banks          新建题集草稿（owner = 当前教师，RLS with check 强制）
 * 行级权限全部交给 RLS；发布/作答/学生可见性经受控 RPC，本路由不涉及。
 */
export async function GET(request: NextRequest) {
  try {
    const { db, isAdmin } = await resolveTeacherBankContext(request);
    const banks = await listQuestionBanks(db);
    return ok({ banks, isAdmin });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500;
    return fail(detail, undefined, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, userId } = await resolveTeacherBankContext(request);
    const body = await request.json().catch(() => null);
    const parsed = createBankSchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '题集信息无效（标题必填，2-120 字）。', retryable: false }, undefined, 400);
    }
    const bank = await createQuestionBank(db, userId, {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      topic: parsed.data.topic ?? null,
    });
    return ok({ bank }, undefined, 201);
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500;
    return fail(detail, undefined, status);
  }
}
