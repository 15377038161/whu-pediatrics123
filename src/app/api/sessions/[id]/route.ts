import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { requireUser } from '@/lib/request-auth';
import { isTrainableCase } from '@/domain/case-catalog';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    const session = await new AgentRepository(user).getSession(id);
    if (!isTrainableCase(session.caseId)) throw new Error('CASE_NOT_FOUND');
    return ok(session);
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'SESSION_NOT_FOUND' || detail.code === 'CASE_NOT_FOUND' ? 404 : 500;
    return fail(detail, undefined, status);
  }
}
