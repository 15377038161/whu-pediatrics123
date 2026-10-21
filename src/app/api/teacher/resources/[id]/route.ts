import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import {
  deleteTeacherResource,
  getResourceVisibility,
  getTeacherResource,
  isUuid,
  resolveTeacherResourceContext,
  updateResourceSchema,
  updateTeacherResource,
} from '@/lib/learning-resource-teacher';

export const dynamic = 'force-dynamic';

/**
 * 资源详情/编辑/删除：
 * - GET    /api/teacher/resources/:id   详情 + 已授权班级
 * - PATCH  /api/teacher/resources/:id   编辑元数据（不改状态；owner/scope 由触发器保护）
 * - DELETE /api/teacher/resources/:id    仅草稿可删（已发布/下架资源保留学生进度历史）
 * 行级权限交给 RLS（维护者或项目管理员）；读不到一律 RESOURCE_NOT_FOUND。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await resolveTeacherResourceContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '资源编号无效。', retryable: false }, undefined, 400);
    const [resource, visibility] = await Promise.all([
      getTeacherResource(db, id),
      getResourceVisibility(db, id),
    ]);
    return ok({ resource, visibility });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'RESOURCE_NOT_FOUND' ? 404 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await resolveTeacherResourceContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '资源编号无效。', retryable: false }, undefined, 400);
    const body = await request.json().catch(() => null);
    const parsed = updateResourceSchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '资源信息无效（标题 2-120 字；时长为不超过 24 小时的秒数）。', retryable: false }, undefined, 400);
    }
    const resource = await updateTeacherResource(db, id, parsed.data);
    return ok({ resource });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'RESOURCE_NOT_FOUND' ? 404 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : detail.code === 'RPC_UNAVAILABLE' ? 503 : 500);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await resolveTeacherResourceContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '资源编号无效。', retryable: false }, undefined, 400);
    await deleteTeacherResource(db, id);
    return ok({ deleted: true });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'RESOURCE_NOT_FOUND' ? 404 : detail.code === 'DELETE_DRAFT_ONLY' ? 409 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500);
  }
}
