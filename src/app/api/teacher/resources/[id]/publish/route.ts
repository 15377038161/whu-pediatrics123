import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { isUuid, publishResourceSchema, publishTeacherResource, resolveTeacherResourceContext } from '@/lib/learning-resource-teacher';

export const dynamic = 'force-dynamic';

/**
 * 发布资源（POST /api/teacher/resources/:id/publish { scope? }）：
 * - draft→published；前置校验由数据库触发器强制：file_id 非空、class 范围需至少一个本人管辖班级授权行；
 * - scope='platform' 仅项目管理员（应用层预检 + 触发器 SCOPE_PROTECTED 双重保险）；
 * - 已发布后学生立即可见；再次发布走 retired→draft→published 循环。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, isAdmin } = await resolveTeacherResourceContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '资源编号无效。', retryable: false }, undefined, 400);
    const body = await request.json().catch(() => ({}));
    const parsed = publishResourceSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '发布参数无效。', retryable: false }, undefined, 400);
    }
    if (parsed.data.scope === 'platform' && !isAdmin) {
      return fail({ code: 'FORBIDDEN', message: '全平台发布仅项目管理员可设置，普通教师请使用班级范围发布。', retryable: false }, undefined, 403);
    }
    const resource = await publishTeacherResource(db, id, parsed.data.scope);
    return ok({ resource });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'RESOURCE_NOT_FOUND' ? 404
      : detail.code === 'FILE_REQUIRED' || detail.code === 'VISIBILITY_REQUIRED' || detail.code === 'SCOPE_PROTECTED' || detail.code === 'INVALID_STATUS_TRANSITION' ? 400
      : detail.code === 'DATABASE_NOT_CONFIGURED' || detail.code === 'RPC_UNAVAILABLE' ? 503
      : 500);
  }
}
