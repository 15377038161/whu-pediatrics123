/** All 67 real local entries through the existing engine; no database or model calls. */
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createInitialSession,runAgentTurn} from '../../src/lib/agent-engine';
import {readTeachingPackage} from '../../src/lib/teaching-package-store';
import {buildReport} from '../../src/lib/scoring';
import {getCaseMediaLink} from '../../src/lib/case-media';
import {
  decodeControlledTrainingContent,
  decodeControlledTrainingMediaArchiveSet,
  installRecoveredTrainingContent,
  type RecoveredTrainingMedia,
} from '../../src/lib/controlled-case-bundle';
import type {ControlledArchiveReference,ControlledTrainingContentReference} from '../../src/lib/controlled-case-registry';
process.env.ENABLE_AI_FIXTURE='true';

type ContentManifest={schemaVersion:number;entries:number;sources:number;media:number;files:Array<{path:string;archive:string}>};
type UploadManifest={archives:Array<{file:string;bytes:number;sha256:string}>};
type RuntimeContext={entries:Record<string,string>;recovered:boolean;mediaVerified:number;mediaCheck:'full'|'local-only'|'not-applicable';mediaIds:Set<string>|null};

function loadRecoveredRuntime():RuntimeContext|null{
  const recoveryRoot=process.env.PEDIATRICS_TRAINING_RECOVERY_ROOT;
  if(!recoveryRoot)return null;
  const archiveRoot=process.env.PEDIATRICS_TRAINING_ARCHIVE_ROOT;
  if(!archiveRoot)throw new Error('PEDIATRICS_TRAINING_ARCHIVE_REQUIRED');
  const manifest=JSON.parse(readFileSync(path.join(recoveryRoot,'content-manifest.json'),'utf8')) as ContentManifest;
  const upload=JSON.parse(readFileSync(path.join(archiveRoot,'peds-training-upload-manifest.json'),'utf8')) as UploadManifest;
  const archives=new Map(upload.archives.map(item=>[item.file,item]));
  const contentArchive=manifest.files.find(file=>file.path==='runtime/index.json')?.archive;
  if(!contentArchive)throw new Error('TRAINING_CONTENT_ARCHIVE_MISSING');
  const archiveReference=(file:string):ControlledArchiveReference=>{
    const item=archives.get(file);
    if(!item)throw new Error(`TRAINING_ARCHIVE_NOT_LISTED:${file}`);
    return {fileId:`local-recovery:${file}`,archive:file,bytes:item.bytes,sha256:item.sha256};
  };
  const mediaNames=[...new Set(manifest.files.filter(file=>file.path.startsWith('runtime/media/')).map(file=>file.archive))];
  const reference:ControlledTrainingContentReference={
    ...archiveReference(contentArchive),media:mediaNames.map(archiveReference),
    expected:{entries:manifest.entries,sources:manifest.sources,media:manifest.media},
  };
  const content=decodeControlledTrainingContent(readFileSync(path.join(archiveRoot,contentArchive)),reference);
  const groups=new Map<string,RecoveredTrainingMedia[]>();
  for(const descriptor of content.media.values()){
    const group=groups.get(descriptor.archive)??[];group.push(descriptor);groups.set(descriptor.archive,group);
  }
  const mediaCheck=process.env.PEDIATRICS_TRAINING_VERIFY_MEDIA==='local-only'?'local-only':'full';
  let mediaVerified=0;
  if(mediaCheck==='full'){
    for(const [archive,descriptors] of groups){
      const decoded=decodeControlledTrainingMediaArchiveSet(readFileSync(path.join(archiveRoot,archive)),archiveReference(archive),descriptors);
      mediaVerified+=decoded.size;
    }
    if(mediaVerified!==content.media.size||groups.size!==mediaNames.length)throw new Error('TRAINING_MEDIA_COUNT_INVALID');
  }
  installRecoveredTrainingContent(content,reference);
  // Local media are used only by this isolated process; production uses the registered archive reader.
  process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT=path.join(recoveryRoot,'runtime');
  process.env.PEDIATRICS_KNOWLEDGE_ROOT=recoveryRoot;
  return {entries:content.entries,recovered:true,mediaVerified,mediaCheck,mediaIds:new Set(content.media.keys())};
}

async function verifyReleasedMedia(session:{events:Array<{media?:Array<{fileId:string}>}>}):Promise<number>{
  let count=0;
  for(const event of session.events)for(const media of event.media??[]){
    const link=await getCaseMediaLink(media.fileId);assert.ok(link.url);count+=1;
  }
  return count;
}

async function main(){
  const recovered=loadRecoveredRuntime();
  const index=recovered??{entries:(JSON.parse(readFileSync('knowledge/training-packages/index.json','utf8')) as {entries:Record<string,string>}).entries,recovered:false,mediaVerified:0,mediaCheck:'not-applicable' as const,mediaIds:null};
  const onlyCase=process.env.PEDIATRICS_TRAINING_VERIFY_CASE;
  const entries=Object.entries(index.entries).filter(([caseId])=>!onlyCase||caseId===onlyCase);
  if(onlyCase&&entries.length!==1)throw new Error('VERIFY_CASE_NOT_IN_RUNTIME_INDEX');
  const results:Array<Record<string,unknown>>=[];
  for(const [caseId,version] of entries){
    let sourceSnapshotVersion:string|null=null;
    try{
      const pack=readTeachingPackage(caseId,version);assert.ok(pack,'TEACHING_PACKAGE_MISSING');
      sourceSnapshotVersion=pack.sourceVersion;
      const packageMedia=[...pack.exams,...pack.tests].flatMap(item=>item.media??[]);
      if(index.mediaIds)for(const media of packageMedia){
        if(media.fileId.startsWith('training-media:'))assert.ok(index.mediaIds.has(media.fileId.slice('training-media:'.length)),'PACKAGE_MEDIA_NOT_IN_MANIFEST');
      }
      const session=createInitialSession('local-full-library-validation','guided',caseId,undefined,recovered?pack.sourceVersion:undefined);
      assert.equal(session.teachingPackageVersion,version,'TEACHING_PACKAGE_VERSION_MISMATCH');
      assert.equal(session.sourceSnapshotVersion,pack.sourceVersion,'SOURCE_SNAPSHOT_VERSION_MISMATCH');
      await runAgentTurn(session,{type:'ASK_QUESTION',data:{text:'最早什么时候开始不舒服？'}},'runtime-question');
      await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'axillary-thermometer',bodyPartId:'forehead',posture:'supine',position:'supine'}},'runtime-wrong-tool');
      assert.equal(session.events.at(-1)?.correct,false,'WRONG_TOOL_WAS_ACCEPTED');
      await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands',posture:'supine',position:'supine'}},'runtime-prep');
      const exam=pack.exams.find(e=>e.origin==='source')??pack.exams[0];assert.ok(exam,'EXAM_MISSING');
      const position=exam.allowedPositions?.[0]??exam.postures[0];
      await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:exam.toolId,bodyPartId:exam.bodyPartId,posture:position==='standing'?'standing':'supine',position,location:{side:exam.bodyPartId.startsWith('left-')?'left':exam.bodyPartId.startsWith('right-')?'right':'both',aspect:exam.aspect??'front'}}},'runtime-exam');
      assert.equal(session.events.at(-1)?.correct,true,'EXAM_WAS_REJECTED');
      const check=pack.tests.find(t=>t.origin==='source')??pack.tests[0];assert.ok(check,'TEST_MISSING');
      await runAgentTurn(session,{type:'ORDER_TEST',data:{requestedTests:check.label,reason:'评估本次临床问题并结合结果判断'}},'runtime-test');
      assert.ok(session.orderedTests.includes(check.id),'TEST_NOT_RELEASED');
      const mediaLinks=await verifyReleasedMedia(session);
      const restored=JSON.parse(JSON.stringify(session));assert.equal(restored.teachingPackageVersion,version,'RESTORED_PACKAGE_VERSION_MISMATCH');assert.equal(restored.sourceSnapshotVersion,pack.sourceVersion,'RESTORED_SOURCE_VERSION_MISMATCH');
      const report=buildReport(restored);assert.equal(report.teachingFeedback?.packageVersion,version,'REPORT_PACKAGE_VERSION_MISMATCH');
      results.push({caseId,version,teachingPackageVersion:version,sourceSnapshotVersion:pack.sourceVersion,mediaReferences:packageMedia.length,mediaLinks,passed:true,events:session.events.length});
    }catch(error){results.push({caseId,version,teachingPackageVersion:version,sourceSnapshotVersion,passed:false,errorKind:error instanceof Error?error.name:'unknown',error:error instanceof Error?error.message:'unknown'});}
  }
  const output=process.env.PEDIATRICS_TRAINING_VERIFY_OUTPUT??(recovered?'outputs/training-20261107/runtime-validation-recovered.json':'outputs/training-20261107/runtime-validation.json');
  mkdirSync(path.dirname(output),{recursive:true});
  const summary={mode:recovered?'isolated-recovery':'local',entries:results.length,passed:results.filter(r=>r.passed).length,mediaVerified:index.mediaVerified,mediaCheck:index.mediaCheck,results};
  writeFileSync(output,JSON.stringify(summary,null,2));
  console.log(JSON.stringify({mode:summary.mode,entries:summary.entries,passed:summary.passed,mediaVerified:summary.mediaVerified,mediaCheck:summary.mediaCheck,output,failed:results.filter(r=>!r.passed).map(r=>({caseId:r.caseId,errorKind:r.errorKind,error:r.error}))}));
  if(results.some(r=>!r.passed))process.exitCode=1;
}
void main();
