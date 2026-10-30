import type { SessionState } from '@/domain/agent';

/** The operation table has one row per request, while a batch can produce several events. */
export function buildClinicalOperationRows(session: Pick<SessionState,'id'|'events'>) {
  const groups = new Map<string, SessionState['events']>();
  for (const event of session.events) groups.set(event.clientEventId,[...(groups.get(event.clientEventId) ?? []),event]);
  return [...groups.values()].map(events => {
    const first=events[0];
    const media=[...new Map(events.flatMap(event=>event.media??[]).map(item=>[item.fileId,item])).values()];
    const correctness=events.map(event=>event.correct);
    return {id:first.id,session_id:session.id,client_event_id:first.clientEventId,event_type:first.type,stage:first.stage,
      payload:{summary:events.map(event=>event.summary).join('\n'),media:media.length?media:null},
      result:{correct:correctness.includes(false)?false:correctness.every(value=>value===true)?true:null,
        evidenceCodes:[...new Set(events.flatMap(event=>event.evidenceCodes))]},created_at:first.createdAt};
  });
}
