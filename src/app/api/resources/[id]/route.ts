import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { getVisibleLearningResource } from '@/lib/learning-resource';

export const dynamic = 'force-dynamic';

/**
 * 学生资源详情（GET /api/resources/[id]）：
 * 经受控 RPC resource_get_student 强制可见性（不可见一律 RESOURCE_NOT_FOUND，不泄露存在性）；
 * fileId 在服务端剥离——客户端只拿元数据与断点进度，播放链接另走 /playback。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const { id } = await context.params;
    const db = getSupabaseUserClient(user.accessToken);
    const detail = await getVisibleLearningResource(db, id);
    const { fileId: _fileId, ...clientDetail } = detail;
    return ok(clientDetail);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'RESOURCE_NOT_FOUND' ? 404 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500);
  }
}
