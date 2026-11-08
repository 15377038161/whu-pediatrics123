/** Add fixed, source-bound growth operations to a NEW private generation, reusing verified media archives. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,linkSync,existsSync} from 'node:fs';
import path from 'node:path';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {controlledTrainingContentBundles} from '../../src/lib/controlled-case-registry';
import {decodeControlledTrainingContent} from '../../src/lib/controlled-case-bundle';
import {teachingPackageVersion} from '../../src/lib/teaching-package-store';
import {teachingPackageSchema,type TeachingExam} from '../../src/domain/teaching-package';
import {GROWTH_TOOLS,growthMeasurement,growthPosition,growthProtocol} from '../../src/domain/growth-exam';
import {EXAM_INSTRUMENTS} from '../../src/domain/exam-anatomy';

const [archivesDirectory,targetDirectory]=process.argv.slice(2);
if(!archivesDirectory||!targetDirectory)throw Error('Usage: add-growth-measurements <registered-private-archives> <new-private-output>');
const output=path.resolve(targetDirectory),base=path.resolve(archivesDirectory);
if(!output.startsWith(path.resolve('outputs')+path.sep)||existsSync(output))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
const upload=JSON.parse(readFileSync(path.join(base,'peds-training-upload-manifest.json'),'utf8'));
const reference=controlledTrainingContentBundles.find(ref=>ref.archive===upload.contentArchive);
if(!reference)throw Error('REGISTERED_GENERATION_REQUIRED');
const oldBytes=readFileSync(path.join(base,reference.archive));
const decoded=decodeControlledTrainingContent(oldBytes,reference);
const files=unzipSync(oldBytes),oldManifest=JSON.parse(strFromU8(files['content-manifest.json']));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const entries:Record<string,string>={},payload:Record<string,Uint8Array>={};
let sourceMeasurements=0,referenceMeasurements=0;
for(const old of decoded.packages){
  const pack=structuredClone(old);
  const text=pack.referenceNote.physicalExam??'';
  const make=(tool:string):TeachingExam=>{
    const protocol=growthProtocol(tool)!;
    const position=growthPosition(tool);
    const values=growthMeasurement(tool,text),hasValue=values.length>0;
    const label=EXAM_INSTRUMENTS.find(item=>item.id===tool)!.label;
    if(hasValue)sourceMeasurements++;else referenceMeasurements++;
    return {id:`teaching-exam-${tool}-growth`,toolId:tool as TeachingExam['toolId'],bodyPartId:'growth',label:tool==='measuring-tape'?'头围测量':`${label}测量`,
      evidenceCode:tool==='standing-scale'||tool==='infant-scale'?'TEACH_EX_growth_weight':tool==='measuring-tape'?'TEACH_EX_growth_head':`TEACH_EX_growth_${tool}`,
      result:hasValue?`原记录：${values.join('；')}。沿用原文时点与单位；原记录未注明具体器材及测量方法时，不把已有数值当作本器材新测所得，不擅自换算身高与身长或判断生长正常。`:`本项原记录未提供可核验的独立测量值。${protocol.normal}`,
      origin:hasValue?'source':'reference',scope:hasValue?'local':'reference',sourceLocator:hasValue?'sections.exam（明确标注的生长测量原文）':'教学测量方法与评估参考',
      postures:position?[position]:['standing','supine'],allowedPositions:position?[position]:['standing','supine','sitting'],aspect:'front',
      technique:protocol.technique,reaction:protocol.reaction,interpretation:'先核对单位、测量方法和记录时点，再结合适龄生长曲线及动态变化评价；资料不足不补为正常。',media:[]};
  };
  for(const tool of GROWTH_TOOLS){
    if(pack.exams.some(exam=>exam.toolId===tool&&exam.bodyPartId==='growth'))throw Error('GROWTH_ALREADY_INSTALLED');
    pack.exams.push(make(tool));
  }
  const tape=pack.exams.findIndex(exam=>exam.toolId==='measuring-tape'&&exam.bodyPartId==='growth');
  if(tape>=0&&pack.exams[tape].origin==='reference')pack.exams[tape]=make('measuring-tape');
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
console.log(JSON.stringify({generation,entries:67,sources:53,addedOperations:67*GROWTH_TOOLS.length,sourceMeasurements,referenceMeasurements,reusedMediaArchives:media.length,newArchiveBytes:bytes.length,newArchiveSha256:sha(bytes),oldGenerationUnchanged:true,databaseWrites:false}));
