/** All 67 real local entries through the existing engine; no database or model calls. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createInitialSession,runAgentTurn} from '../../src/lib/agent-engine';
import {readTeachingPackage} from '../../src/lib/teaching-package-store';
import {buildReport} from '../../src/lib/scoring';
process.env.ENABLE_AI_FIXTURE='true';
async function main(){
  const index=JSON.parse(readFileSync('knowledge/training-packages/index.json','utf8')) as {entries:Record<string,string>};
  const results=[];
  for(const [caseId,version] of Object.entries(index.entries)){
    try{
      const pack=readTeachingPackage(caseId,version);assert.ok(pack);
      const session=createInitialSession('local-full-library-validation','guided',caseId);
      assert.equal(session.teachingPackageVersion,version);assert.equal(session.sourceSnapshotVersion,pack.sourceVersion);
      await runAgentTurn(session,{type:'ASK_QUESTION',data:{text:'最早什么时候开始不舒服？'}},'runtime-question');
      await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'axillary-thermometer',bodyPartId:'forehead',posture:'supine',position:'supine'}},'runtime-wrong-tool');
      assert.equal(session.events.at(-1)?.correct,false);
      await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands',posture:'supine',position:'supine'}},'runtime-prep');
      const exam=pack.exams.find(e=>e.origin==='source')??pack.exams[0];
      const position=exam.allowedPositions?.[0]??exam.postures[0];
      await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:exam.toolId,bodyPartId:exam.bodyPartId,posture:position==='standing'?'standing':'supine',position,location:{side:exam.bodyPartId.startsWith('left-')?'left':exam.bodyPartId.startsWith('right-')?'right':'both',aspect:exam.aspect??'front'}}},'runtime-exam');
      assert.equal(session.events.at(-1)?.correct,true);
      const check=pack.tests.find(t=>t.origin==='source')??pack.tests[0];
      await runAgentTurn(session,{type:'ORDER_TEST',data:{requestedTests:check.label,reason:'评估本次临床问题并结合结果判断'}},'runtime-test');
      assert.ok(session.orderedTests.includes(check.id));
      const restored=JSON.parse(JSON.stringify(session));assert.equal(restored.teachingPackageVersion,version);
      const report=buildReport(restored);assert.equal(report.teachingFeedback?.packageVersion,version);
      results.push({caseId,version,passed:true,events:session.events.length});
    }catch(error){results.push({caseId,version,passed:false,errorKind:error instanceof Error?error.name:'unknown'});}
  }
  writeFileSync('outputs/training-20261107/runtime-validation.json',JSON.stringify({entries:results.length,passed:results.filter(r=>r.passed).length,results},null,2));
  console.log(JSON.stringify({entries:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).map(r=>({caseId:r.caseId,errorKind:r.errorKind}))}));
  if(results.some(r=>!r.passed))process.exitCode=1;
}
void main();
