import { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { isUuid, resolveTeacherResourceContext, restoreTeacherResource, retireTeacherResource } from '@/lib/learning-resource-teacher';

export const dynamic = 'force-dynamic';

const statusActionSchema = z.object({ action: z.enum(['retire', 'restore']) }).strict();

/**
 * 资源下架/重新编辑（POST /api/teacher/resources/:id/status { action }）：
 * - retire：published→retired，学生列表立即移除，历史进度保留；
 * - restore：retired→draft，修订后可再次发布；
 * 状态迁移白名单由数据库触发器强制（INVALID_STATUS_TRANSITION）。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await resolveTeacherResourceContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '资源编号无效。', retryable: false }, undefined, 400);
    const body = await request.json().catch(() => null);
    const parsed = statusActionSchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '状态操作无效（仅支持下架 retire / 重新编辑 restore）。', retryable: false }, undefined, 400);
    }
    const resource = parsed.data.action === 'retire'
      ? await retireTeacherResource(db, id)
      : await restoreTeacherResource(db, id);
    return ok({ resource });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'RESOURCE_NOT_FOUND' ? 404
      : detail.code === 'INVALID_STATUS_TRANSITION' ? 400
      : detail.code === 'DATABASE_NOT_CONFIGURED' || detail.code === 'RPC_UNAVAILABLE' ? 503
      : 500);
  }
}
