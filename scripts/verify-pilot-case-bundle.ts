import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function main() {
  const root=path.resolve(process.argv[2] ?? '');
  if(!root.startsWith(path.resolve('output')+path.sep))throw new Error('PRIVATE_BUNDLE_REQUIRED');
  const manifest=JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));
  for(const file of manifest.files as Array<{path:string;sha256:string}>){
    const full=path.resolve(root,file.path);assert.ok(full.startsWith(root+path.sep));
    assert.equal(createHash('sha256').update(readFileSync(full)).digest('hex'),file.sha256);
  }
  process.env.PEDIATRICS_KNOWLEDGE_ROOT=path.join(root,'knowledge');
  process.env.ENABLE_AI_FIXTURE='true';
  const {createInitialSession,runAgentTurn}=await import('../src/lib/agent-engine');
  const {getCase}=await import('../src/domain/case');
  const {buildReport}=await import('../src/lib/scoring');
  const {findReleasedMedia}=await import('../src/lib/case-media');
  const definition=JSON.parse(readFileSync(path.join(root,'pilot-definition.json'),'utf8'));
  const entryArg=process.argv.indexOf('--entry');
  const entryId=entryArg>=0?process.argv[entryArg+1]:definition.entryId;
  const {resolveCaseId,publicCaseId}=await import('../src/lib/case-identity');
  const {getTeacherSourceId}=await import('../src/lib/teacher-case-data');
  assert.equal(getTeacherSourceId(resolveCaseId(entryId)),definition.sourceId,'入口必须绑定本包来源');
  const session=createInitialSession('offline-pilot-verification','guided',resolveCaseId(entryId),undefined,manifest.contentVersion);
  const c=getCase(resolveCaseId(entryId),manifest.contentVersion,session.id);
  assert.ok(c.sourceFacts);assert.ok(session.caseOptions?.tests.length);
  assert.equal(session.sourceSnapshotVersion,manifest.contentVersion);
  for(const id of manifest.externalFileIds)assert.equal(findReleasedMedia(session,id),null);
  const ask=await runAgentTurn(session,{type:'ASK_QUESTION',data:{text:'孩子主要哪里不舒服，什么时候开始的？'}},'pilot-ask');assert.ok(ask.newMessages.length);
  await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands'}},'pilot-prep');
  let exams=0;
  for(const exam of c.exams.filter(e=>e.evidenceCode!=='EX_PREP')){
    await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:exam.toolId,bodyPartId:exam.bodyPartId,posture:exam.postures?.[0]??(exam.bodyPartId==='abdomen'?'supine':'standing')}},`pilot-exam-${exams++}`);
    assert.ok(session.unlockedEvidence.includes(exam.evidenceCode));
  }
  let tests=0;
  for(const check of c.tests){
    await runAgentTurn(session,{type:'ORDER_TEST',data:{testId:check.id}},`pilot-test-${tests++}`);
    assert.ok(session.orderedTests.includes(check.id));
  }
  // Require the chosen pilot's existing media to be released by real engine actions.
  for(const id of manifest.externalFileIds)assert.ok(findReleasedMedia(session,id));
  await runAgentTurn(session,{type:'SUBMIT_DECISION',data:{diagnosis:'离线测试提交',summary:'离线核对提交保留',diagnosisBasis:'仅用于离线核对已取得证据和提交保存链路',differentials:'待教师核对'}},'pilot-decision');
  await runAgentTurn(session,{type:'SUBMIT_PLAN',data:{priority:'评估与监测',detail:'离线核对处置提交保留'}},'pilot-plan');
  await runAgentTurn(session,{type:'SEND_COMMUNICATION',data:{text:'这是离线流程测试，具体处置由教师核对。'}},'pilot-communication');
  await runAgentTurn(session,{type:'FINISH_SESSION',data:{}},'pilot-finish');
  assert.equal(session.status,'completed');
  const report=buildReport(session);assert.equal(report.studentDecision?.diagnosis,'离线测试提交');
  const restored=JSON.parse(JSON.stringify(session));
  assert.equal(restored.sourceSnapshotVersion,manifest.contentVersion);
  for(const id of manifest.externalFileIds)assert.ok(findReleasedMedia(restored,id));
  const verificationRoot=path.join(root,`verify-${publicCaseId(resolveCaseId(entryId))}-${Date.now()}`);
  mkdirSync(verificationRoot,{recursive:false});
  writeFileSync(path.join(verificationRoot,'offline-session.private.json'),JSON.stringify(session),{mode:0o600});
  writeFileSync(path.join(verificationRoot,'offline-report.private.json'),JSON.stringify(report),{mode:0o600});
  const receipt={entryId,sourceId:definition.sourceId,contentVersion:manifest.contentVersion,exams,tests,releasedMedia:manifest.externalFileIds.length,engineFlowPassed:true,jsonRoundTripPassed:true,realBrowserPassed:false,databasePersistencePassed:false,coldStartDatabasePassed:false,voiceDevicePassed:false};
  writeFileSync(path.join(verificationRoot,'offline-verification.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}
void main().catch((error:unknown)=>{console.error('PILOT_VERIFICATION_FAILED',error instanceof Error ? error.stack?.split('\n').filter(line=>line.includes('verify-pilot-case-bundle.ts')).map(line=>line.match(/:(\d+):(\d+)/)?.[0]).join(',') : 'unknown');process.exitCode=1;});

