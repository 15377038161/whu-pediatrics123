import type {ClinicalEvent,SessionState} from './agent';

/** Actual acquired records, independent of clinical correctness or number of clicks. */
export function diagnosticEvidenceEvents(session:SessionState):ClinicalEvent[] {
  const obtained=new Set([...session.askedIntents,...session.unlockedEvidence]);
  return session.events.filter(event=>{
    if(!['ASK_QUESTION','EXAM_ACTION','ORDER_TEST'].includes(event.type))return false;
    if(event.type!=='ORDER_TEST'&&event.correct===false)return false;
    return event.evidenceCodes.some(code=>code!=='EX_PREP'&&code!=='EX_PROVIDED'&&obtained.has(code));
  });
}
