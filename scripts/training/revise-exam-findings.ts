/** Revise fixed, non-numeric physical findings to a NEW private generation, reusing verified media archives. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,linkSync,existsSync} from 'node:fs';
import path from 'node:path';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {controlledTrainingContentBundles} from '../../src/lib/controlled-case-registry';
import {decodeControlledTrainingContent} from '../../src/lib/controlled-case-bundle';
import {teachingPackageVersion} from '../../src/lib/teaching-package-store';
import {teachingPackageSchema} from '../../src/domain/teaching-package';
import {reviseExamPackage} from '../../src/domain/exam-package-revision';

const [archivesDirectory,targetDirectory]=process.argv.slice(2);
if(!archivesDirectory||!targetDirectory)throw Error('Usage: revise-exam-findings <registered-private-archives> <new-private-output>');
const output=path.resolve(targetDirectory),base=path.resolve(archivesDirectory);
if(existsSync(output)||output===base)throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
const upload=JSON.parse(readFileSync(path.join(base,'peds-training-upload-manifest.json'),'utf8'));
const reference=controlledTrainingContentBundles.find(ref=>ref.archive===upload.contentArchive);
if(!reference)throw Error('REGISTERED_GENERATION_REQUIRED');
const oldBytes=readFileSync(path.join(base,reference.archive));
const decoded=decodeControlledTrainingContent(oldBytes,reference);
const files=unzipSync(oldBytes),oldManifest=JSON.parse(strFromU8(files['content-manifest.json']));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const entries:Record<string,string>={},payload:Record<string,Uint8Array>={};
let changedOperations=0,addedSimulations=0,removedSimulations=0,preservedSourceOperations=0;
const audit:Array<{caseId:string;changed:number;newSimulations:number;removedSimulations:number;sourcePreserved:number}>=[];
for(const old of decoded.packages){
  const source=decoded.sources.find(item=>item.caseId===old.sourceId);
  if(!source)throw Error('SOURCE_BINDING_REQUIRED');
  const pack=reviseExamPackage(old,source.sections.exam,source.sections.diagnosis,source.sections.history);
  const {exams:oldExams,version:_oldVersion,...oldRest}=old;
  const {exams:newExams,version:_newVersion,...newRest}=pack;
  if(JSON.stringify(oldRest)!==JSON.stringify(newRest)||oldExams.length!==newExams.length)throw Error('UNRELATED_CONTENT_CHANGED');
  let changed=0,newSimulations=0,removed=0,sourcePreserved=0;
  for(let i=0;i<oldExams.length;i++){
    const before=oldExams[i],after=newExams[i];
    if(before.id!==after.id||before.evidenceCode!==after.evidenceCode||JSON.stringify(before.media)!==JSON.stringify(after.media))throw Error('EVIDENCE_OR_MEDIA_CHANGED');
    if(before.origin==='source'){
      if(JSON.stringify(before)!==JSON.stringify(after))throw Error('ORIGINAL_FINDING_CHANGED');
      sourcePreserved++;
    }
    if(JSON.stringify(before)!==JSON.stringify(after))changed++;
    if(before.origin!=='teaching-simulation'&&after.origin==='teaching-simulation')newSimulations++;
    if(before.origin==='teaching-simulation'&&after.origin==='reference')removed++;
  }
  changedOperations+=changed;addedSimulations+=newSimulations;removedSimulations+=removed;preservedSourceOperations+=sourcePreserved;
  audit.push({caseId:old.caseId,changed,newSimulations,removedSimulations:removed,sourcePreserved});
  const canonical=teachingPackageSchema.parse(pack);
  canonical.version=teachingPackageVersion(canonical);
  entries[canonical.caseId]=canonical.version;
  payload[`runtime/packages/${canonical.version}.json`]=strToU8(JSON.stringify(canonical,null,2));
}
const index=strToU8(JSON.stringify({schemaVersion:1,entries},null,2));
const generation=sha(index).slice(0,20),archive=`peds-training-content-${generation}.zip`;
payload['runtime/index.json']=index;
for(const file of oldManifest.files.filter((file:{path:string})=>file.path.startsWith('source-cases/')))payload[file.path]=files[file.path];
const mediaFiles=oldManifest.files.filter((file:{path:string})=>file.path.startsWith('runtime/media/'));
const manifestFiles=[...mediaFiles,...Object.entries(payload).map(([file,bytes])=>({path:file,bytes:bytes.length,sha256:sha(bytes),archive}))];
payload['content-manifest.json']=strToU8(JSON.stringify({schemaVersion:1,entries:67,sources:53,media:decoded.media.size,files:manifestFiles},null,2));
const bytes=zipSync(payload,{level:6});
const media=reference.media.map(ref=>({file:ref.archive,bytes:ref.bytes,sha256:ref.sha256}));
const manifest={schemaVersion:1,generation,contentArchive:archive,entries:67,sources:53,media:decoded.media.size,archives:[...media,{file:archive,bytes:bytes.length,sha256:sha(bytes)}]};
const checked=decodeControlledTrainingContent(bytes,{...reference,archive,bytes:bytes.length,sha256:sha(bytes)});
if(checked.packages.length!==67)throw Error('OUTPUT_COUNT_INVALID');
mkdirSync(output,{recursive:true});
writeFileSync(path.join(output,archive),bytes,{flag:'wx',mode:0o600});
for(const item of media){
  const original=path.join(base,item.file);
  const bytes=readFileSync(original);
  if(bytes.length!==item.bytes||sha(bytes)!==item.sha256)throw Error('REUSED_MEDIA_INTEGRITY_FAILED');
  linkSync(original,path.join(output,item.file));
}
writeFileSync(path.join(output,'peds-training-upload-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
const summary={generation,entries:67,sources:53,changedOperations,addedSimulations,removedSimulations,preservedSourceOperations,reusedMediaArchives:media.length,newArchiveBytes:bytes.length,newArchiveSha256:sha(bytes),oldGenerationUnchanged:true,databaseWrites:false,medicalReview:false,registered:false};
writeFileSync(path.join(output,'revision-audit.json'),JSON.stringify({summary,cases:audit},null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify(summary));
