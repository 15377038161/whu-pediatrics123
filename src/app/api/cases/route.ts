import { NextRequest } from 'next/server';
import { FLAGSHIP_CASE } from '@/domain/case';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireUser } from '@/lib/request-auth';

export async function GET(request: NextRequest) {
  try {
    await requireUser(request);
    return ok([{ ...FLAGSHIP_CASE, history: undefined, exams: undefined, tests: undefined }]);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 500);
  }
}
