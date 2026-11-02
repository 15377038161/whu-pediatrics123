import { NextRequest } from 'next/server';
import { z } from 'zod';
import { STAGE_ORDER, type Stage } from '@/domain/agent';
import { fail, ok } from '@/lib/api-result';
import {
  DirectionHintError,
  generateDirectionHint,
  getDirectionHintQuota,
  invokeDirectionHintModel,
  DIRECTION_HINT_SLOT_PREFIX,
  type DirectionHintInsert,
  type DirectionHintStore,
} from '@/lib/direction-hint';
import { platformForwardHeaders } from '@/lib/platform-forward-headers';
import { AgentRepository } from '@/lib/repository';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient } from '@/lib/supabase-client';

const requestSchema = z.object({
  clientEventId: z.string().uuid(),
  stage: z.enum(STAGE_ORDER as [Stage, ...Stage[]]),
}).strict();

function userStore(accessToken: string): DirectionHintStore {
  const db = getSupabaseUserClient(accessToken);
  return {
    async list(sessionId) {
      const { data, error } = await db.from('agent_call_records')
        .select('client_event_id,trace')
        .eq('session_id', sessionId)
        .in('client_event_id', [1, 2, 3].map((slot) => `${DIRECTION_HINT_SLOT_PREFIX}${slot}`));
      if (error) throw error;
      return (data ?? []).map((row) => ({ clientEventId: row.client_event_id, trace: row.trace }));
    },
    async insert(input: DirectionHintInsert) {
      const { error } = await db.from('agent_call_records').insert({
        session_id: input.sessionId,
        client_event_id: input.clientEventId,
        execution: 'model',
        model_name: input.model,
        duration_ms: input.durationMs,
        trace: [{
          kind: 'direction_hint',
          label: 'AI 方向提示',
          requestId: input.requestId,
          stage: input.stage,
          hint: input.hint,
          sourceIds: [],
        }],
      });
      if (!error) return 'inserted';
      if (error.code === '23505') return 'conflict';
      throw error;
    },
  };
}

function hintFail(error: unknown) {
  const code = error instanceof DirectionHintError ? error.code : error instanceof Error ? error.message : 'INTERNAL_ERROR';
  const known: Record<string, { message: string; status: number; retryable: boolean }> = {
    AUTH_REQUIRED: { message: '请先登录。', status: 401, retryable: false },
    FORBIDDEN: { message: '仅接诊学生本人可使用 AI 方向提示。', status: 403, retryable: false },
    SESSION_NOT_FOUND: { message: '未找到本次接诊记录。', status: 404, retryable: false },
    HINT_DISABLED: { message: 'OSCE 考核不提供 AI 方向提示。', status: 403, retryable: false },
    HINT_UNAVAILABLE: { message: '当前身份无法使用 AI 方向提示。', status: 503, retryable: true },
    HINT_QUOTA_EXHAUSTED: { message: '本次接诊的 3 次 AI 方向提示已用完。', status: 429, retryable: false },
    HINT_REQUEST_CONFLICT: { message: '该提示请求已用于其他阶段，请刷新后重试。', status: 409, retryable: false },
    HINT_STAGE_MISMATCH: { message: '接诊阶段已变化，请刷新后重试。', status: 409, retryable: false },
    HINT_INVALID_RESPONSE: { message: 'AI 提示未通过安全校验，本次不扣次数，请重试。', status: 503, retryable: true },
  };
  const detail = known[code] ?? { message: 'AI 方向提示暂时不可用，本次不扣次数，请稍后重试。', status: 503, retryable: true };
  return fail({ code, message: detail.message, retryable: detail.retryable }, undefined, detail.status);
}

async function authorizedSession(request: NextRequest, id: string) {
  const user = await requireAuth(request, 'student');
  const session = await new AgentRepository(user).getSession(id);
  if (session.userId !== user.id) throw new Error('FORBIDDEN');
  if (session.mode === 'osce') throw new DirectionHintError('HINT_DISABLED');
  if (!user.accessToken) throw new DirectionHintError('HINT_UNAVAILABLE');
  return { user, session };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, session } = await authorizedSession(request, id);
    return ok(await getDirectionHintQuota(userStore(user.accessToken!), session.id));
  } catch (error) {
    return hintFail(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, session } = await authorizedSession(request, id);
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) return fail({ code: 'INVALID_REQUEST', message: '提示请求参数无效。', retryable: false }, undefined, 422);
    if (parsed.data.stage !== session.stage) throw new DirectionHintError('HINT_STAGE_MISMATCH');
    const result = await generateDirectionHint(session, parsed.data.clientEventId, {
      store: userStore(user.accessToken!),
      generate: (messages) => invokeDirectionHintModel(messages, platformForwardHeaders(request.headers, user.accessToken)),
    });
    return ok(result);
  } catch (error) {
    return hintFail(error);
  }
}
