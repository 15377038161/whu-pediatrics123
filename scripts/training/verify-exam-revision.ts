/** All-case exam release, mismatch, repeat and immutable old-session checks; no model/auth/database writes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {decodeControlledTrainingContent,installRecoveredTrainingContent} from '../../src/lib/controlled-case-bundle';
import {controlledTrainingContentBundles,type ControlledTrainingContentReference} from '../../src/lib/controlled-case-registry';
import {createInitialSession,runAgentTurn} from '../../src/lib/agent-engine';
import {readTeachingPackage} from '../../src/lib/teaching-package-store';
import {ANATOMY_REGIONS} from '../../src/domain/exam-anatomy';
import type {SessionState,AgentEvent} from '../../src/domain/agent';
import {projectSessionForRole} from '../../src/lib/session-projection';
process.env.ENABLE_AI_FIXTURE='true';
const [oldDirectory,newDirectory,output]=process.argv.slice(2);
if(!oldDirectory||!newDirectory||!output)throw Error('Usage: verify-exam-revision <old-archives> <new-archives> <private-output-json>');
const load=(directory:string)=>{
  const manifest=JSON.parse(readFileSync(path.join(directory,'peds-training-upload-manifest.json'),'utf8'));
  const ref=(file:string)=>({...manifest.archives.find((a:{file:string})=>a.file===file),fileId:`local-exam-test:${file}`,archive:file});
  const reference:ControlledTrainingContentReference={...ref(manifest.contentArchive),media:manifest.archives.filter((a:{file:string})=>a.file!==manifest.contentArchive).map((a:{file:string})=>ref(a.file)),expected:{entries:67,sources:53,media:1042}};
  const content=decodeControlledTrainingContent(readFileSync(path.join(directory,manifest.contentArchive)),reference);
  installRecoveredTrainingContent(content,reference);return content;
};
async function main(){
const old=load(oldDirectory);
const historical=old.packages.map(pack=>createInitialSession('exam-revision-history','guided',pack.caseId,undefined,pack.sourceVersion));
const before=historical.map(state=>JSON.stringify({source:state.sourceSnapshotVersion,version:state.teachingPackageVersion,exams:readTeachingPackage(state.caseId,state.teachingPackageVersion,state.sourceSnapshotVersion)?.exams}));
const current=load(newDirectory),results=[];
let operations=0,duplicates=0;
for(const pack of current.packages){
  const state=createInitialSession('exam-revision-test','guided',pack.caseId,undefined,pack.sourceVersion);
  assert.equal(state.teachingPackageVersion,pack.version);
  assert.equal(projectSessionForRole(state,'student').caseOptions?.exams.length,0);
  await runAgentTurn(state,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands'}},'prepare');
  const evidence=[...state.unlockedEvidence];
  await runAgentTurn(state,{type:'EXAM_ACTION',data:{toolId:'tympanic-thermometer',bodyPartId:'eyes'}},'wrong-pair');
  assert.ok(JSON.stringify(evidence)===JSON.stringify(state.unlockedEvidence),'WRONG_PAIR_RELEASED_EVIDENCE');
  assert.equal(state.events.at(-1)?.examAction?.failure,'pairing');
  for(const exam of pack.exams){
    const position=exam.allowedPositions?.[0]??exam.postures[0];
    const site=ANATOMY_REGIONS.flatMap(r=>r.sites).find(s=>s.id===exam.bodyPartId)!;
    const side=exam.bodyPartId.startsWith('left-')?'left':exam.bodyPartId.startsWith('right-')?'right':'midline';
    const action:Extract<AgentEvent,{type:'EXAM_ACTION'}>={type:'EXAM_ACTION',data:{toolId:exam.toolId,bodyPartId:exam.bodyPartId,position,posture:exam.postures[0],location:{side,aspect:site.aspect??exam.aspect??'front'}}};
    await runAgentTurn(state,action,`correct-${exam.id}`);
    assert.ok(state.events.at(-1)?.correct===true,`OPERATION_NOT_ACCEPTED:${pack.caseId}:${exam.id}`);
    assert.ok(state.events.at(-1)?.summary.includes(exam.result),`BOUND_RESULT_MISSING:${pack.caseId}:${exam.id}`);
    operations++;
    const restored=JSON.parse(JSON.stringify(state)) as SessionState;
    const count=restored.events.length,codes=[...restored.unlockedEvidence];
    const duplicate=await runAgentTurn(restored,action,`repeat-${exam.id}`);
    assert.ok(duplicate.repeated===true&&duplicate.feedback===null&&duplicate.newMessages.length===0,'REPEAT_NOT_SILENT');
    assert.ok(restored.events.length===count&&JSON.stringify(codes)===JSON.stringify(restored.unlockedEvidence),'REPEAT_ADDED_EVIDENCE');
    duplicates++;
  }
  results.push({caseId:pack.caseId,version:pack.version,operations:pack.exams.length,passed:true});
}
for(const [i,saved] of historical.entries()){
  const restored=JSON.parse(JSON.stringify(saved)) as SessionState;
  const after=JSON.stringify({source:restored.sourceSnapshotVersion,version:restored.teachingPackageVersion,exams:readTeachingPackage(restored.caseId,restored.teachingPackageVersion,restored.sourceSnapshotVersion)?.exams});
  assert.ok(before[i]===after,'OLD_SESSION_CHANGED');
}
mkdirSync(path.dirname(output),{recursive:true});
const summary={cases:results.length,operations,duplicates,wrongPairs:results.length,oldSessions:historical.length,oldSessionVersionStable:true,databaseWrites:false,realLogin:false,modelCalls:0,medicalReview:false};
writeFileSync(output,JSON.stringify({...summary,results},null,2),{mode:0o600});
console.log(JSON.stringify(summary));
}
void main();
