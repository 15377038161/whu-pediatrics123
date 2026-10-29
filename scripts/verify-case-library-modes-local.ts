/** Local multi-mode engine/serialization checks; never real OAuth, device or medical acceptance. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import type {AgentEvent,SessionState,PracticeFocus} from '@/domain/agent';
import {createInitialSession,runAgentTurn} from '@/lib/agent-engine';
import {getCase} from '@/domain/case';
import {readTeacherCaseData} from '@/lib/teacher-case-data';
import {computeCaseDataVersion} from '@/lib/case-data-version';
import {buildReport} from '@/lib/scoring';
import {resolveCommunicationProfile,canChildSpeak} from '@/domain/communication-profile';

const scopes={history:['history'],exam:['examination','professionalism'],safety:['reasoning','safety'],communication:['communication']};
const modes=['immersive','osce','history','exam','safety','communication'] as const;
type Saved={session:SessionState;score:number;dimensions:unknown;max:number|undefined;unscored:boolean|undefined};
async function main(){
 assert.equal(process.env.ENABLE_AI_FIXTURE,'true');
 if(process.argv[2]==='--restore'){
  const saved=JSON.parse(readFileSync(process.argv[3],'utf8')) as Saved[];
  for(const item of saved){
   const source=getCase(item.session.caseId,item.session.sourceSnapshotVersion,item.session.id).sourceFacts;
   assert.ok(source);
   const report=buildReport(item.session,'restored-report');
   assert.equal(report.totalScore,item.score);assert.deepEqual(report.evaluatedAbilities,item.dimensions);
   assert.equal(report.assessableMaxScore,item.max);assert.equal(report.unscored,item.unscored);
   assert.equal(report.caseId,item.session.caseId);
  }
  console.log(JSON.stringify({separateProcessLocalRestorePassed:saved.length,productionDatabaseRestoreVerified:false}));return;
 }
 const [ledgerFile,outputDir,privateBundle]=process.argv.slice(2);assert.ok(ledgerFile&&outputDir&&privateBundle);
 const entries=(JSON.parse(readFileSync(ledgerFile,'utf8')) as {cases:Array<{seq:number;caseId:string;activeForCurrentScope?:boolean}>}).cases.filter(entry=>entry.activeForCurrentScope!==false);
 const rows=[];const saved:Saved[]=[];
 for(const entry of entries){
  const source=readTeacherCaseData(entry.caseId);
  if(!source){rows.push({seq:entry.seq,caseId:entry.caseId,mode:'all',passed:false,issue:'SOURCE_MATERIAL_UNAVAILABLE'});continue;}
  for(const selected of modes){
   const mode=selected==='immersive'||selected==='osce'?selected:'practice';
   const focus=mode==='practice'?selected as PracticeFocus:undefined;
   const version=computeCaseDataVersion(source);
   const session=createInitialSession('isolated-local-mode-engine',mode,entry.caseId,focus,version);
   session.sourceSnapshotVersion=version;let eventIndex=0;
   const row={seq:entry.seq,caseId:entry.caseId,mode:selected,passed:false,issue:'',realHttpOrOAuthVerified:false};
   try{
    const turn=async(event:AgentEvent)=>{
     const result=await runAgentTurn(session,event,`local-mode-${eventIndex++}`);
     if(!canChildSpeak(resolveCommunicationProfile(entry.caseId,source.age)))assert.ok(!result.newMessages.some(m=>m.actor==='child'&&m.kind==='dialogue'));
     return result;
    };
    const navigate=async(stage:SessionState['stage'])=>{if(mode==='osce')await turn({type:'NAVIGATE_STAGE',data:{stage}});};
    if(!focus||focus==='history'){
     await navigate('history');await turn({type:'ASK_QUESTION',data:{text:'孩子多大，是男孩还是女孩？'}});
     assert.ok(session.askedIntents.some(x=>x.startsWith('SOURCE_HX_')));
     if(focus==='history')await turn({type:'SUBMIT_HISTORY_SUMMARY',data:{summary:'本地工程摘要：已记录主诉与病程，具体临床结论待评估。'}});
    }
    if(!focus||focus==='exam'){
     await navigate('exam');await turn({type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands'}});
     const exam=getCase(entry.caseId,version,session.id).exams.find(x=>x.id!=='prep-hygiene');assert.ok(exam);
     for(const action of getCase(entry.caseId,version,session.id).exams.filter(x=>x.id!=='prep-hygiene')) {
      await turn({type:'EXAM_ACTION',data:{toolId:action.toolId,bodyPartId:action.bodyPartId,posture:'supine'}});
      assert.ok(session.unlockedEvidence.includes(action.evidenceCode));
     }
     if(focus==='exam'){
      await turn({type:'SUBMIT_EXAM_OBSERVATION',data:{findings:'本地工程观察提交，仅验证所见与已获得证据的关联保存。',linkedEvidence:[exam.evidenceCode]}});
      assert.ok(session.examObservation?.linkedEventIds.length);
     }
    }
    if(!focus){
     await navigate('tests');const test=getCase(entry.caseId,version,session.id).tests[0];assert.ok(test);
     for(const check of getCase(entry.caseId,version,session.id).tests){
      await turn({type:'ORDER_TEST',data:{testId:check.id}});assert.ok(session.orderedTests.includes(check.id));
     }
    }
    if(!focus||focus==='safety'){
     await navigate('assessment');await turn({type:'SUBMIT_DECISION',data:{diagnosis:'工程提交，不作医学判断',summary:'验证诊断保存流程',diagnosisBasis:'依据已获得的合成工程操作记录验证字段保存，不作医学判断',differentials:'待教师复核'}});
     await navigate('plan');await turn({type:'SUBMIT_PLAN',data:{priority:'工程流程验证',detail:'只验证处置字段保存，不是患者治疗建议'}});
    }
    if(!focus||focus==='communication'){
     await navigate('communication');await turn({type:'SEND_COMMUNICATION',data:{text:'我理解您的担心，我们会结合已取得的信息继续评估，并说明下一步安排。'}});
    }
    if(focus){
     const forbidden:AgentEvent=focus==='exam'?{type:'ASK_QUESTION',data:{text:'越界工程探测'}}:{type:'ORDER_TEST',data:{testId:'source-test-0'}};
     const count=session.events.length;
     await assert.rejects(()=>turn(forbidden),/PRACTICE_EVENT_FORBIDDEN/);assert.equal(session.events.length,count);
    }
    await turn({type:'FINISH_SESSION',data:{}});assert.equal(session.status,'completed');
    const report=buildReport(session,'mode-report');assert.equal(report.caseId,entry.caseId);
    assert.equal(report.totalScore,Object.values(report.abilities).reduce((a,b)=>a+b,0));
    if(focus){assert.deepEqual(report.evaluatedAbilities,scopes[focus]);if(focus==='communication')assert.equal(report.unscored,true);}
    const copy=JSON.parse(JSON.stringify(session)) as SessionState;
    assert.equal(copy.sourceSnapshotVersion,version);assert.equal(copy.caseId,entry.caseId);
    saved.push({session:copy,score:report.totalScore,dimensions:report.evaluatedAbilities,max:report.assessableMaxScore,unscored:report.unscored});
    row.passed=true;
   }catch(error){row.issue=error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'MODE_CONTRACT_ASSERTION_FAILED';}
   rows.push(row);
  }
 }
 mkdirSync(outputDir,{recursive:true});mkdirSync(path.dirname(privateBundle),{recursive:true});
 writeFileSync(privateBundle,JSON.stringify(saved)); // Private ignored local state, never a log or a Git artifact.
 for(const entry of entries){const dir=path.join(outputDir,`seq${String(entry.seq).padStart(3,'0')}`);mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'modes.json'),JSON.stringify(rows.filter(r=>r.seq===entry.seq),null,2));}
 const summary={evidenceLayer:'local engine only; no HTTP/OAuth/physical device/medical acceptance',entries:entries.length,
  attempted:rows.filter(r=>r.mode!=='all').length,passed:rows.filter(r=>r.passed).length,
  missingSource:rows.filter(r=>r.mode==='all').map(r=>r.seq),failures:rows.filter(r=>!r.passed&&r.mode!=='all').map(r=>({seq:r.seq,mode:r.mode,issue:r.issue})),
  productionRestoreVerified:false};
 writeFileSync(path.join(outputDir,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 if(summary.failures.length)process.exitCode=1;
}
main().catch(()=>{console.error('LOCAL_MODE_REVIEW_SETUP_FAILED');process.exitCode=1;});
