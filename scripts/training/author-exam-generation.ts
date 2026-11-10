/** Build a new private teaching generation from verified rows. No AI, database writes or deployment. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,linkSync,existsSync} from 'node:fs';
import path from 'node:path';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {z} from 'zod';
import {controlledTrainingContentBundles} from '../../src/lib/controlled-case-registry';
import {decodeControlledTrainingContent} from '../../src/lib/controlled-case-bundle';
import {teachingPackageVersion} from '../../src/lib/teaching-package-store';
import {teachingPackageSchema,type TeachingExam} from '../../src/domain/teaching-package';
import {applyExamSelections,applyExamLocalSupplements,type ExamSelectionItem} from '../../src/domain/exam-authoring-selection';
import {hasAbnormalMarker} from '../../src/domain/exam-finding-composer';
import {
  fixedAxillaryTemperatureSelection,fixedInfraredTemperatureSelection,fixedTympanicTemperatureSelection,fixedOximeterSelection,
  fixedGrowthMeasurementSelection,
} from '../../src/domain/exam-fixed-teaching';

const [archivesDirectory,authoringDirectory,targetDirectory,...flags]=process.argv.slice(2);
if(!archivesDirectory||!authoringDirectory||!targetDirectory||flags.some(flag=>!/^--expect-migrations=\d+$/.test(flag))||flags.length>1)throw Error('Usage: author-exam-generation <verified-archives> <verified-authoring-export> <NEW-private-output> [--expect-migrations=N]');
const expectedMigrations=flags.length?Number(flags[0].slice('--expect-migrations='.length)):19;
if(!Number.isSafeInteger(expectedMigrations)||expectedMigrations<0)throw Error('EXPECTED_MIGRATIONS_INVALID');
const output=path.resolve(targetDirectory),base=path.resolve(archivesDirectory),authoringRoot=path.resolve(authoringDirectory);
if(existsSync(output)||output===base||output===authoringRoot)throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
const upload=JSON.parse(readFileSync(path.join(base,'peds-training-upload-manifest.json'),'utf8')) as {generation:string;contentArchive:string};
const reference=controlledTrainingContentBundles.find(ref=>ref.archive===upload.contentArchive);
if(!reference)throw Error('REGISTERED_GENERATION_REQUIRED');
const oldBytes=readFileSync(path.join(base,reference.archive));
const decoded=decodeControlledTrainingContent(oldBytes,reference);
const files=unzipSync(oldBytes),oldManifest=JSON.parse(strFromU8(files['content-manifest.json'])) as {files:Array<{path:string;bytes:number;sha256:string;archive:string}>};
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);

const patientSchema=z.object({
  result:z.string(),origin:z.enum(['source','teaching-simulation','reference']),scope:z.enum(['local','whole-region','reference']),sourceLocator:z.string(),
});
const operationSchema=z.object({
  postures:z.array(z.enum(['standing','supine'])),
  allowedPositions:z.array(z.enum(['standing','supine','sitting','lateral','prone'])).optional(),
  aspect:z.enum(['front','back']).optional(),technique:z.string(),reaction:z.string(),
});
const authoringCaseSchema=z.object({
  schemaVersion:z.literal(1),kind:z.literal('private-exam-authoring'),caseId:z.string(),sourceId:z.string(),sourceVersion:z.string(),
  inputTeachingVersion:z.string(),age:z.string(),sex:z.string(),
  rows:z.array(z.object({
    id:z.string(),toolId:z.string(),bodyPartId:z.string(),evidenceCode:z.string(),media:z.array(z.unknown()),
    patient:patientSchema,operation:operationSchema,
  }).passthrough()),
}).passthrough();
type AuthoringCase=z.infer<typeof authoringCaseSchema>;
type AuthoringRow=AuthoringCase['rows'][number];

const authoringIndex=JSON.parse(readFileSync(path.join(authoringRoot,'index.json'),'utf8')) as {schemaVersion:number;files:Array<{caseId:string;file:string;bytes:number;sha256:string}>};
if(authoringIndex.schemaVersion!==1||authoringIndex.files.length!==67)throw Error('AUTHORING_INDEX_INVALID');
const authoringCases=new Map<string,AuthoringCase>();
for(const entry of authoringIndex.files){
  if(!/^cases\/[^/]+\.json$/.test(entry.file))throw Error('AUTHORING_PATH_INVALID');
  const raw=readFileSync(path.join(authoringRoot,entry.file));
  if(raw.length!==entry.bytes||sha(raw)!==entry.sha256)throw Error('AUTHORING_INTEGRITY_FAILED');
  const record=authoringCaseSchema.parse(JSON.parse(raw.toString('utf8')));
  if(record.caseId!==entry.caseId||authoringCases.has(record.caseId))throw Error('AUTHORING_CASE_BINDING_INVALID');
  authoringCases.set(record.caseId,record);
}
if(authoringCases.size!==67)throw Error('AUTHORING_COUNT_INVALID');

function copyOperation(exam:TeachingExam,row:AuthoringRow):void {
  exam.postures=[...row.operation.postures];
  if(row.operation.allowedPositions)exam.allowedPositions=[...row.operation.allowedPositions];else delete exam.allowedPositions;
  if(row.operation.aspect)exam.aspect=row.operation.aspect;else delete exam.aspect;
  exam.technique=row.operation.technique;
  exam.reaction=row.operation.reaction;
}

const entries:Record<string,string>={},payload:Record<string,Uint8Array>={};
const caseAudit:Array<Record<string,unknown>>=[];
let migratedExisting=0,fixedAxillary=0,fixedInfrared=0,fixedTympanic=0,fixedOximeter=0,fixedGrowth=0,referenceTextUpdates=0,metadataChanges=0,preservedSourceOperations=0,remainingReference=0,remainingWholeRegion=0,localSupplementsTotal=0,wholeRegionSupplementedTotal=0,otherWholeRegionTotal=0,remainingNonLocalTotal=0;
for(const old of decoded.packages){
  const author=authoringCases.get(old.caseId);
  if(!author||author.sourceId!==old.sourceId||author.sourceVersion!==old.sourceVersion||author.age!==old.age||author.sex!==old.sex)throw Error(`AUTHORING_BINDING_MISMATCH:${old.caseId}`);
  const rows=new Map<string,AuthoringRow>();
  for(const row of author.rows){
    if(rows.has(row.id))throw Error(`AUTHORING_DUPLICATE_ROW:${old.caseId}`);
    rows.set(row.id,row);
  }
  if(rows.size!==old.exams.length)throw Error(`AUTHORING_ROW_COUNT_INVALID:${old.caseId}`);
  const pack=structuredClone(old),migrations:ExamSelectionItem[]=[];
  let metadata=0;
  for(const exam of pack.exams){
    const row=rows.get(exam.id);
    if(!row||row.toolId!==exam.toolId||row.bodyPartId!==exam.bodyPartId||row.evidenceCode!==exam.evidenceCode||!same(row.media,exam.media))throw Error(`STABLE_ROW_MISMATCH:${old.caseId}`);
    const before=JSON.stringify(exam);
    if(exam.origin==='source'){
      if(row.patient.origin!=='source'||row.patient.result!==exam.result||row.patient.scope!==exam.scope||row.patient.sourceLocator!==exam.sourceLocator)throw Error(`SOURCE_ROW_CHANGED:${old.caseId}`);
      const operationBefore=JSON.stringify({postures:exam.postures,allowedPositions:exam.allowedPositions,aspect:exam.aspect,technique:exam.technique,reaction:exam.reaction});
      const operationAfter=JSON.stringify({postures:row.operation.postures,allowedPositions:row.operation.allowedPositions,aspect:row.operation.aspect,technique:row.operation.technique,reaction:row.operation.reaction});
      if(operationBefore!==operationAfter)throw Error(`SOURCE_OPERATION_CHANGED:${old.caseId}`);
      preservedSourceOperations++;
      continue;
    }
    if(row.patient.origin==='source')throw Error(`SOURCE_PROMOTION_FORBIDDEN:${old.caseId}`);
    const migrate=exam.origin==='reference'&&row.patient.origin==='teaching-simulation';
    const referenceTextUpdate=exam.origin==='reference'&&row.patient.origin==='reference'&&exam.result!==row.patient.result;
    if(exam.result!==row.patient.result&&!migrate&&!referenceTextUpdate)throw Error(`UNREVIEWED_RESULT_DIFFERENCE:${old.caseId}`);
    if(exam.origin==='teaching-simulation'&&row.patient.origin==='reference')throw Error(`SIMULATION_REMOVAL_FORBIDDEN:${old.caseId}`);
    copyOperation(exam,row);
    if(referenceTextUpdate){exam.result=row.patient.result;referenceTextUpdates++;}
    exam.scope=row.patient.scope;
    exam.sourceLocator=row.patient.sourceLocator;
    if(before!==JSON.stringify(exam))metadata++;
    if(migrate)migrations.push({
      id:exam.id,state:hasAbnormalMarker(row.patient.result)?'abnormal':'normal',origin:'teaching-simulation',result:row.patient.result,
      rationale:'迁移已核验附件中同来源、同稳定行ID的既有固定局部教学模拟；未新增或改写原患者实测。',
    });
  }
  pack.version=teachingPackageVersion(pack);
  let canonical=pack;
  const authorEntry=authoringIndex.files.find(entry=>entry.caseId===old.caseId);
  const supplementFile=authorEntry?path.join(authoringRoot,authorEntry.file.replace(/^cases\//,'local-supplements/')):'';
  if(supplementFile&&existsSync(supplementFile)){
    canonical=applyExamLocalSupplements(canonical,JSON.parse(readFileSync(supplementFile,'utf8')));
    canonical.version=teachingPackageVersion(canonical);
  }
  const localSupplements=canonical.exams.filter((exam,index)=>!old.exams[index].localSupplement&&exam.localSupplement).length;
  const fixed:ExamSelectionItem[]=[];
  const caseFixed={axillary:0,infrared:0,tympanic:0,oximeter:0,growth:0};
  for(const exam of canonical.exams){
    const selection=fixedAxillaryTemperatureSelection(canonical,exam)??fixedInfraredTemperatureSelection(canonical,exam)
      ??fixedTympanicTemperatureSelection(canonical,exam)??fixedOximeterSelection(canonical,exam)??fixedGrowthMeasurementSelection(canonical,exam);
    if(!selection)continue;
    fixed.push(selection);
    if(exam.toolId==='axillary-thermometer')caseFixed.axillary++;
    if(exam.toolId==='infrared-thermometer')caseFixed.infrared++;
    if(exam.toolId==='tympanic-thermometer')caseFixed.tympanic++;
    if(exam.toolId==='oximeter')caseFixed.oximeter++;
    if(['standing-scale','infant-scale','length-board','stadiometer','measuring-tape'].includes(exam.toolId))caseFixed.growth++;
  }
  const selections=[...migrations,...fixed];
  if(selections.length){
    canonical=applyExamSelections(canonical,{caseId:canonical.caseId,sourceVersion:canonical.sourceVersion,inputTeachingVersion:canonical.version,selections});
    canonical.version=teachingPackageVersion(canonical);
  }
  canonical=teachingPackageSchema.parse(canonical);
  const {exams:oldExams,version:_oldVersion,...oldRest}=old;
  const {exams:newExams,version:_newVersion,...newRest}=canonical;
  if(!same(oldRest,newRest)||oldExams.length!==newExams.length)throw Error(`UNRELATED_CONTENT_CHANGED:${old.caseId}`);
  for(let index=0;index<oldExams.length;index++){
    if(oldExams[index].origin==='source'){
      const {localSupplement:oldSupplement,...oldSource}=oldExams[index];
      const {localSupplement:newSupplement,...newSource}=newExams[index];
      if(!same(oldSource,newSource)||(oldSupplement&&!same(oldSupplement,newSupplement)))throw Error(`ORIGINAL_FINDING_CHANGED:${old.caseId}`);
    }
    if(oldExams[index].origin==='teaching-simulation'&&(newExams[index].origin!=='teaching-simulation'||newExams[index].result!==oldExams[index].result))throw Error(`EXISTING_TEACHING_RESULT_CHANGED:${old.caseId}`);
    if(oldExams[index].id!==newExams[index].id||oldExams[index].evidenceCode!==newExams[index].evidenceCode||!same(oldExams[index].media,newExams[index].media))throw Error(`EVIDENCE_OR_MEDIA_CHANGED:${old.caseId}`);
  }
  const referenceCount=canonical.exams.filter(exam=>exam.origin==='reference').length;
  const wholeRegion=canonical.exams.filter(exam=>exam.origin==='source'&&exam.scope==='whole-region'&&!exam.localSupplement).length;
  const supplementedWholeRegion=canonical.exams.filter(exam=>exam.origin==='source'&&exam.scope==='whole-region'&&exam.localSupplement).length;
  const otherWholeRegion=canonical.exams.filter(exam=>exam.origin!=='source'&&exam.scope==='whole-region').length;
  const remainingNonLocal=canonical.exams.filter(exam=>exam.origin==='reference'||exam.scope!=='local'&&!exam.localSupplement).length;
  migratedExisting+=migrations.length;fixedAxillary+=caseFixed.axillary;fixedInfrared+=caseFixed.infrared;
  fixedTympanic+=caseFixed.tympanic;fixedOximeter+=caseFixed.oximeter;fixedGrowth+=caseFixed.growth;metadataChanges+=metadata;
  remainingReference+=referenceCount;remainingWholeRegion+=wholeRegion;localSupplementsTotal+=localSupplements;wholeRegionSupplementedTotal+=supplementedWholeRegion;
  otherWholeRegionTotal+=otherWholeRegion;remainingNonLocalTotal+=remainingNonLocal;
  caseAudit.push({
    caseId:old.caseId,inputVersion:old.version,outputVersion:canonical.version,validation:'passed',
    completion:remainingNonLocal===0?'complete':'partial',migratedExisting:migrations.length,fixedMeasurements:fixed.length,
    fixedAxillary:caseFixed.axillary,fixedInfrared:caseFixed.infrared,fixedTympanic:caseFixed.tympanic,fixedOximeter:caseFixed.oximeter,fixedGrowth:caseFixed.growth,
    localSupplements,wholeRegionSupplemented:supplementedWholeRegion,otherWholeRegion,remainingNonLocal,
    metadataChanges:metadata,referenceTextUpdates:oldExams.filter((exam,index)=>exam.origin==='reference'&&newExams[index].origin==='reference'&&exam.result!==newExams[index].result).length,
    remainingReference:referenceCount,remainingWholeRegion:wholeRegion,
  });
  entries[canonical.caseId]=canonical.version;
  payload[`runtime/packages/${canonical.version}.json`]=strToU8(JSON.stringify(canonical,null,2));
}
if(decoded.packages.length!==67||migratedExisting!==expectedMigrations)throw Error(`MIGRATION_COUNT_INVALID:packages=${decoded.packages.length}:migrated=${migratedExisting}:expected=${expectedMigrations}`);
const index=strToU8(JSON.stringify({schemaVersion:1,entries},null,2));
const generation=sha(index).slice(0,20),archive=`peds-training-content-${generation}.zip`;
if(generation===upload.generation)throw Error('NEW_GENERATION_REQUIRED');
payload['runtime/index.json']=index;
for(const file of oldManifest.files.filter(file=>file.path.startsWith('source-cases/')))payload[file.path]=files[file.path];
const mediaFiles=oldManifest.files.filter(file=>file.path.startsWith('runtime/media/'));
const manifestFiles=[...mediaFiles,...Object.entries(payload).map(([file,bytes])=>({path:file,bytes:bytes.length,sha256:sha(bytes),archive}))];
payload['content-manifest.json']=strToU8(JSON.stringify({schemaVersion:1,entries:67,sources:53,media:decoded.media.size,files:manifestFiles},null,2));
const bytes=zipSync(payload,{level:6});
const media=reference.media.map(ref=>({file:ref.archive,bytes:ref.bytes,sha256:ref.sha256}));
const manifest={schemaVersion:1,generation,contentArchive:archive,entries:67,sources:53,media:decoded.media.size,archives:[...media,{file:archive,bytes:bytes.length,sha256:sha(bytes)}]};
const checked=decodeControlledTrainingContent(bytes,{...reference,archive,bytes:bytes.length,sha256:sha(bytes)});
if(checked.packages.length!==67)throw Error('OUTPUT_COUNT_INVALID');
mkdirSync(output,{recursive:true,mode:0o700});
writeFileSync(path.join(output,archive),bytes,{flag:'wx',mode:0o600});
for(const item of media){
  const original=path.join(base,item.file),raw=readFileSync(original);
  if(raw.length!==item.bytes||sha(raw)!==item.sha256)throw Error('REUSED_MEDIA_INTEGRITY_FAILED');
  linkSync(original,path.join(output,item.file));
}
writeFileSync(path.join(output,'peds-training-upload-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
const summary={
  generation,inputGeneration:upload.generation,entries:67,sources:53,rows:decoded.packages.reduce((sum,pack)=>sum+pack.exams.length,0),
  expectedMigrations,migratedExisting,priorLocalOverlayRecovered:migratedExisting===19,
  fixedAxillary,fixedInfrared,fixedTympanic,fixedOximeter,fixedGrowth,
  fixedMeasurements:fixedAxillary+fixedInfrared+fixedTympanic+fixedOximeter+fixedGrowth,
  referenceTextUpdates,metadataChanges,preservedSourceOperations,remainingReference,remainingWholeRegion,
  localSupplements:localSupplementsTotal,wholeRegionSupplemented:wholeRegionSupplementedTotal,
  otherWholeRegion:otherWholeRegionTotal,remainingNonLocal:remainingNonLocalTotal,
  reusedMediaArchives:media.length,newArchiveBytes:bytes.length,newArchiveSha256:sha(bytes),
  allSourceRowsUnchanged:true,allPatientSourceResultsUnchanged:true,allExistingTeachingResultsUnchanged:true,
  allPatientResultsCompleted:remainingNonLocalTotal===0,
  medicalReview:false,databaseWrites:false,deployed:false,registered:false,
};
writeFileSync(path.join(output,'authoring-checkpoint.json'),JSON.stringify({schemaVersion:1,batch:'existing-local-plus-fixed-vitals-growth-local-supplements-v4',summary,cases:caseAudit},null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify(summary));
