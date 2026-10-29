import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { requireAuth } from '@/lib/request-auth';

/**
 * 批次6·病历草稿（仅本人读写；教师不可见学生草稿，仅查看正式提交）：
 * GET /api/notes/draft?sessionId= → 读取草稿（无则 null）；
 * PUT /api/notes/draft { sessionId, content } → 保存草稿（upsert，内容服务端归一）。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const sessionId = request.nextUrl.searchParams.get('sessionId') ?? '';
    if (!sessionId) return fail({ code: 'INVALID_REQUEST', message: '缺少训练会话。', retryable: false }, undefined, 422);
    return ok(await new AgentRepository(user).getNoteDraft(sessionId));
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500;
    return fail(detail, undefined, status);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail({ code: 'INVALID_REQUEST', message: '保存请求无效。', retryable: false }, undefined, 422);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (!sessionId) return fail({ code: 'INVALID_REQUEST', message: '缺少训练会话。', retryable: false }, undefined, 422);
    return ok(await new AgentRepository(user).saveNoteDraft(sessionId, body.content));
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'SESSION_NOT_FOUND' ? 404 : 500;
    return fail(detail, undefined, status);
  }
}
