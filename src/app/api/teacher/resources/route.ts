import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { createResourceSchema, createTeacherResource, listManagedClasses, listTeacherResources, resolveTeacherResourceContext } from '@/lib/learning-resource-teacher';

export const dynamic = 'force-dynamic';

/**
 * 教师资源管理 API（D10 / 方案第 13 节）：
 * - GET  /api/teacher/resources   资源列表（RLS：本人全部 + 其他教师已发布；项目管理员全部）+ 管理班级清单
 * - POST /api/teacher/resources   新建草稿（触发器对非项目管理员强制 draft/class）
 * 行级权限交给 RLS 与写守卫触发器；发布/下架/可见班级经各自子路由。
 */
export async function GET(request: NextRequest) {
  try {
    const { db, isAdmin } = await resolveTeacherResourceContext(request);
    const [resources, classes] = await Promise.all([
      listTeacherResources(db),
      listManagedClasses(db),
    ]);
    return ok({ resources, classes, isAdmin });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500;
    return fail(detail, undefined, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { db, userId } = await resolveTeacherResourceContext(request);
    const body = await request.json().catch(() => null);
    const parsed = createResourceSchema.safeParse(body);
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '资源信息无效（标题必填，2-120 字；类型为教学视频或图文资料）。', retryable: false }, undefined, 400);
    }
    const resource = await createTeacherResource(db, userId, parsed.data);
    return ok({ resource }, undefined, 201);
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : detail.code === 'RPC_UNAVAILABLE' ? 503 : 500;
    return fail(detail, undefined, status);
  }
}
