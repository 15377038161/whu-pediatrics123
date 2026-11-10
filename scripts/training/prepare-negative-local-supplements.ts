/** 制作期：只对明确整体阴性、无局灶异常及相关全身风险的记录补固定局部教学所见。 */
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,readdirSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {teachingPackageSchema} from '../../src/domain/teaching-package';
import {teachingPackageVersion} from '../../src/lib/teaching-package-store';
import {isAffirmativelyNormal,isFocal,simulatedFinding} from '../../src/domain/exam-finding-composer';
import {sourceHasSystemicExamConcernForSite} from '../../src/domain/exam-source-context';
import {anatomyLabel} from '../../src/domain/exam-anatomy';
import {ageMonths,instrumentApplicability} from '../../src/domain/exam-authoring-standard';
const [base,authoring,target]=process.argv.slice(2);if(!base||!authoring||!target||existsSync(target))throw Error('NEW_OUTPUT_REQUIRED');
const manifest=JSON.parse(readFileSync(path.join(base,'peds-training-upload-manifest.json'),'utf8'));
const files=unzipSync(readFileSync(path.join(base,manifest.contentArchive)));
const index=JSON.parse(strFromU8(files['runtime/index.json'])).entries;
const authors=JSON.parse(readFileSync(path.join(authoring,'index.json'),'utf8'));
if(path.resolve(target).startsWith(path.resolve(authoring)+path.sep))throw Error('OUTPUT_INSIDE_INPUT_FORBIDDEN');
mkdirSync(target,{mode:0o700});copyFileSync(path.join(authoring,'index.json'),path.join(target,'index.json'));mkdirSync(path.join(target,'cases'),{mode:0o700});
for(const entry of readdirSync(path.join(authoring,'cases'),{withFileTypes:true})){if(!entry.isFile()||!entry.name.endsWith('.json'))throw Error('AUTHORING_FILE_INVALID');const file=path.join(target,'cases',entry.name);copyFileSync(path.join(authoring,'cases',entry.name),file);chmodSync(file,0o600);}
mkdirSync(path.join(target,'local-supplements'));
let supplements=0,cases=0;
for(const [caseId,version] of Object.entries(index)){
 const pack=teachingPackageSchema.parse(JSON.parse(strFromU8(files[`runtime/packages/${version}.json`])));
 const entry=authors.files.find((f:{caseId:string})=>f.caseId===caseId);
 const author=JSON.parse(readFileSync(path.join(authoring,entry.file),'utf8'));
 for(const exam of pack.exams){
  if(exam.origin==='source')continue;
  const row=author.rows.find((r:{id:string})=>r.id===exam.id);
  if(exam.origin==='reference'&&row.patient.origin==='reference')exam.result=row.patient.result;
  exam.scope=row.patient.scope;exam.sourceLocator=row.patient.sourceLocator;
  exam.postures=row.operation.postures;exam.technique=row.operation.technique;exam.reaction=row.operation.reaction;
  if(row.operation.allowedPositions)exam.allowedPositions=row.operation.allowedPositions;else delete exam.allowedPositions;
  if(row.operation.aspect)exam.aspect=row.operation.aspect;else delete exam.aspect;
 }
 pack.version=teachingPackageVersion(pack);
 const known=[pack.title,...pack.historyFacts.filter(f=>f.origin==='source').map(f=>f.text),...pack.exams.filter(e=>e.origin==='source').map(e=>e.result)].join('\n');
 const selections=[];
 for(const exam of pack.exams){
  if(exam.origin!=='source'||exam.scope!=='whole-region'||exam.localSupplement)continue;
  const snippet=exam.result.split('。原文')[0];
  if(!isAffirmativelyNormal(snippet)||isFocal(snippet))continue;
  if(sourceHasSystemicExamConcernForSite(known,pack.title,exam.toolId,exam.bodyPartId))continue;
  if(instrumentApplicability(exam.toolId,exam.bodyPartId,ageMonths(pack.age)).status!=='applicable')continue;
  const result=simulatedFinding(exam.toolId,exam.bodyPartId,anatomyLabel(exam.bodyPartId));if(!result)continue;
  selections.push({id:exam.id,state:'normal',origin:'teaching-simulation',result,rationale:'原记录为同方法的整体阴性所见，无局灶异常及相关全身风险；制作对应部位固定局部正常教学设定，整体原文和患者实测值保持原样。'});
 }
 if(selections.length){writeFileSync(path.join(target,entry.file.replace(/^cases\//,'local-supplements/')),JSON.stringify({caseId,sourceVersion:pack.sourceVersion,inputTeachingVersion:pack.version,selections},null,2),{flag:'wx',mode:0o600});cases++;supplements+=selections.length;}
}
console.log(JSON.stringify({cases,supplements,sourceRowsChanged:false,patientNumericValuesAdded:false,medicalReview:false}));
