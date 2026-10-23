import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { requireAuth } from '@/lib/request-auth';
import { findReleasedMedia, getCaseMediaLink } from '@/lib/case-media';

export const dynamic = 'force-dynamic';

/**
 * 病例媒体签名链接（GET /api/sessions/[id]/media?fileId=...）：
 * 1. 会话归属/角色由 AgentRepository.getSession 强制（学生限本人，教师经 RLS）；
 * 2. fileId 仅接受本会话事件中已随结果释放的媒体登记（fail-closed；未释放一律 MEDIA_NOT_FOUND，不泄露存在性）；
 * 3. 以登记 fileId 经 StorageClient.getFile 换带期限链接（1 小时，过期前端重新请求）；
 * URL 不持久化、不暴露存储凭据、不做开放 URL 代理。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const fileId = request.nextUrl.searchParams.get('fileId') ?? '';
    if (!fileId) return fail({ code: 'FILE_ID_REQUIRED', message: '缺少 fileId 参数。', retryable: false }, undefined, 400);
    const session = await new AgentRepository(user).getSession(id);
    const media = findReleasedMedia(session, fileId);
    if (!media) return fail({ code: 'MEDIA_NOT_FOUND', message: '该媒体尚未在本会话中释放。', retryable: false }, undefined, 404);
    const link = await getCaseMediaLink(media.fileId);
    return ok({ kind: media.kind, caption: media.caption, fileName: link.fileName, url: link.url, expiresAt: link.expiresAt });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'SESSION_NOT_FOUND' || detail.code === 'MEDIA_NOT_FOUND' ? 404 : detail.code === 'FILE_UNAVAILABLE' ? 503 : 500;
    return fail(detail, undefined, status);
  }
}
