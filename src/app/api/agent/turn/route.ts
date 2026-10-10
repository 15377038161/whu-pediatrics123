import { NextRequest } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import type { AgentEvent } from '@/domain/agent';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { runAgentTurn } from '@/lib/agent-engine';
import { AgentRepository } from '@/lib/repository';
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
    return ok(result);
  } catch (error) {
    const detail = errorFromUnknown(error);
    console.error(`[turn] ${request.method} /api/agent/turn failed code=${detail.code}:`, error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'SESSION_NOT_FOUND' ? 404 : detail.code === 'RPC_UNAVAILABLE' ? 503 : 409;
    return fail(detail, undefined, status);
  }
}
