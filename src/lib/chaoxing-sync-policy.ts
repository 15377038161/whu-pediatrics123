export type SyncFailurePlan = {
  status: 'retry' | 'failed';
  attemptCount: number;
  nextAttemptAt: string;
};

const RETRYABLE_CLIENT_STATUS = new Set([408, 409, 425, 429]);

export function planSyncFailure(currentAttemptCount: number, httpStatus: number | null, now = Date.now()): SyncFailurePlan {
  const attemptCount = Math.max(0, currentAttemptCount) + 1;
  const permanentClientError = httpStatus !== null
    && httpStatus >= 400
    && httpStatus < 500
    && !RETRYABLE_CLIENT_STATUS.has(httpStatus);
  const status = permanentClientError || attemptCount >= 8 ? 'failed' : 'retry';
  const delayMinutes = status === 'failed' ? 0 : Math.min(6 * 60, 2 ** attemptCount);
  return {
    status,
    attemptCount,
    nextAttemptAt: new Date(now + delayMinutes * 60_000).toISOString(),
  };
}
