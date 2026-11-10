/** 私有制作资料导出；不写数据库、不改活动绑定、不调用AI。 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {teachingPackageSchema} from '../../src/domain/teaching-package';
import {anatomyLabel,EXAM_INSTRUMENTS} from '../../src/domain/exam-anatomy';
import {ageMonths,detailedExamStandard,instrumentApplicability,EXAM_STANDARD_REFERENCES} from '../../src/domain/exam-authoring-standard';
import {hasAbnormalMarker} from '../../src/domain/exam-finding-composer';
import {teachingPackageVersion} from '../../src/lib/teaching-package-store';
import {CASE_CATALOG} from '../../src/domain/case-catalog';
import {normalizeCategory} from '../../src/domain/case-classification';
import {PEDIATRIC_SYSTEMS} from '../../src/domain/pediatric-system-map';
import {CASE_PUBLIC_IDS} from '../../src/lib/case-identity';

const [directory,target]=process.argv.slice(2);
if(!directory||!target||existsSync(target))throw Error('Usage: export-exam-authoring <verified-private-generation> <NEW-output>');
const upload=JSON.parse(readFileSync(path.join(directory,'peds-training-upload-manifest.json'),'utf8'));
const archive=upload.archives.find((a:{file:string})=>a.file===upload.contentArchive);
const bytes=readFileSync(path.join(directory,archive.file));
const sha=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
if(bytes.length!==archive.bytes||sha(bytes)!==archive.sha256)throw Error('INPUT_INTEGRITY_FAILED');
const files=unzipSync(bytes),manifest=JSON.parse(strFromU8(files['content-manifest.json']));
for(const entry of manifest.files.filter((f:{path:string})=>f.path.startsWith('runtime/packages/')||f.path.startsWith('source-cases/')||f.path==='runtime/index.json')){
 const data=files[entry.path];if(!data||data.length!==entry.bytes||sha(data)!==entry.sha256)throw Error('MANIFEST_INTEGRITY_FAILED');
}
const index=JSON.parse(strFromU8(files['runtime/index.json'])).entries;
const output=path.resolve(target);mkdirSync(output,{recursive:true});mkdirSync(path.join(output,'cases'));mkdirSync(path.join(output,'runtime-candidates'));
const csv=(rows:unknown[][])=>'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
const write=(file:string,value:unknown)=>writeFileSync(path.join(output,file),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
const summary:unknown[][]=[['caseId','title','sourceVersion','inputTeachingVersion','entries','reference','wholeRegion','notApplicable','conditional','candidateVersion']];
const flat:unknown[][]=[['caseId','entryId','tool','site','applicability','normalStandard','abnormalStandard','referenceParameters','caseOrigin','caseScope','caseResult','readyForLocalResult','sourceVersion','teachingVersion']];
const bundles:Array<{caseId:string;file:string;sha256:string;bytes:number;reference:number}>=[];
const standards=new Map<string,unknown>();let reference=0,wholeRegion=0,notApplicable=0,conditional=0,simulationsEnriched=0;
const orderedIndex:Array<{system:string;systemOrder:number;level:number;title:string;file:string;reference:number;wholeRegion:number}>=[];
for(const [caseId,version] of Object.entries(index)){
 const pack=teachingPackageSchema.parse(JSON.parse(strFromU8(files[`runtime/packages/${version}.json`])));
 if(pack.caseId!==caseId||pack.version!==version||teachingPackageVersion(pack)!==version)throw Error('PACKAGE_VERSION_FAILED');
 const candidate=structuredClone(pack),months=ageMonths(pack.age);
 const rows=pack.exams.map((exam,i)=>{
  const standard=detailedExamStandard(exam.toolId,exam.bodyPartId),applicability=instrumentApplicability(exam.toolId,exam.bodyPartId,months);
  const key=`${exam.toolId}:${exam.bodyPartId}`;standards.set(key,{toolId:exam.toolId,bodyPartId:exam.bodyPartId,...standard});
  const ready=(Boolean(exam.localSupplement)||exam.origin!=='reference'&&exam.scope==='local')&&applicability.status!=='not_applicable';
  // 已有模拟所见仅追加“操作”与“反应”展示字段，不按正常库覆盖既有医学事实。
  // source行及全部result逐字保留；标准作为制作资料，须经确定选值后再发布到runtime。
  if(exam.origin==='teaching-simulation'&&ready){
   candidate.exams[i].technique=standard.technique;candidate.exams[i].reaction=standard.reaction;simulationsEnriched++;
  }
  const item={
   id:exam.id,toolId:exam.toolId,toolLabel:EXAM_INSTRUMENTS.find(t=>t.id===exam.toolId)?.label??exam.toolId,
   bodyPartId:exam.bodyPartId,bodyPartLabel:anatomyLabel(exam.bodyPartId),applicability,
   standards:{...standard,patientData:false,reviewStatus:'automated-unreviewed',referenceNote:'正常/异常为制作参考，不是两种都下发的病例答案；训练仅释放已固定的本例结果。'},
   patient:{result:exam.result,origin:exam.origin,scope:exam.scope,sourceLocator:exam.sourceLocator,localSupplement:exam.localSupplement,
    recordedState:exam.origin==='reference'?'undetermined':hasAbnormalMarker(exam.result)?'contains-abnormal-findings':'not-classified',
    stateClassificationNote:'只标记原文阳性候选供复核；无关键词不代表正常，不能据此自动判病。',
    readyForLocalResult:ready,needsIndependentResult:exam.origin==='reference'||exam.scope!=='local'&&!exam.localSupplement},
   operation:{postures:candidate.exams[i].postures,allowedPositions:candidate.exams[i].allowedPositions,aspect:candidate.exams[i].aspect,technique:candidate.exams[i].technique,reaction:candidate.exams[i].reaction},
   evidenceCode:exam.evidenceCode,media:exam.media,
  };
  flat.push([caseId,exam.id,item.toolLabel,item.bodyPartLabel,applicability.status,standard.normal,standard.abnormal,standard.parameters,exam.origin,exam.scope,exam.result+(exam.localSupplement?'\n局部教学补充：'+exam.localSupplement.result:''),ready,pack.sourceVersion,pack.version]);
  return item;
 });
 const publicId=CASE_PUBLIC_IDS[caseId]??caseId,profile=CASE_CATALOG.find(item=>item.id===publicId);
 if(!profile)throw Error('PUBLIC_CATALOG_MAPPING_REQUIRED');
 const category=normalizeCategory(profile.category),systemOrder=PEDIATRIC_SYSTEMS.findIndex(item=>item.category===category);
 if(systemOrder<0)throw Error('SYSTEM_MAPPING_REQUIRED');
 const level=CASE_CATALOG.filter(item=>normalizeCategory(item.category)===category).findIndex(item=>item.id===publicId)+1;
 candidate.version=teachingPackageVersion(candidate);teachingPackageSchema.parse(candidate);
 // 原记录行不可因标准库、病例状态推断而改变。
 for(let i=0;i<pack.exams.length;i++)if(pack.exams[i].origin==='source'&&JSON.stringify(pack.exams[i])!==JSON.stringify(candidate.exams[i]))throw Error('SOURCE_CHANGED');
 for(let i=0;i<pack.exams.length;i++)if(pack.exams[i].result!==candidate.exams[i].result)throw Error('PATIENT_RESULT_CHANGED');
 const counts={reference:rows.filter(r=>r.patient.origin==='reference').length,wholeRegion:rows.filter(r=>r.patient.scope==='whole-region'&&!r.patient.localSupplement).length,notApplicable:rows.filter(r=>r.applicability.status==='not_applicable').length,conditional:rows.filter(r=>r.applicability.status==='conditional').length};
 reference+=counts.reference;wholeRegion+=counts.wholeRegion;notApplicable+=counts.notApplicable;conditional+=counts.conditional;
 const body={schemaVersion:1,kind:'private-exam-authoring',caseId,sourceId:pack.sourceId,sourceVersion:pack.sourceVersion,inputTeachingVersion:pack.version,
  title:pack.title,system:PEDIATRIC_SYSTEMS[systemOrder].label,level,age:pack.age,sex:pack.sex,relation:pack.relation,relationNote:pack.relationNote,
  reviewStatus:'automated-unreviewed',rows,counts,
  guards:['wrong-pair-no-release','conditional-readiness-before-result','repeat-silent','no-runtime-ai','no-normal-default-for-unknown','student-does-not-receive-standards'],
 };
 const relative=`cases/${caseId}.json`;write(relative,body);write(`runtime-candidates/${candidate.version}.json`,candidate);
 orderedIndex.push({system:PEDIATRIC_SYSTEMS[systemOrder].label,systemOrder,level,title:pack.title,file:relative,reference:counts.reference,wholeRegion:counts.wholeRegion});
 const actual=readFileSync(path.join(output,relative));bundles.push({caseId,file:relative,sha256:sha(actual),bytes:actual.length,reference:counts.reference});
 summary.push([caseId,pack.title,pack.sourceVersion,pack.version,rows.length,counts.reference,counts.wholeRegion,counts.notApplicable,counts.conditional,candidate.version]);
}
if(bundles.length!==67)throw Error('EXACT_67_REQUIRED');
write('index.json',{schemaVersion:1,inputGeneration:upload.generation,files:bundles});
orderedIndex.sort((a,b)=>a.systemOrder-b.systemOrder||a.level-b.level);
writeFileSync(path.join(output,'按系统与关卡顺序查找.csv'),csv([['系统','关卡','病例','JSON文件','仍缺独立结果','整体记录待定位'],...orderedIndex.map(item=>[item.system,item.level,item.title,item.file,item.reference,item.wholeRegion])]),{flag:'wx',mode:0o600});
write('standards.json',{schemaVersion:1,reviewStatus:'automated-unreviewed',references:EXAM_STANDARD_REFERENCES,standards:[...standards.values()]});
writeFileSync(path.join(output,'67例查体逐例清单.csv'),csv(flat),{flag:'wx',mode:0o600});
writeFileSync(path.join(output,'67例接入与缺口索引.csv'),csv(summary),{flag:'wx',mode:0o600});
const result={cases:bundles.length,rows:flat.length-1,uniqueToolSiteStandards:standards.size,reference,wholeRegion,notApplicable,conditional,simulationsEnriched,
 sourceRowsUnchanged:true,patientResultsUnchanged:true,hasRuntimeAI:false,databaseWrites:false,deployed:false,allPatientResultsCompleted:reference===0&&wholeRegion===0};
write('verification.json',result);console.log(JSON.stringify(result));
