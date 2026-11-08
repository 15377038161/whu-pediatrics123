import type {AgentEvent,ExamPosition,ExamLocation,SessionState} from './agent';

export type ExamActionData=Extract<AgentEvent,{type:'EXAM_ACTION'}>['data'];
export interface RecordedExamAction {
  toolId:string;bodyPartId:string;position:ExamPosition;location?:ExamLocation;prepared:boolean;phase:SessionState['stage'];
  failure?:'pairing'|'location'|'position'|'preparation'|'unavailable'|'stage';
}
export function normalizedExamAction(session:SessionState,data:ExamActionData):RecordedExamAction{
  return {toolId:data.toolId,bodyPartId:data.bodyPartId,position:data.position??data.posture??session.examPosition??session.examPosture??'standing',...(data.location?{location:data.location}:{}),prepared:session.unlockedEvidence.includes('EX_PREP'),phase:session.stage};
}
/** Old coarse event text cannot stand in for a newly positioned operation. */
export function isRepeatedExamAction(session:SessionState,data:ExamActionData):boolean{
  if(data.toolId==='hand-hygiene'&&session.unlockedEvidence.includes('EX_PREP'))return true;
  const current=normalizedExamAction(session,data);
  return session.events.some(event=>{
    const prior=event.examAction;if(event.type!=='EXAM_ACTION'||!prior)return false;
    if(prior.toolId!==current.toolId||prior.bodyPartId!==current.bodyPartId||prior.position!==current.position||prior.location?.side!==current.location?.side||prior.location?.aspect!==current.location?.aspect)return false;
    if(event.correct===true)return true;
    return prior.failure!==undefined&&['pairing','location','position','preparation'].includes(prior.failure)&&prior.prepared===current.prepared&&prior.phase===session.stage;
  });
}
