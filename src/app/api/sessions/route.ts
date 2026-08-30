import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { requireUser } from '@/lib/request-auth';
import { createSessionSchema } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request, 'student');
    return ok(await new AgentRepository(user).listOwnSessions());
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request, 'student');
    const parsed = createSessionSchema.safeParse(await request.json());
    if (!parsed.success) return fail({ code: 'INVALID_REQUEST', message: '训练模式无效。', retryable: false }, undefined, 422);
    return ok(await new AgentRepository(user).createSession(parsed.data.mode, parsed.data.caseId, parsed.data.focus), undefined, 201);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 500);
  }
}
