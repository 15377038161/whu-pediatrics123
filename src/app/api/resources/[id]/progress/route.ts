import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { parsePositionSeconds, saveResourceProgress } from '@/lib/learning-resource';

export const dynamic = 'force-dynamic';

/**
 * 观看进度保存（POST /api/resources/[id]/progress）：
 * 仅本人断点位置（0..24h 整数秒），经受控 RPC resource_progress_upsert 幂等更新（范围校验在 RPC 内强制）；
 * 进度仅用于断点续播，不当掌握程度、不入临床评分、不对外暴露。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request, 'student');
    if (!isDatabaseConfigured()) return fail({ code: 'DATABASE_NOT_CONFIGURED', message: '数据库尚未配置。', retryable: false }, undefined, 503);
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const positionSeconds = parsePositionSeconds((body as { positionSeconds?: unknown } | null)?.positionSeconds);
    if (positionSeconds === null) throw new Error('INVALID_REQUEST');
    const db = getSupabaseUserClient(user.accessToken);
    return ok(await saveResourceProgress(db, id, positionSeconds));
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'INVALID_REQUEST' ? 400 : detail.code === 'RESOURCE_NOT_FOUND' ? 404 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500);
  }
}
