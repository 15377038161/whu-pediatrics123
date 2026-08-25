import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { drainChaoxingOutbox } from '@/lib/chaoxing-sync';

export async function POST(request: NextRequest) {
  const expected = process.env.SYNC_WORKER_SECRET?.trim();
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return fail({ code: 'FORBIDDEN', message: '同步任务仅允许服务端调用。', retryable: false }, undefined, 403);
  }
  try {
    return ok(await drainChaoxingOutbox());
  } catch (error) {
    return fail(errorFromUnknown(error), undefined, 503);
  }
}
