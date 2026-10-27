import { NextRequest } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import type { AgentEvent } from '@/domain/agent';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { runAgentTurn } from '@/lib/agent-engine';
import { AgentRepository } from '@/lib/repository';
import { projectSessionForRole } from '@/lib/session-projection';
import { requireAuth } from '@/lib/request-auth';
import { agentTurnSchema } from '@/lib/validation';

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    const parsed = agentTurnSchema.safeParse(await request.json());
    if (!parsed.success) return fail({ code: 'INVALID_REQUEST', message: '操作内容不完整，请检查后重试。', retryable: false }, undefined, 422);
    const repository = new AgentRepository(user);
    const session = await repository.getSession(parsed.data.sessionId);
    const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const result = await runAgentTurn(session, parsed.data.event as AgentEvent, parsed.data.clientEventId, { forwardHeaders, accessToken: user.accessToken });
    await repository.saveSession(result.session);
    await repository.saveAgentCall(result.session.id, parsed.data.clientEventId, result.trace, result.runtime);
    // The facts RPC can expose exam media only after the validated clinical event
    // has been persisted. Re-read that bound projection for the immediate response;
    // ordinary refresh/report readers use the same repository reconstruction.
    const hasSourceExam=parsed.data.event.type==='EXAM_ACTION' && result.session.sourceSnapshotVersion
      && result.session.events.some(event=>event.clientEventId===parsed.data.clientEventId && event.correct===true
        && event.evidenceCodes.some(code=>code.startsWith('SOURCE_EX_')));
    const responseSession=hasSourceExam ? await repository.getSession(result.session.id) : result.session;
    // 防透题投影：学生响应的 caseOptions 中性化（sourceName 替换中性标题、tests 剥离）；
    // 持久化（saveSession）保留完整状态，投影只作用于响应边界。
    return ok({ ...result, session: projectSessionForRole(responseSession, user.role),
      trace: user.role === 'student' ? result.trace.map(item => ({ ...item, sourceIds: [] })) : result.trace });
  } catch (error) {
    const detail = errorFromUnknown(error);
    console.error(`[turn] ${request.method} /api/agent/turn failed code=${detail.code}`);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'SESSION_NOT_FOUND' ? 404 : detail.code === 'RPC_UNAVAILABLE' ? 503 : 409;
    return fail(detail, undefined, status);
  }
}
