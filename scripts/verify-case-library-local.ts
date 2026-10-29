/** Local engine evidence only: controlled inputs, no HTTP/OAuth/DB or medical acceptance. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { getCase } from '@/domain/case';
import { readTeacherCaseData, getTeacherSourceId } from '@/lib/teacher-case-data';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { buildReport } from '@/lib/scoring';
import { patientAppearance } from '@/domain/patient-appearance';
import { resolveCommunicationProfile, canChildSpeak } from '@/domain/communication-profile';

async function main() {
  assert.equal(process.env.ENABLE_AI_FIXTURE,'true','Local runner requires explicit fixture mode');
  const [ledgerPath,outputPath]=process.argv.slice(2);
  assert.ok(ledgerPath && outputPath,'Provide controlled ledger and private output directory');
  const ledger=JSON.parse(readFileSync(ledgerPath,'utf8')) as {cases:Array<{seq:number;caseId:string;activeForCurrentScope?:boolean}>};
  assert.ok(ledger.cases.length>0);
  const rows=[];
  for(const item of ledger.cases.filter(entry=>entry.activeForCurrentScope!==false)) {
    const checks:Record<string,boolean>={}; const issues:string[]=[];
    const source=readTeacherCaseData(item.caseId);
    const row={seq:item.seq,caseId:item.caseId,sourceCaseId:getTeacherSourceId(item.caseId),
      sourceAvailable:Boolean(source),checks,issues,engineVerified:false,
      realHttpVerified:false,realOAuthVerified:false,imagesVisuallyVerified:false,medicalVerified:false,
      fullFlowAccepted:false,firstUnfinishedBreakpoint:'source_material'};
    try {
      const initial=createInitialSession('isolated-local-engine','guided',item.caseId);
      checks.entryIdentity=initial.caseId===item.caseId;
      checks.sourceAvailability=Boolean(initial.caseOptions?.hasSource)===Boolean(source);
      if(!source) {issues.push('SOURCE_MATERIAL_UNAVAILABLE');rows.push(row);continue;}
      const version=computeCaseDataVersion(source);
      // Mirrors repository binding for this in-memory engine test; not persistence proof.
      const session=createInitialSession('isolated-local-engine','guided',item.caseId,undefined,version);
      session.sourceSnapshotVersion=version;
      checks.ageAndSexProjection=session.caseOptions?.age===source.age && session.caseOptions?.sex===source.sex;
      checks.boundSource=getCase(item.caseId,version,session.id).sourceFacts?.sourceName===source.sourceName;
      const appearance=patientAppearance(source.sex,'standing',item.caseId,source.age);
      checks.appearanceAsset=appearance.src===null || existsSync(path.join('public',appearance.src));
      const before=session.events.length;
      const reply=await runAgentTurn(session,{type:'ASK_QUESTION',data:{text:'孩子这次主要有什么不舒服？从什么时候开始？'}},'local-history');
      checks.historyEvent=session.events.length>before && session.events.some(e=>e.type==='ASK_QUESTION');
      const profile=resolveCommunicationProfile(item.caseId,source.age);
      checks.nonverbalRole=canChildSpeak(profile) || !reply.newMessages.some(m=>m.actor==='child'&&m.kind==='dialogue');
      await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands'}},'local-hygiene');
      const clinical=getCase(item.caseId,version,session.id);
      const exam=clinical.exams.find(e=>e.id!=='prep-hygiene');
      if(exam) {
        await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:exam.toolId,bodyPartId:exam.bodyPartId,posture:'supine'}},'local-exam');
        checks.examEvidence=session.unlockedEvidence.includes(exam.evidenceCode);
      } else checks.examEvidence=false;
      const test=clinical.tests[0];
      if(test) {
        const result=await runAgentTurn(session,{type:'ORDER_TEST',data:{testId:test.id}},'local-test');
        checks.testOrder=session.orderedTests.includes(test.id);
        checks.testEvidence=session.unlockedEvidence.includes(test.evidenceCode);
        checks.testResultFromBoundSource=Boolean(test.result)&&result.newMessages.some(m=>m.content===test.result);
        const count=session.events.length;
        await runAgentTurn(session,{type:'ORDER_TEST',data:{testId:test.id}},'local-test');
        checks.duplicateEventIdempotent=session.events.length===count;
      } else {checks.testOrder=false;issues.push('NO_TEST_RESULT_AVAILABLE');}
      await runAgentTurn(session,{type:'SUBMIT_DECISION',data:{diagnosis:'工程流程占位，不作医学判断',summary:'本地工程流程验证',diagnosisBasis:'基于已记录证据验证提交保存流程，不作医学判断',differentials:'尚待临床判断'}},'local-decision');
      checks.decisionSaved=session.decision?.diagnosis==='工程流程占位，不作医学判断';
      await runAgentTurn(session,{type:'SUBMIT_PLAN',data:{priority:'本地工程验证',detail:'验证处置提交保存，不作为治疗建议'}},'local-plan');
      checks.planSaved=session.plan?.priority==='本地工程验证';
      await runAgentTurn(session,{type:'SEND_COMMUNICATION',data:{text:'我们会结合已取得的信息继续评估，并向您说明下一步安排。'}},'local-communication');
      checks.communicationSaved=Boolean(session.communication);
      const reloaded=JSON.parse(JSON.stringify(session)) as typeof session;
      checks.serializationIdentity=reloaded.caseId===item.caseId && reloaded.sourceSnapshotVersion===version;
      await runAgentTurn(reloaded,{type:'FINISH_SESSION',data:{}},'local-finish');
      checks.completed=reloaded.status==='completed';
      const report=buildReport(reloaded,'local-report');
      checks.reportIdentity=report.caseId===item.caseId&&report.sessionId===session.id;
      checks.scoreTotal=report.totalScore===Object.values(report.abilities).reduce((a,b)=>a+b,0);
      checks.reportEvidence=report.evidence.length>0;
      checks.reportRoundtrip=JSON.parse(JSON.stringify(report)).totalScore===report.totalScore;
      for(const [key,value] of Object.entries(checks))if(!value)issues.push(key.toUpperCase());
      row.engineVerified=issues.length===0;
      row.firstUnfinishedBreakpoint=issues.length?'local_engine_findings':'private_images_and_real_http_identity';
    } catch(error) {
      const code=error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'ENGINE_EXCEPTION_REQUIRES_PRIVATE_DEBUG';
      issues.push(code);row.firstUnfinishedBreakpoint='local_engine_exception';
    }
    rows.push(row);
  }
  mkdirSync(outputPath,{recursive:true});
  for(const row of rows) {
    const dir=path.join(outputPath,`seq${String(row.seq).padStart(3,'0')}`);mkdirSync(dir,{recursive:true});
    writeFileSync(path.join(dir,'local-engine-review.json'),JSON.stringify(row,null,2)+'\n');
  }
  const summary={evidenceLayer:'local business engine with AI fixture, not actual HTTP/OAuth or clinical acceptance',
    total:rows.length,withSource:rows.filter(x=>x.sourceAvailable).length,engineVerified:rows.filter(x=>x.engineVerified).length,
    missingSource:rows.filter(x=>!x.sourceAvailable).map(x=>x.seq),
    findings:rows.filter(x=>x.sourceAvailable&&!x.engineVerified).map(x=>({seq:x.seq,issues:x.issues})),
    realFullFlowAccepted:0,medicalAccepted:0};
  writeFileSync(path.join(outputPath,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary));
  if(summary.findings.length)process.exitCode=1;
}
main().catch(()=>{console.error('LOCAL_REVIEW_SETUP_FAILED');process.exitCode=1;});
