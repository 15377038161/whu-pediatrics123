/** Private source-version-bound teaching notes. Never write originals into public/ or Git. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {readTeacherCaseData,getTeacherSourceId} from '@/lib/teacher-case-data';import {computeCaseDataVersion} from '@/lib/case-data-version';
const [ledgerPath,outputPath]=process.argv.slice(2);if(!ledgerPath||!outputPath)throw Error('ARGUMENTS_REQUIRED');
const output=path.resolve(outputPath),allowed=path.resolve('output')+path.sep;if(!output.startsWith(allowed))throw Error('PRIVATE_OUTPUT_REQUIRED');
const ledger=JSON.parse(readFileSync(ledgerPath,'utf8')) as {cases:Array<{seq:number;caseId:string}>};const rows=[];
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
for(const item of ledger.cases){const record=readTeacherCaseData(item.caseId);if(!record)throw Error(`SOURCE_UNAVAILABLE_SEQ_${item.seq}`);
 const version=computeCaseDataVersion(record);const note={entryId:item.caseId,sourceId:getTeacherSourceId(item.caseId),sourceVersion:version,noteTemplateVersion:3,origin:record.teachingSimulation?'ai_teaching_simulation':'teacher_materials',notPhysicianSignedRecord:true,
 demographics:{age:record.age,sex:record.sex},chiefComplaint:record.complaint,vitalSigns:{temperatureC:record.vitals.temperature,heartRatePerMinute:record.vitals.heartRate,respiratoryRatePerMinute:record.vitals.respiratoryRate,spo2Percent:record.vitals.spo2},history:record.sections.history,examination:record.sections.exam,investigations:record.sections.tests,diagnosticDiscussion:record.sections.diagnosis,managementAndCommunication:record.sections.plan,
 mediaBindings:{tests:record.testMedia??[],examinations:record.examMedia??[],testRelease:record.testRelease??[]},
 sourceDocuments:record.documents.map(d=>({sha256:d.sha256})),sourceDescription:record.sourceDocument,clinicalReview:'not_inferred_from_generation',studentAccess:'not_exposed',templateStatus:'teaching-facts-draft; writing-module template to confirm'};
 const text=JSON.stringify(note,null,2)+'\n';const dir=path.join(output,`seq${String(item.seq).padStart(3,'0')}`);mkdirSync(dir,{recursive:true});const file=path.join(dir,`${version}.note-v3.json`);
 if(existsSync(file)&&readFileSync(file,'utf8')!==text)throw Error('IMMUTABLE_NOTE_CONFLICT');if(!existsSync(file))writeFileSync(file,text,{mode:0o600});
 rows.push({seq:item.seq,sourceVersion:version,noteTemplateVersion:3,origin:note.origin,noteSha256:hash(text),privateRelativePath:path.relative(output,file),medicalAccepted:false,realFullFlowAccepted:false});
}
writeFileSync(path.join(output,'manifest.json'),JSON.stringify({entries:rows.length,studentRouteAdded:false,rows},null,2));console.log(JSON.stringify({privateTeachingNotes:rows.length,simulations:rows.filter(r=>r.origin==='ai_teaching_simulation').length,studentRouteAdded:false,medicalAccepted:0}));
