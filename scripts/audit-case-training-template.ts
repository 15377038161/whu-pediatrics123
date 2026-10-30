import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { CASE_CATALOG,RETIRED_SIMULATION_PROFILES } from '../src/domain/case-catalog';
import { getKnowledgeRoot,getTeacherSourceId,recordSchema } from '../src/lib/teacher-case-data';
import { resolveCaseId,publicCaseId } from '../src/lib/case-identity';
import { computeCaseDataVersion } from '../src/lib/case-data-version';
import { getCase } from '../src/domain/case';
import { controlledCaseBundles } from '../src/lib/controlled-case-registry';
import { NOTE_TEMPLATE_VERSION,NOTE_TEMPLATE } from '../src/domain/medical-note';

/** Offline inventory: never imports, activates, calls a model, or prints patient text. */
const value=(flag:string)=>{const i=process.argv.indexOf(flag);return i<0?undefined:process.argv[i+1];};
async function main(){
 const selected=value('--case');const target=path.resolve(value('--out')??`output/case-template-audit-${Date.now()}.json`);
 if(!target.startsWith(path.resolve('output')+path.sep)||existsSync(target))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 const entries=CASE_CATALOG.filter(entry=>!selected||entry.id===publicCaseId(resolveCaseId(selected)));
 if(!entries.length)throw Error('CASE_NOT_FOUND');
 const rows=entries.map(entry=>{
  const id=resolveCaseId(entry.id),sourceId=getTeacherSourceId(id);const file=path.join(getKnowledgeRoot(),'teaching-cases',`${sourceId}.json`);
  const base={entryId:entry.id,sourceId,sharedSource:id!==sourceId,noteTemplateVersion:NOTE_TEMPLATE_VERSION,noteSections:NOTE_TEMPLATE.length,realAccountVerified:false,medicalAccepted:false};
  if(!existsSync(file))return {...base,status:'missing_source',offlinePassed:false};
  const parsed=recordSchema.safeParse(JSON.parse(readFileSync(file,'utf8')));
  if(!parsed.success||parsed.data.caseId!==sourceId)return {...base,status:'invalid_schema',offlinePassed:false};
  const record=parsed.data,version=computeCaseDataVersion(record),runtime=getCase(id,version);
  const testIds=new Set(runtime.tests.map(test=>test.id)),examIds=new Set(runtime.exams.map(exam=>exam.id));
  const invalidBindings=(record.testMedia??[]).filter(b=>!testIds.has(b.testId)).length+(record.examMedia??[]).filter(b=>!examIds.has(b.examId)).length;
  return {...base,version,status:invalidBindings?'invalid_binding':'schema_ready',offlinePassed:invalidBindings===0,examDefinitions:runtime.exams.filter(e=>e.evidenceCode!=='EX_PREP').length,explicitPostureRules:record.examRules?.length??0,testDefinitions:runtime.tests.length,mediaBindings:(record.testMedia??[]).length+(record.examMedia??[]).length,registeredBundle:controlledCaseBundles.some(b=>b.sourceId===sourceId&&b.version===version),liveImported:'not_checked',activeVersion:'not_checked'};
 });
 const report={schemaVersion:1,kind:'offline_template_inventory',activeEntries:CASE_CATALOG.length,retiredSimulationEntries:RETIRED_SIMULATION_PROFILES.length,selectedEntries:rows.length,offlinePassed:rows.filter(r=>r.offlinePassed).length,realFullFlowAccepted:0,rows};
 mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({activeEntries:report.activeEntries,retiredSimulationEntries:report.retiredSimulationEntries,selectedEntries:report.selectedEntries,offlinePassed:report.offlinePassed,realFullFlowAccepted:0,reportSaved:true}));
}
void main().catch(()=>{console.error('CASE_TEMPLATE_AUDIT_FAILED');process.exitCode=1;});
