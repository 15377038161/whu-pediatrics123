import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { requireAuth } from '@/lib/request-auth';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request, 'teacher');
    const { id } = await context.params;
    return ok(await new AgentRepository(user).getStudentProfile(id));
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'STUDENT_NOT_FOUND' ? 404 : 500;
    return fail(detail, undefined, status);
  }
}
