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
import {buildReport} from '../../src/lib/scoring';
import {getCaseRecordEntries} from '../../src/domain/case-record';
import type {TeachingRubricItem} from '../../src/domain/teaching-package';
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
  const answers=(section:TeachingRubricItem['section'])=>pack.rubric.filter(item=>item.section===section).map(item=>item.fullAnswer).filter(Boolean).join('；');
  const testReason='用于诊断、鉴别与治疗前评估；结果需结合病史和查体，正常或异常结果均有局限，不能单独排除疾病。';
  for(const test of pack.tests){
    await runAgentTurn(state,{type:'ORDER_TEST',data:{testId:test.id,reason:testReason}},`score-test-${test.id}`);
  }
  for(const [questionIndex,question] of pack.questions.entries()){
    const content=JSON.stringify({topic:question.topic,clarification:null,utterances:[{actor:'parent',text:question.parentAnswer,factIds:question.factIds}]});
    await runAgentTurn(state,{type:'ASK_QUESTION',data:{text:question.prompt}},`score-history-${questionIndex}`,{historyInvoke:async()=>({content})});
  }
  const records=getCaseRecordEntries(state).map(record=>({text:record.category==='history'?record.answers.join('；'):record.event.summary})).filter(record=>record.text.trim().length>0);
  await runAgentTurn(state,{type:'SUBMIT_HISTORY_SUMMARY',data:{summary:answers('history')}},'score-history-submit');
  await runAgentTurn(state,{type:'SUBMIT_DECISION',data:{
    diagnosis:pack.rubric.find(item=>item.id==='diagnosis-primary')?.fullAnswer??pack.title,
    summary:answers('diagnosis'),
    diagnosisBasis:[answers('diagnosis'),...records.map(record=>record.text)].filter(Boolean).join('；'),
    differentials:pack.rubric.find(item=>item.id==='diagnosis-differential')?.fullAnswer??'',
  }},'score-decision-submit');
  await runAgentTurn(state,{type:'SUBMIT_PLAN',data:{priority:answers('plan'),detail:answers('plan')}},'score-plan-submit');
  const communication=[answers('communication'),'目前考虑患儿的情况需要继续评估，接下来会说明治疗和复查安排；如果病情加重或出现危险变化，应立即就医。'].filter(Boolean).join('；');
  await runAgentTurn(state,{type:'SEND_COMMUNICATION',data:{text:communication}},'score-communication-submit');
  const report=buildReport(state,`score-${pack.version}`,{noteText:answers('note')});
  const feedback=report.teachingFeedback;
  assert.ok(feedback,`TEACHING_FEEDBACK_MISSING:${pack.caseId}`);
  const gaps=feedback.items.filter(item=>item.status!=='achieved'&&item.status!=='not_assessable');
  assert.equal(gaps.length,0,`ATTAINABLE_SCORE_GAP:${pack.caseId}:${gaps.map(item=>{
    const definition=pack.rubric.find(point=>point.id===item.id);
    const codes=definition?.evidenceCodes??[];
    const relatedQuestions=pack.questions.filter(question=>question.factIds.some(id=>codes.includes(id))).length;
    const unlocked=codes.filter(code=>state.unlockedEvidence.includes(code)).length;
    return `${item.id}:${item.status}:${item.score}/${item.maxScore}:codes=${codes.length}:questions=${relatedQuestions}:unlocked=${unlocked}`;
  }).join(',')}`);
  assert.equal(feedback.totalScore,feedback.assessableMaxScore,`ATTAINABLE_SCORE_MISMATCH:${pack.caseId}`);
  results.push({
    caseId:pack.caseId,
    version:pack.version,
    operations:pack.exams.length,
    attainableScore:feedback.totalScore,
    assessableMaxScore:feedback.assessableMaxScore,
    notAssessable:feedback.items.filter(item=>item.status==='not_assessable').map(item=>({id:item.id,maxScore:item.maxScore})),
    passed:true,
  });
}
for(const [i,saved] of historical.entries()){
  const restored=JSON.parse(JSON.stringify(saved)) as SessionState;
  const after=JSON.stringify({source:restored.sourceSnapshotVersion,version:restored.teachingPackageVersion,exams:readTeachingPackage(restored.caseId,restored.teachingPackageVersion,restored.sourceSnapshotVersion)?.exams});
  assert.ok(before[i]===after,'OLD_SESSION_CHANGED');
}
mkdirSync(path.dirname(output),{recursive:true});
const summary={
  cases:results.length,
  operations,
  duplicates,
  wrongPairs:results.length,
  oldSessions:historical.length,
  oldSessionVersionStable:true,
  attainableScoreCases:results.length,
  fullAttainable:results.filter(result=>result.attainableScore===result.assessableMaxScore).length,
  minAttainableScore:Math.min(...results.map(result=>result.attainableScore)),
  maxAttainableScore:Math.max(...results.map(result=>result.attainableScore)),
  minAssessableMaxScore:Math.min(...results.map(result=>result.assessableMaxScore)),
  maxAssessableMaxScore:Math.max(...results.map(result=>result.assessableMaxScore)),
  notAssessableItems:results.reduce((total,result)=>total+result.notAssessable.length,0),
  syntheticIdentity:true,
  formalGradeWritten:false,
  privateContentIncluded:false,
  databaseWrites:false,
  realLogin:false,
  modelCalls:0,
  medicalReview:false,
};
writeFileSync(output,JSON.stringify({...summary,results},null,2),{mode:0o600});
console.log(JSON.stringify(summary));
}
void main();
