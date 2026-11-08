/** All-case growth release, mismatch, repeat and immutable old-session checks; no model/auth/database writes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {decodeControlledTrainingContent,installRecoveredTrainingContent} from '../../src/lib/controlled-case-bundle';
import {controlledTrainingContentBundles,type ControlledTrainingContentReference} from '../../src/lib/controlled-case-registry';
import {createInitialSession,runAgentTurn} from '../../src/lib/agent-engine';
import {readTeachingPackage} from '../../src/lib/teaching-package-store';
import {GROWTH_TOOLS,growthPosition} from '../../src/domain/growth-exam';
import type {SessionState,AgentEvent} from '../../src/domain/agent';
import {projectSessionForRole} from '../../src/lib/session-projection';
process.env.ENABLE_AI_FIXTURE='true';
const [oldDirectory,newDirectory,output]=process.argv.slice(2);
if(!oldDirectory||!newDirectory||!output||!path.resolve(output).startsWith(path.resolve('outputs')+path.sep))throw Error('Usage: verify-growth-runtime <old-archives> <new-archives> <private-output-json>');
const load=(directory:string)=>{
  const manifest=JSON.parse(readFileSync(path.join(directory,'peds-training-upload-manifest.json'),'utf8'));
  const ref=(file:string)=>({...manifest.archives.find((a:{file:string})=>a.file===file),fileId:`local-growth-test:${file}`,archive:file});
  const reference:ControlledTrainingContentReference={...ref(manifest.contentArchive),media:manifest.archives.filter((a:{file:string})=>a.file!==manifest.contentArchive).map((a:{file:string})=>ref(a.file)),expected:{entries:67,sources:53,media:1042}};
  const content=decodeControlledTrainingContent(readFileSync(path.join(directory,manifest.contentArchive)),reference);
  installRecoveredTrainingContent(content,reference);return content;
};
async function main(){
const old=load(oldDirectory),caseId=old.packages[0].caseId;
assert.ok(controlledTrainingContentBundles.some(ref=>ref.archive===JSON.parse(readFileSync(path.join(oldDirectory,'peds-training-upload-manifest.json'),'utf8')).contentArchive));
const historical=createInitialSession('growth-history','guided',caseId,undefined,old.packages[0].sourceVersion);
const oldVersion=historical.teachingPackageVersion;
const current=load(newDirectory),results=[];
for(const pack of current.packages){
  const state=createInitialSession('growth-test','guided',pack.caseId,undefined,pack.sourceVersion);
  assert.equal(state.teachingPackageVersion,pack.version);
  assert.equal(projectSessionForRole(state,'student').caseOptions?.growthMeasurements,true);
  assert.deepEqual(projectSessionForRole(state,'student').caseOptions?.exams,[]);
  await runAgentTurn(state,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands'}},'prepare');
  for(const tool of GROWTH_TOOLS){
    const exam=pack.exams.find(exam=>exam.toolId===tool&&exam.bodyPartId==='growth')!;
    assert.ok(exam);
    const position=growthPosition(tool)!;
    const action:Extract<AgentEvent,{type:'EXAM_ACTION'}>={type:'EXAM_ACTION',data:{toolId:tool,bodyPartId:'growth',position,posture:position,location:{side:'midline',aspect:'front'}}};
    const before=[...state.unlockedEvidence];
    await runAgentTurn(state,{type:'EXAM_ACTION',data:{...action.data,bodyPartId:'eyes'}},'wrong-site-'+tool);
    assert.deepEqual(state.unlockedEvidence,before);
    assert.equal(state.events.at(-1)?.examAction?.failure,'pairing');
    const wrongPosition=position==='standing'?'supine':'standing';
    await runAgentTurn(state,{type:'EXAM_ACTION',data:{...action.data,position:wrongPosition,posture:wrongPosition}},'wrong-position-'+tool);
    assert.deepEqual(state.unlockedEvidence,before);
    assert.equal(state.events.at(-1)?.examAction?.failure,'position');
    await runAgentTurn(state,action,'correct-'+tool);
    assert.equal(state.events.at(-1)?.correct,true);
    assert.ok(state.events.at(-1)?.summary.includes(exam.result));
    const restored=JSON.parse(JSON.stringify(state)) as SessionState;
    const count=restored.events.length;
    const duplicate=await runAgentTurn(restored,action,'repeated-'+tool);
    assert.equal(duplicate.repeated,true);assert.equal(duplicate.feedback,null);assert.equal(restored.events.length,count);
  }
  results.push({caseId:pack.caseId,version:pack.version,operations:GROWTH_TOOLS.length,passed:true});
}
const recovered=JSON.parse(JSON.stringify(historical)) as SessionState;
assert.equal(recovered.teachingPackageVersion,oldVersion);
assert.notEqual(projectSessionForRole(recovered,'student').caseOptions?.growthMeasurements,true,'historical version must not expose unsupported growth tools');
assert.equal(readTeachingPackage(recovered.caseId,oldVersion,recovered.sourceSnapshotVersion)?.exams.some(exam=>GROWTH_TOOLS.some(tool=>tool===exam.toolId)),false);
mkdirSync(path.dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify({cases:results.length,operations:results.length*GROWTH_TOOLS.length,passed:results.length,oldSessionVersionStable:true,databaseWrites:false,realLogin:false,results},null,2),{mode:0o600});
console.log(JSON.stringify({cases:results.length,operations:results.length*GROWTH_TOOLS.length,passed:results.length,oldSessionVersionStable:true,databaseWrites:false,realLogin:false}));
}
void main();
