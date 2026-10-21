import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { listVisibleLearningResources } from '@/lib/learning-resource';

export const dynamic = 'force-dynamic';

/**
 * 学生可见学习资源列表（GET /api/resources）：
 * 经受控 RPC resource_list_student——仅已发布资源（platform 或本人可见班级），
 * 含本人断点进度与最近学习时间；学生不可直读资源表。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const db = getSupabaseUserClient(user.accessToken);
    return ok({ resources: await listVisibleLearningResources(db) });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500);
  }
}
