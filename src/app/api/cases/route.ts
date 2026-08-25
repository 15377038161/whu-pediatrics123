import { NextRequest } from 'next/server';
import { CASE_CATALOG } from '@/domain/case-catalog';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireUser } from '@/lib/request-auth';

export async function GET(request: NextRequest) {
  try {
    await requireUser(request);
    return ok(CASE_CATALOG);
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 500);
  }
}
