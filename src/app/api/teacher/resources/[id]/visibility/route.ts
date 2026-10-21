import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { isUuid, resolveTeacherResourceContext, getResourceVisibility, setResourceVisibility, visibilitySchema } from '@/lib/learning-resource-teacher';

export const dynamic = 'force-dynamic';

/**
 * 可见班级替换（PUT /api/teacher/resources/:id/visibility { cohortIds }）：
 * - 整批替换授权行；RLS with check 强制 app_manages_class（非本人管辖班级一律拒绝）；
 * - 发布前触发器强制 class 范围至少一个本人管辖班级授权行（VISIBILITY_REQUIRED）；
 * - 空集合仅草稿/平台范围合法；已发布资源调整范围即时生效（新名单立即收口）。
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db, userId } = await resolveTeacherResourceContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '资源编号无效。', retryable: false }, undefined, 400);
    const body = await request.json().catch(() => null);
    const parsed = visibilitySchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '可见班级参数无效（最多 50 个班级）。', retryable: false }, undefined, 400);
    }
    const visibility = await setResourceVisibility(db, id, userId, parsed.data.cohortIds);
    return ok({ visibility });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'RESOURCE_NOT_FOUND' ? 404
      : detail.code === 'DATABASE_NOT_CONFIGURED' || detail.code === 'RPC_UNAVAILABLE' ? 503
      : 500);
  }
}
