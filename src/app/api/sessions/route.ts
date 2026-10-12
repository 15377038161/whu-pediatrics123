import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { projectSessionForRole, projectSessionsForRole } from '@/lib/session-projection';
import { requireAuth } from '@/lib/request-auth';
import { createSessionSchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    const sessions = await new AgentRepository(user).listOwnSessions();
    return ok(projectSessionsForRole(sessions, user.role));
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    const parsed = createSessionSchema.safeParse(await request.json());
    if (!parsed.success) return fail({ code: 'INVALID_REQUEST', message: '训练模式无效。', retryable: false }, undefined, 422);
    const session = await new AgentRepository(user).createSession(parsed.data.mode, parsed.data.caseId, parsed.data.focus);
    // 防透题投影：建会话响应同样中性化（sourceName 中性标题、tests 剥离）
    return ok(projectSessionForRole(session, user.role), undefined, 201);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'CASE_NOT_FOUND' ? 404 : detail.code === 'CASE_UNPUBLISHED' || detail.code === 'CASE_INSUFFICIENT' ? 403 : 500);
  }
}
