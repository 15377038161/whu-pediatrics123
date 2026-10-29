import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { noteRevisionIndexMap, projectNoteForRole } from '@/lib/note-projection';
import { AgentRepository } from '@/lib/repository';
import { requireAuth } from '@/lib/request-auth';

/**
 * 批次6·病历书写模块（学生端）：
 * GET /api/notes?sessionId= → 该会话本人草稿 + 提交列表（书写页初始化一次拿全）；
 * POST /api/notes → 提交病历（内容服务端归一、空提交拒绝、clientEventId 幂等）。
 * 学生投影不含 caseId/caseVersion（内部 teacher-<病名> 含病种名，防透题边界）。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const sessionId = request.nextUrl.searchParams.get('sessionId') ?? undefined;
    const repo = new AgentRepository(user);
    const draft = sessionId ? await repo.getNoteDraft(sessionId) : null;
    const submissions = await repo.listMyNotes(sessionId);
    const revisionIndex = noteRevisionIndexMap(submissions);
    return ok({
      draft,
      submissions: submissions.map((record) => projectNoteForRole(record, user.role, revisionIndex.get(record.id))),
    });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500;
    return fail(detail, undefined, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail({ code: 'INVALID_REQUEST', message: '提交请求无效。', retryable: false }, undefined, 422);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (!sessionId) return fail({ code: 'INVALID_REQUEST', message: '缺少训练会话。', retryable: false }, undefined, 422);
    const clientEventId = typeof body.clientEventId === 'string' && /^[0-9a-fA-F-]{36}$/.test(body.clientEventId) ? body.clientEventId : undefined;
    const record = await new AgentRepository(user).submitNote(sessionId, body.content, clientEventId);
    return ok(projectNoteForRole(record, user.role), undefined, 201);
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'SESSION_NOT_FOUND' ? 404 : detail.code === 'NOTE_EMPTY' || detail.code === 'INVALID_REQUEST' ? 422 : 500;
    return fail(detail, undefined, status);
  }
}
