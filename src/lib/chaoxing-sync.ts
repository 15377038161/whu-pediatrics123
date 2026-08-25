import { getSupabaseAdminClient } from '@/lib/supabase-client';
import { planSyncFailure } from '@/lib/chaoxing-sync-policy';

export type SyncHealth = 'connected' | 'waiting_for_authorization' | 'database_unavailable';

export function chaoxingFormConfigured(): boolean {
  return Boolean(
    process.env.CHAOXING_FORM_WRITE_URL?.trim()
      && process.env.CHAOXING_FORM_WRITE_TOKEN?.trim()
      && process.env.CHAOXING_FORM_ID?.trim(),
  );
}

class ChaoxingSyncHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP_${status}`);
  }
}

export async function drainChaoxingOutbox(limit = 20): Promise<{ processed: number; delivered: number; waiting: number; failed: number }> {
  const admin = getSupabaseAdminClient();
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const now = new Date().toISOString();
  const { data: events, error } = await admin
    .from('sync_outbox')
    .select('id,event_id,payload,attempt_count')
    .in('status', ['pending', 'retry'])
    .lte('next_attempt_at', now)
    .order('created_at', { ascending: true })
    .limit(safeLimit);
  if (error) throw error;

  let delivered = 0;
  let waiting = 0;
  let failed = 0;
  for (const event of events ?? []) {
    if (!chaoxingFormConfigured()) {
      waiting += 1;
      const { error: waitingError } = await admin.from('sync_outbox').update({
        status: 'pending',
        last_error: 'WAITING_FOR_CHAOXING_AUTHORIZATION',
        next_attempt_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      }).eq('id', event.id);
      if (waitingError) throw waitingError;
      continue;
    }

    try {
      const response = await fetch(process.env.CHAOXING_FORM_WRITE_URL!, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.CHAOXING_FORM_WRITE_TOKEN}`,
          'content-type': 'application/json',
          'idempotency-key': event.event_id,
        },
        body: JSON.stringify({ formId: process.env.CHAOXING_FORM_ID, schemaVersion: 1, fields: event.payload }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new ChaoxingSyncHttpError(response.status);
      const { error: deliveredError } = await admin.from('sync_outbox').update({ status: 'delivered', delivered_at: new Date().toISOString(), last_error: null }).eq('id', event.id);
      if (deliveredError) throw deliveredError;
      delivered += 1;
    } catch (syncError) {
      failed += 1;
      const plan = planSyncFailure(Number(event.attempt_count ?? 0), syncError instanceof ChaoxingSyncHttpError ? syncError.status : null);
      const { error: failureError } = await admin.from('sync_outbox').update({
        status: plan.status,
        attempt_count: plan.attemptCount,
        last_error: syncError instanceof Error ? syncError.message.slice(0, 500) : String(syncError).slice(0, 500),
        next_attempt_at: plan.nextAttemptAt,
      }).eq('id', event.id);
      if (failureError) throw failureError;
    }
  }
  return { processed: events?.length ?? 0, delivered, waiting, failed };
}
