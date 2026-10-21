import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { getTeacherPlaybackLink, getTeacherResource, isUuid, resolveTeacherResourceContext } from '@/lib/learning-resource-teacher';

export const dynamic = 'force-dynamic';

/**
 * 教师预览链接（GET /api/teacher/resources/:id/playback）：
 * - RLS 限定：本人资源（含草稿）或其他教师已发布资源（教学协作预览）；
 * - 以库内登记的 fileId 换取带期限链接（默认 1 小时），与学生端同一契约；
 * fileId 只来自库内登记，不接受客户端传入；URL 不持久化、不做开放代理。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { db } = await resolveTeacherResourceContext(request);
    const { id } = await context.params;
    if (!isUuid(id)) return fail({ code: 'INVALID_REQUEST', message: '资源编号无效。', retryable: false }, undefined, 400);
    const resource = await getTeacherResource(db, id);
    if (!resource.fileId) return fail({ code: 'FILE_REQUIRED', message: '该资源尚未绑定文件，请先绑定后再预览。', retryable: false }, undefined, 409);
    const link = await getTeacherPlaybackLink(resource.fileId);
    return ok({
      kind: resource.kind,
      title: resource.title,
      fileName: link.fileName,
      url: link.url,
      expiresAt: link.expiresAt,
    });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401
      : detail.code === 'FORBIDDEN' ? 403
      : detail.code === 'RESOURCE_NOT_FOUND' ? 404
      : detail.code === 'FILE_REQUIRED' ? 409
      : detail.code === 'FILE_UNAVAILABLE' || detail.code === 'DATABASE_NOT_CONFIGURED' ? 503
      : 500);
  }
}
