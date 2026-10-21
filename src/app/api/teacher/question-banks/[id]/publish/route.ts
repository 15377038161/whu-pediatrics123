import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { resolveTeacherBankContext, publishBankSchema } from '@/lib/question-bank-api';
import { getQuestionBank, isUuid, publishQuestionBank } from '@/lib/question-bank';

export const dynamic = 'force-dynamic';

/**
 * 题集发布/再发布（受控 RPC quiz_bank_publish）：
 * - POST /api/teacher/question-banks/:id/publish  { visibility? }
 * - 原子完成：审核校验（至少 1 题审核通过）→ 选项唯一性校验 → 版本快照冻结 → 状态/可见性迁移；
 * - 权限在 RPC 内强制：普通教师仅本人题集；platform 可见性仅项目管理员可设定/保持；
 * - 已有批次始终按其绑定版本判分，再发布生成新版本，不影响进行中与已完成练习。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, isAdmin } = await resolveTeacherBankContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '题集编号无效。', retryable: false }, undefined, 400);
    const body = await request.json().catch(() => ({}));
    const parsed = publishBankSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '发布参数无效。', retryable: false }, undefined, 400);
    }
    const bank = await getQuestionBank(db, id);
    if (!bank) return fail({ code: 'BANK_NOT_FOUND', message: '未找到该题集（或不在你的管理范围内）。', retryable: false }, undefined, 404);
    if (parsed.data.visibility === 'platform' && bank.visibility !== 'platform') {
      // 应用层预检：普通教师请求 platform 直接拒绝（RPC 内再次强制，双重保险）
      if (!isAdmin) {
        return fail({ code: 'FORBIDDEN', message: '全平台发布仅项目管理员可设置，普通教师请使用班级范围发布。', retryable: false }, undefined, 403);
      }
    }
    const result = await publishQuestionBank(db, id, parsed.data.visibility ?? null);
    return ok({ publish: result });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503
      : detail.code === 'BANK_NOT_FOUND' ? 404
      : detail.code === 'NO_APPROVED_ITEMS' || detail.code === 'DUPLICATE_OPTIONS' ? 400
      : 500;
    return fail(detail, undefined, status);
  }
}
