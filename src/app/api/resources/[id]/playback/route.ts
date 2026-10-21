import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { getResourcePlaybackLink, getVisibleLearningResource } from '@/lib/learning-resource';

export const dynamic = 'force-dynamic';

/**
 * 播放/查看链接（GET /api/resources/[id]/playback）：
 * 1. 先经 resource_get_student RPC 强制可见范围（不可见一律 RESOURCE_NOT_FOUND，不泄露存在性）；
 * 2. 再以库内登记的 fileId 经 StorageClient.getFile 换取带期限链接（默认 1 小时，过期前端重新请求）；
 * fileId 只来自库内登记，不接受客户端传入；URL 不持久化、不暴露存储凭据、不做开放 URL 代理。
 * 资源下架后新请求被拒；已发出的链接能否提前撤销以存储能力为准（如实口径，不承诺即刻撤销）。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const { id } = await context.params;
    const db = getSupabaseUserClient(user.accessToken);
    const detail = await getVisibleLearningResource(db, id);
    if (!detail.fileId) return fail({ code: 'FILE_REQUIRED', message: '该资源尚未绑定文件，暂时无法播放。', retryable: false }, undefined, 409);
    const link = await getResourcePlaybackLink(detail.fileId);
    return ok({
      kind: detail.kind,
      title: detail.title,
      fileName: link.fileName,
      url: link.url,
      expiresAt: link.expiresAt,
    });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'RESOURCE_NOT_FOUND' ? 404 : detail.code === 'FILE_UNAVAILABLE' ? 503 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500);
  }
}
