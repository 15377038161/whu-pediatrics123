import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createInitialSession,runAgentTurn} from '../../src/lib/agent-engine';
import {sessionTeachingCase} from '../../src/lib/session-teaching';
import {ageMonths,instrumentApplicability} from '../../src/domain/exam-authoring-standard';
import {teachingExamReleaseBlock} from '../../src/domain/exam-release-gate';
import {releaseStructuredMeasurements,structuredMeasurementKey} from '../../src/domain/structured-measurement';
import type {AgentEvent,SessionState} from '../../src/domain/agent';
import type {TeachingExam} from '../../src/domain/teaching-package';
import {installLocalStageOne} from './install-local-stage-one';

process.env.ENABLE_AI_FIXTURE='true';
const contentArchive=process.env.PEDIATRICS_STAGE_ONE_CONTENT;
const runtimeRoot=process.env.PEDIATRICS_STAGE_ONE_RUNTIME;
const outputRoot=process.env.PEDIATRICS_STAGE_ONE_OUTPUT??'/tmp/peds67-stage-one-acceptance';
if(!contentArchive||!runtimeRoot)throw new Error('PEDIATRICS_STAGE_ONE_CONTENT_AND_RUNTIME_REQUIRED');
const runtime=installLocalStageOne(contentArchive,runtimeRoot);
const runtimeGeneration=path.basename(path.dirname(runtimeRoot));
const caseOffset=Math.max(0,Number.parseInt(process.env.PEDIATRICS_STAGE_ONE_CASE_OFFSET??'0',10)||0);
const caseLimit=Math.max(1,Number.parseInt(process.env.PEDIATRICS_STAGE_ONE_CASE_LIMIT??'67',10)||67);
const selectedPackages=runtime.packages.slice(caseOffset,caseOffset+caseLimit);
if(selectedPackages.length===0)throw new Error('STAGE_ONE_CASE_RANGE_EMPTY');
type ExamData=Extract<AgentEvent,{type:'EXAM_ACTION'}>['data'];
function action(exam:TeachingExam):ExamData{
  const position=exam.allowedPositions?.[0]??exam.postures[0]??'standing';
  return {toolId:exam.toolId,bodyPartId:exam.bodyPartId,posture:position==='standing'?'standing':'supine',position,
    location:{side:exam.bodyPartId.startsWith('left-')?'left':exam.bodyPartId.startsWith('right-')?'right':'both',aspect:exam.aspect??'front'}};
}
async function turn(session:SessionState,data:ExamData,id:string){return runAgentTurn(session,{type:'EXAM_ACTION',data},id);}
const summary={cases:0,sourceCases:runtime.sources,examRows:0,released:0,authorBlocked:0,instrumentBlocked:0,measurementBlocked:0,
  structuredMeasurements:0,wrongPairings:0,earlyStageBlocked:0,fixedTestsReused:0,jsonRestored:0,repeatedSuppressed:0,caseDetails:[] as Array<Record<string,unknown>>};

async function main():Promise<void>{
for(const pack of selectedPackages){
  const session=createInitialSession(`matrix-${pack.version}`,'guided',pack.caseId,undefined,pack.sourceVersion);
  assert.equal(session.teachingPackageVersion,pack.version,`PACKAGE_BINDING:${pack.caseId}`);
  const allowed=pack.exams.find(exam=>!teachingExamReleaseBlock(exam,'exam')&&instrumentApplicability(exam.toolId,exam.bodyPartId,ageMonths(pack.age)).status!=='not_applicable');
  assert.ok(allowed,`NO_RELEASED_EXAM:${pack.caseId}`);
  const early=await turn(session,action(allowed),`${pack.version}-early`);
  assert.equal(early.session.events.at(-1)?.correct,false,`EARLY_EXAM_RELEASED:${pack.caseId}`);
  assert.equal(session.unlockedEvidence.includes(allowed.evidenceCode),false);summary.earlyStageBlocked++;
  await turn(session,{toolId:'hand-hygiene',bodyPartId:'hands',position:'standing'},`${pack.version}-prep`);
  assert.ok(session.unlockedEvidence.includes('EX_PREP'));
  const beforeWrong=session.unlockedEvidence.length;
  const wrong=await turn(session,{toolId:'axillary-thermometer',bodyPartId:'forehead',position:'standing'},`${pack.version}-wrong`);
  assert.equal(wrong.session.events.at(-1)?.correct,false,`WRONG_PAIRING_ACCEPTED:${pack.caseId}`);
  assert.equal(session.unlockedEvidence.length,beforeWrong);assert.equal(wrong.newMessages.length,0);summary.wrongPairings++;

  let released=0,blocked=0,measurements=0;let successful:{exam:TeachingExam;data:ExamData}|null=null;
  const seen=new Set<string>();
  for(const exam of pack.exams){
    const key=`${exam.toolId}:${exam.bodyPartId}`;assert.equal(seen.has(key),false,`DUPLICATE_EXAM_COMBINATION:${pack.caseId}:${key}`);seen.add(key);
    const data=action(exam);const evidenceBefore=session.unlockedEvidence.length;const measurementBefore=Object.keys(session.structuredMeasurements??{}).length;
    const expectedAuthorBlock=teachingExamReleaseBlock(exam,session.stage);
    const expectedInstrumentBlock=instrumentApplicability(exam.toolId,exam.bodyPartId,ageMonths(pack.age)).status==='not_applicable';
    const expectedMeasurements=releaseStructuredMeasurements(pack.measurementContracts,exam.toolId,exam.bodyPartId,session.stage,new Date().toISOString());
    const result=await turn(session,data,`${pack.version}-exam-${summary.examRows}`);summary.examRows++;
    const event=session.events.at(-1);assert.equal(event?.type,'EXAM_ACTION');
    const shouldRelease=!expectedAuthorBlock&&!expectedInstrumentBlock&&!(expectedMeasurements.withheld.length>0&&expectedMeasurements.measurements.length===0);
    assert.equal(event?.correct,shouldRelease,`EXAM_RELEASE_MISMATCH:${pack.caseId}:${key}:${expectedAuthorBlock?.reason??''}`);
    if(shouldRelease){
      const fixed=sessionTeachingCase(session).exams.find(item=>item.toolId===exam.toolId&&item.bodyPartId===exam.bodyPartId);
      assert.ok(fixed?.result.includes(exam.localSupplement?.result??exam.result),`FIXED_FINDING_MISSING:${pack.caseId}:${key}`);
      assert.ok(result.newMessages.some(message=>message.content.includes(exam.localSupplement?.result??exam.result)),`DETAILED_RESULT_NOT_RETURNED:${pack.caseId}:${key}`);
      assert.ok(session.unlockedEvidence.includes(exam.evidenceCode),`EVIDENCE_NOT_RELEASED:${pack.caseId}:${key}`);
      assert.equal(event?.structuredMeasurements?.length??0,expectedMeasurements.measurements.length,`MEASUREMENT_COUNT:${pack.caseId}:${key}`);
      for(const measurement of expectedMeasurements.measurements){
        const saved=session.structuredMeasurements?.[structuredMeasurementKey(measurement)];assert.ok(saved,`MEASUREMENT_NOT_PERSISTED:${pack.caseId}:${key}`);
        assert.equal(saved.indicator,measurement.indicator);assert.equal(saved.toolId,exam.toolId);assert.equal(saved.bodyPartId,exam.bodyPartId);
      }
      released++;summary.released++;measurements+=expectedMeasurements.measurements.length;successful??={exam,data};
    }else{
      assert.equal(session.unlockedEvidence.length,evidenceBefore,`BLOCKED_EVIDENCE_LEAK:${pack.caseId}:${key}`);
      assert.equal(Object.keys(session.structuredMeasurements??{}).length,measurementBefore,`BLOCKED_MEASUREMENT_LEAK:${pack.caseId}:${key}`);
      assert.equal(result.newMessages.length,0,`BLOCKED_RESULT_LEAK:${pack.caseId}:${key}`);
      assert.ok((result.feedback?.trim().length??0)>6,`BLOCK_REASON_MISSING:${pack.caseId}:${key}:${result.feedback??''}`);
      blocked++;if(expectedAuthorBlock)summary.authorBlocked++;else if(expectedInstrumentBlock)summary.instrumentBlocked++;else summary.measurementBlocked++;
    }
  }
  assert.ok(successful,`NO_SUCCESSFUL_ACTION:${pack.caseId}`);
  summary.structuredMeasurements+=measurements;
  const restored=JSON.parse(JSON.stringify(session)) as SessionState;const eventCount=restored.events.length;const measurementCount=Object.keys(restored.structuredMeasurements??{}).length;
  const repeated=await turn(restored,successful.data,`${pack.version}-restored-repeat`);
  assert.equal(repeated.repeated,true,`RESTORED_REPEAT_NOT_SUPPRESSED:${pack.caseId}`);assert.equal(restored.events.length,eventCount);
  assert.equal(Object.keys(restored.structuredMeasurements??{}).length,measurementCount);summary.jsonRestored++;summary.repeatedSuppressed++;

  const testSession=createInitialSession(`matrix-tests-${pack.version}`,'guided',pack.caseId,undefined,pack.sourceVersion);
  const fixed=pack.tests[0];assert.ok(fixed,`FIXED_TEST_MISSING:${pack.caseId}`);
  const testResult=await runAgentTurn(testSession,{type:'ORDER_TEST',data:{requestedTests:fixed.label,reason:'核对预设结果优先复用'}},`${pack.version}-fixed-test`,{
    testSupplementInvoke:async()=>{throw new Error(`UNEXPECTED_AI_CALL:${pack.caseId}`);},
  });
  assert.ok(testSession.orderedTests.includes(fixed.id),`FIXED_TEST_NOT_RELEASED:${pack.caseId}`);
  assert.ok(testResult.newMessages.some(message=>message.content.includes(fixed.result)),`FIXED_TEST_CONTENT_MISMATCH:${pack.caseId}`);summary.fixedTestsReused++;
  summary.cases++;summary.caseDetails.push({caseId:pack.caseId,packageVersion:pack.version,exams:pack.exams.length,released,blocked,measurements,fixedTest:fixed.id});
  console.log(`[exam-matrix] ${summary.cases}/67 ${pack.caseId} exams=${pack.exams.length} released=${released} blocked=${blocked} measurements=${measurements}`);
}
const expectedExamRows=selectedPackages.reduce((sum,pack)=>sum+pack.exams.length,0);
assert.equal(summary.cases,selectedPackages.length);assert.equal(summary.examRows,expectedExamRows);assert.equal(summary.fixedTestsReused,selectedPackages.length);assert.equal(summary.jsonRestored,selectedPackages.length);
mkdirSync(outputRoot,{recursive:true});writeFileSync(path.join(outputRoot,`exam-matrix-${caseOffset}-${caseOffset+selectedPackages.length}.json`),JSON.stringify({...summary,caseOffset,runtimeGeneration,sourceArchiveSha256:runtime.sourceArchiveSha256},null,2));
console.log(`EXAM_MATRIX_PASS ${JSON.stringify({...summary,caseDetails:undefined})}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
