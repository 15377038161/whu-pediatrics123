import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

/** Operator-only CLI. Credentials stay in a restricted temporary file, never arguments or logs. */
async function main() {
  const credIndex=process.argv.indexOf('--cred-file');
  const bundleIndex=process.argv.indexOf('--bundle');
  if(credIndex<0 || bundleIndex<0)throw new Error('PILOT_INPUT_REQUIRED');
  const config=JSON.parse(readFileSync(process.argv[credIndex+1],'utf8'));
  const root=path.resolve(process.argv[bundleIndex+1]);
  if(!root.startsWith(path.resolve('output')+path.sep))throw new Error('PILOT_PRIVATE_BUNDLE_REQUIRED');
  process.env.CODER_SUPABASE_URL=config.url;
  process.env.CODER_SUPABASE_ANON_KEY=config.anonKey;
  process.env.CODER_SUPABASE_TENANT_ID=config.tenantId;
  process.env.PEDIATRICS_KNOWLEDGE_ROOT=path.join(root,'knowledge');
  const db=createClient(config.url,config.anonKey,{global:{headers:{'X-Instance-ID':config.tenantId,Authorization:`Bearer ${config.accessToken}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const user=await db.auth.getUser(config.accessToken);if(user.error || !user.data.user)throw new Error('AUTH_REQUIRED');
  const teacher=await db.rpc('app_is_teacher');if(teacher.error || teacher.data!==true)throw new Error('TEACHER_REQUIRED');
  const {decodeControlledCaseBundle}=await import('../src/lib/controlled-case-bundle');
  const definition=JSON.parse(readFileSync(path.join(root,'pilot-definition.json'),'utf8'));
  const manifest=JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));
  const receipt=JSON.parse(readFileSync(path.join(root,'receipt.json'),'utf8'));
  const expected={sourceId:definition.sourceId as string,version:manifest.contentVersion as string,sha256:receipt.sha256 as string};
  const {TEACHER_CASE_CATALOG}=await import('../src/domain/teacher-case-catalog');
  const {getTeacherSourceId}=await import('../src/lib/teacher-case-data');
  if(!TEACHER_CASE_CATALOG.some(item=>item.id===expected.sourceId&&item.folder)||getTeacherSourceId(expected.sourceId)!==expected.sourceId)throw new Error('CONTROLLED_SOURCE_REQUIRED');
  const record=decodeControlledCaseBundle(readFileSync(path.join(root,'pilot-case.zip')),expected);
  const {importTeacherCases,buildFactsPayloadForInit,buildBindingConfigForInit}=await import('../src/lib/teacher-case-import');
  const summary=await importTeacherCases(config.accessToken,{only:[expected.sourceId]});
  if(summary.total!==1 || summary.failed || summary.skipped)throw new Error('PILOT_IMPORT_FAILED');
  const facts=await db.from('case_snapshot_facts').select('facts').eq('case_id',expected.sourceId).eq('version',expected.version).single();
  const answers=await db.from('case_snapshot_answers').select('diagnosis,plan,documents,binding_config').eq('case_id',expected.sourceId).eq('version',expected.version).single();
  if(facts.error || answers.error)throw new Error('PILOT_READBACK_FAILED');
  assert.deepEqual(facts.data.facts,buildFactsPayloadForInit(record));
  assert.deepEqual(answers.data.documents,record.documents);
  assert.equal(answers.data.diagnosis,record.sections.diagnosis);assert.equal(answers.data.plan,record.sections.plan);
  assert.deepEqual(answers.data.binding_config,buildBindingConfigForInit(record));
  const importReceipt={version:expected.version,imported:summary.imported,unchanged:summary.unchanged,pairedReadback:true,documents:record.documents.length,mediaBindings:record.testMedia?.length??0,activationChanged:false};
  writeFileSync(path.join(root,'live-import-receipt.json'),JSON.stringify(importReceipt,null,2),{mode:0o600});console.log(JSON.stringify(importReceipt));
}
void main().catch(()=>{console.error('PILOT_IMPORT_OR_READBACK_FAILED');process.exitCode=1;});
