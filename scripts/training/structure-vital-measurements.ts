/** Authoring-only migration: persist explicit values as structured fixed measurements. No runtime/model/DB calls. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cpSync,existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {anatomyLabel} from '../../src/domain/exam-anatomy';
import {extractVitalSigns} from '../../src/domain/vital-signs';
import {fixedVitalMeasurementSchema,VITAL_METRIC_UNITS,type VitalMetric} from '../../src/domain/vital-measurement';
import {teachingPackageSchema,type TeachingExam,type TeachingPackage} from '../../src/domain/teaching-package';
import {teachingPackageVersion} from '../../src/lib/teaching-package-store';

const baselineValue=process.env.PEDIATRICS_TRAINING_BASELINE_ROOT;
const outputValue=process.env.PEDIATRICS_TRAINING_OUTPUT_ROOT;
if(!baselineValue||!outputValue)throw new Error('Usage: PEDIATRICS_TRAINING_BASELINE_ROOT=<verified/runtime> PEDIATRICS_TRAINING_OUTPUT_ROOT=<new-staging/runtime> tsx scripts/training/structure-vital-measurements.ts');
const baseline=path.resolve(baselineValue),output=path.resolve(outputValue);
if(output===baseline||output.startsWith(`${baseline}${path.sep}`)||existsSync(output))throw new Error('OUTPUT_MUST_BE_NEW_AND_OUTSIDE_BASELINE');
const indexSchema=z.object({schemaVersion:z.literal(1),entries:z.record(z.string(),z.string().regex(/^[a-f0-9]{20}$/))}).strict();
const index=indexSchema.parse(JSON.parse(readFileSync(path.join(baseline,'index.json'),'utf8')));
const entries=Object.entries(index.entries);assert.equal(entries.length,67,'BASELINE_ENTRY_COUNT');
const thermometerTools=new Set(['thermometer','axillary-thermometer','infrared-thermometer','tympanic-thermometer']);

function methodFor(metric:VitalMetric,exam:TeachingExam):string{
  if(metric==='spo2')return '脉搏血氧仪，确认信号稳定';
  if(metric==='temperature')return ({'axillary-thermometer':'腋下电子体温计','infrared-thermometer':'额温枪','tympanic-thermometer':'耳温计','thermometer':'体温计'} as Record<string,string>)[exam.toolId]??exam.label;
  if(metric==='heartRate')return exam.toolId==='stethoscope'?'听诊计数心率':exam.label;
  return exam.toolId==='inspection'?'视诊计数呼吸频率':exam.toolId==='stethoscope'?'听诊计数呼吸频率':exam.label;
}

function measurementsFor(pack:TeachingPackage,exam:TeachingExam){
  if(exam.origin==='reference')return [];
  const extracted=extractVitalSigns(exam.result);
  return (Object.entries(extracted) as Array<[VitalMetric,number]>).map(([metric,value])=>{
    const intake=pack.intake?.initialVitals.find(item=>item.code===metric);
    const sameSourceValue=intake?.status==='recorded'&&intake.value===value;
    return fixedVitalMeasurementSchema.parse({
      metric,value,unit:VITAL_METRIC_UNITS[metric],method:methodFor(metric,exam),site:anatomyLabel(exam.bodyPartId),
      origin:exam.origin,sourceLocator:exam.sourceLocator,sourceTimepoint:exam.origin==='source'&&sameSourceValue?intake.timepoint:null,
    });
  });
}

const packages:TeachingPackage[]=[];
const results:Array<Record<string,unknown>>=[];
for(const [caseId,baselineVersion] of entries){
  const oldPackage=teachingPackageSchema.parse(JSON.parse(readFileSync(path.join(baseline,'packages',`${baselineVersion}.json`),'utf8')));
  assert.equal(oldPackage.caseId,caseId);assert.equal(teachingPackageVersion(oldPackage),baselineVersion,`BASELINE_VERSION:${caseId}`);
  const exams=oldPackage.exams.map(exam=>{
    const measurements=measurementsFor(oldPackage,exam);
    return measurements.length?{...exam,measurements}:exam;
  });
  const content=teachingPackageSchema.parse({...oldPackage,exams,version:'pending'});
  const nextVersion=teachingPackageVersion(content);assert.notEqual(nextVersion,baselineVersion,`VERSION_DID_NOT_CHANGE:${caseId}`);
  const nextPackage=teachingPackageSchema.parse({...content,version:nextVersion});assert.equal(teachingPackageVersion(nextPackage),nextVersion);
  for(const key of ['intake','historyFacts','questions','tests','management','referenceNote','references','rubric'] as const)assert.deepEqual(nextPackage[key],oldPackage[key],`UNRELATED_CONTENT_CHANGED:${caseId}:${key}`);
  const oximeter=nextPackage.exams.filter(item=>item.toolId==='oximeter');assert.equal(oximeter.length,1,`OXIMETER_RULE_COUNT:${caseId}`);
  const spo2=oximeter[0].measurements?.filter(item=>item.metric==='spo2')??[];assert.equal(spo2.length,1,`STRUCTURED_SPO2_REQUIRED:${caseId}`);
  const initialSpo2=oldPackage.intake?.initialVitals.find(item=>item.code==='spo2')?.value??null;
  if(initialSpo2!==null)assert.equal(spo2[0].origin,'source',`SOURCE_SPO2_REPLACED:${caseId}`);
  const unresolved=nextPackage.exams.filter(exam=>(exam.toolId==='oximeter'||thermometerTools.has(exam.toolId))&&!(exam.measurements?.length))
    .map(exam=>({examId:exam.id,toolId:exam.toolId,bodyPartId:exam.bodyPartId,origin:exam.origin,gap:'原记录与既有固定教学场景均无明确数值'}));
  const metricCounts=Object.fromEntries(['temperature','heartRate','respiratoryRate','spo2'].map(metric=>[metric,nextPackage.exams.flatMap(exam=>exam.measurements??[]).filter(item=>item.metric===metric).length]));
  packages.push(nextPackage);
  results.push({caseId,sourceId:oldPackage.sourceId,sourceVersion:oldPackage.sourceVersion,baselineTeachingVersion:baselineVersion,teachingVersion:nextVersion,initialSpo2,measurements:nextPackage.exams.flatMap(exam=>exam.measurements??[]),metricCounts,unresolvedMeasurementRules:unresolved,intakeUnchanged:true,rubricUnchanged:true});
}
assert.equal(results.filter(item=>item.initialSpo2!==null).length,23,'SOURCE_INTAKE_SPO2_COUNT');
assert.equal(results.reduce((sum,item)=>sum+(item.metricCounts as Record<string,number>).spo2,0),67,'TOTAL_STRUCTURED_SPO2');
assert.equal(new Set(packages.map(item=>item.version)).size,67,'PACKAGE_VERSIONS_UNIQUE');
mkdirSync(path.join(output,'packages'),{recursive:true});
const nextEntries:Record<string,string>={};
for(const pack of packages){nextEntries[pack.caseId]=pack.version;writeFileSync(path.join(output,'packages',`${pack.version}.json`),JSON.stringify(pack,null,2),{flag:'wx'});}
const nextIndex=JSON.stringify({schemaVersion:1,entries:nextEntries},null,2);
writeFileSync(path.join(output,'index.json'),nextIndex,{flag:'wx'});
cpSync(path.join(baseline,'media'),path.join(output,'media'),{recursive:true,force:false,errorOnExist:true});
const generation=createHash('sha256').update(nextIndex).digest('hex').slice(0,20);
const stagingRoot=path.dirname(output),generationRoot=path.join(path.dirname(stagingRoot),generation);
if(existsSync(generationRoot))throw new Error('GENERATION_ALREADY_EXISTS');
renameSync(stagingRoot,generationRoot);
const report={schemaVersion:1,generation,baselineGeneration:path.basename(path.dirname(baseline)),cases:67,sourceIntakeSpo2:23,structuredSpo2:67,databaseWrites:false,runtimeTextExtraction:false,results};
writeFileSync(path.join(generationRoot,'measurement-migration-report.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({generation,cases:67,structuredSpo2:67,totalMeasurements:results.reduce((sum,item)=>sum+(item.measurements as unknown[]).length,0),unresolvedRules:results.reduce((sum,item)=>sum+(item.unresolvedMeasurementRules as unknown[]).length,0),output:path.join(generationRoot,'runtime'),databaseWrites:false}));
