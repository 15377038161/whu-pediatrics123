import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { requireUser } from '@/lib/request-auth';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request, 'teacher');
    return ok(await new AgentRepository(user).listTeacherStudents());
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 403);
  }
}
