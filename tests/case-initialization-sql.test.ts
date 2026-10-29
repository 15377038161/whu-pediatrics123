import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { buildCaseInitialization } from '../scripts/generate-case53-init-sql';
import { buildBindingConfigForInit, buildFactsPayloadForInit, computeImportVersion } from '../src/lib/teacher-case-import';
import { syntheticTeacherCase } from './fixtures/teacher-case';

const tenant='tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema';
const fixture=()=>syntheticTeacherCase({sourceName:"synthetic ' source",sections:{history:'合成'.repeat(995)+'🙂合成边界',exam:'合成查体',tests:'合成检查',diagnosis:'',plan:'$case_init_verify$ 合成处置'},
  testMedia:[{testId:'source-test-0',media:[{fileId:'synthetic-test-image',kind:'image',caption:'合成检查图'}]}],
  examMedia:[{examId:'source-exam-example',media:[{fileId:'synthetic-exam-image',kind:'image',caption:'合成查体图'}]}],
  testRelease:[{testId:'source-test-0',availableFromStage:'assessment',resultDelayNote:'合成延迟'}]});

async function baseline(db:PGlite,withBindings=true){
 await db.exec(`CREATE SCHEMA "${tenant}"; SET search_path TO "${tenant}";
 CREATE TABLE case_snapshot_facts(case_id text,version text,source_name text,facts jsonb,PRIMARY KEY(case_id,version));
 CREATE TABLE case_snapshot_answers(case_id text,version text,diagnosis text,plan text,documents jsonb,media jsonb${withBindings?',binding_config jsonb':''},PRIMARY KEY(case_id,version));
 ALTER TABLE case_snapshot_facts ENABLE ROW LEVEL SECURITY; ALTER TABLE case_snapshot_answers ENABLE ROW LEVEL SECURITY;`);
}

test('受控初始化保留私有绑定、原文特殊字符及旧版；同版本幂等回读，不改发布决定',async()=>{
 const db=new PGlite();try{await baseline(db);const r=fixture(),v=computeImportVersion(r);const built=await buildCaseInitialization(r);assert.equal(built.version,v);
  await db.exec("CREATE TABLE case_publication(case_id text,published boolean); INSERT INTO case_publication VALUES ('synthetic',false); INSERT INTO case_snapshot_answers VALUES ('synthetic','old','old',NULL,NULL,NULL,NULL)");
  await db.exec(built.sql);await db.exec(built.sql);
  const f=(await db.query<{facts:unknown}>('SELECT facts FROM case_snapshot_facts WHERE case_id=$1 AND version=$2',[r.caseId,v])).rows[0];
  assert.deepEqual(f.facts,buildFactsPayloadForInit(r));assert.ok(!('testMedia' in (f.facts as object)));
  const a=(await db.query<{diagnosis:string;plan:string;binding_config:unknown}>('SELECT diagnosis,plan,binding_config FROM case_snapshot_answers WHERE case_id=$1 AND version=$2',[r.caseId,v])).rows[0];
  assert.equal(a.diagnosis,'');assert.equal(a.plan,r.sections.plan);assert.deepEqual(a.binding_config,buildBindingConfigForInit(r));
  assert.equal((await db.query('SELECT * FROM case_snapshot_answers')).rows.length,2);assert.equal((await db.query<{published:boolean}>('SELECT published FROM case_publication')).rows[0].published,false);
 }finally{await db.close();}
});

test('错误租户、缺绑定迁移或已关闭RLS时，在事实写入前拒绝',async()=>{
 const sql=(await buildCaseInitialization(fixture())).sql;
 for(const reason of ['tenant','migration','rls'] as const){const db=new PGlite();try{
  await baseline(db,reason!=='migration');if(reason==='tenant')await db.exec('SET search_path TO public');if(reason==='rls')await db.exec('ALTER TABLE case_snapshot_answers DISABLE ROW LEVEL SECURITY');
  await assert.rejects(()=>db.exec(sql),new RegExp(reason==='tenant'?'CASE_INIT_TARGET_TENANT_MISMATCH':reason==='migration'?'CASE_INIT_PRIVATE_BINDING_MIGRATION_REQUIRED':'CASE_INIT_RLS_REQUIRED'));
  await db.exec(`ROLLBACK; SET search_path TO "${tenant}"`);assert.equal((await db.query('SELECT * FROM case_snapshot_facts')).rows.length,0);
 }finally{await db.close();}}
});

test('已有同版本缺绑定或事实被改变时，拒绝伪记成功且保留原数据',async()=>{
 const db=new PGlite();try{await baseline(db);const r=fixture(),built=await buildCaseInitialization(r);await db.exec(built.sql);
  await db.query('UPDATE case_snapshot_answers SET binding_config=NULL WHERE case_id=$1',[r.caseId]);
  await assert.rejects(()=>db.exec(built.sql),/CASE_INIT_EXISTING_CONTENT_MISMATCH/);await db.exec('ROLLBACK');
  assert.equal((await db.query<{binding_config:unknown}>('SELECT binding_config FROM case_snapshot_answers WHERE case_id=$1',[r.caseId])).rows[0].binding_config,null);
  await db.query('UPDATE case_snapshot_answers SET binding_config=$1::jsonb WHERE case_id=$2',[JSON.stringify(buildBindingConfigForInit(r)),r.caseId]);
  await db.query("UPDATE case_snapshot_facts SET facts='{}'::jsonb WHERE case_id=$1",[r.caseId]);
  await assert.rejects(()=>db.exec(built.sql),/CASE_INIT_EXISTING_CONTENT_MISMATCH/);await db.exec('ROLLBACK');
  assert.deepEqual((await db.query<{facts:unknown}>('SELECT facts FROM case_snapshot_facts WHERE case_id=$1',[r.caseId])).rows[0].facts,{});
 }finally{await db.close();}
});
