import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { buildFactsPayloadForInit, buildBindingConfigForInit, importTeacherCases, computeImportVersion } from '@/lib/teacher-case-import';
import { recordSchema } from '@/lib/teacher-case-data';

const schema = 'tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema';
const fixture = () => recordSchema.parse({caseId:'synthetic',sourceName:'synthetic',sourceDocument:'synthetic',age:'1月',sex:'女',complaint:'synthetic',
  sections:{history:'synthetic',exam:'synthetic',tests:'synthetic',diagnosis:'synthetic',plan:'synthetic'},
  vitals:{temperature:null,heartRate:null,respiratoryRate:null,spo2:null},documents:[],
  testMedia:[{testId:'source-test-0',media:[{fileId:'synthetic-test-image',kind:'image',caption:'synthetic'}]}],
  examMedia:[{examId:'source-exam-example',media:[{fileId:'synthetic-exam-image',kind:'image',caption:'synthetic'}]}],
  testRelease:[{testId:'source-test-0',availableFromStage:'assessment',resultDelayNote:'synthetic delay'}]});

test('媒体/释放配置仅写私有载荷，普通facts不新增媒体或释放信息', () => {
  const record=fixture();const facts=buildFactsPayloadForInit(record);const config=buildBindingConfigForInit(record)!;
  for(const field of ['testMedia','examMedia','testRelease']) assert.ok(!(field in facts));
  assert.deepEqual(config.testMedia,record.testMedia);assert.deepEqual(config.examMedia,record.examMedia);assert.deepEqual(config.testRelease,record.testRelease);
  assert.equal(buildBindingConfigForInit({}),null,'无配置的既有病例不要求新列，不改旧内容指纹');
});

test('导入调用链（合成HTTP上游）：迁移缺失先拒绝；历史缺配置不伪记unchanged；新版本配置写私有表', async () => {
  const prefix=path.join(os.tmpdir(),'peds-binding-import-');const root=mkdtempSync(prefix);
  const envNames=['CODER_SUPABASE_URL','COZE_SUPABASE_URL','CODER_SUPABASE_ANON_KEY','COZE_SUPABASE_ANON_KEY','CODER_SUPABASE_TENANT_ID','COZE_SUPABASE_TENANT_ID','PEDIATRICS_KNOWLEDGE_ROOT'];
  const previous=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));const originalFetch=globalThis.fetch;
  let scenario='missing-migration';const writes:Array<{table:string;payload:Record<string,unknown>}> = [];
  try {
    for(const name of envNames) delete process.env[name];
    process.env.COZE_SUPABASE_URL='https://synthetic-binding.invalid';process.env.COZE_SUPABASE_ANON_KEY='synthetic-public-key';process.env.PEDIATRICS_KNOWLEDGE_ROOT=root;
    const record={...fixture(),caseId:'teacher-肾病综合征'};const version=computeImportVersion(record);
    mkdirSync(path.join(root,'teaching-cases'));writeFileSync(path.join(root,'teaching-cases',record.caseId+'.json'),JSON.stringify(record));
    globalThis.fetch=async(input,init)=>{
      const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
      assert.equal(url.hostname,'synthetic-binding.invalid','所有请求仅被本地合成上游拦截，不允许网络回退');
      const table=url.pathname.split('/').at(-1)!;const method=init?.method ?? 'GET';
      if(method==='POST') {writes.push({table,payload:JSON.parse(init?.body as string)});return new Response(null,{status:201});}
      if(table==='case_snapshot_answers'&&scenario==='missing-migration') return Response.json({code:'42703',message:'synthetic missing column'},{status:400});
      if(table==='case_snapshot_answers') return Response.json(scenario==='existing-valid'?[{binding_config:JSON.parse(JSON.stringify(buildBindingConfigForInit(record)))}]:[]);
      return Response.json(scenario==='historical-missing'||scenario==='existing-valid'?[{version}]:[]);
    };
    const run=()=>importTeacherCases('synthetic-non-jwt-never-sent-to-network',{only:[record.caseId]});
    assert.equal((await run()).failed,1);assert.equal(writes.length,0,'缺迁移不能先写facts');
    scenario='historical-missing';const stale=await run();assert.equal(stale.failed,1);assert.equal(stale.unchanged,0);assert.equal(writes.length,0);
    scenario='fresh';assert.equal((await run()).imported,1);assert.equal(writes.length,2);
    assert.ok(!('binding_config' in writes[0].payload));assert.deepEqual(writes[1].payload.binding_config,buildBindingConfigForInit(record));
    scenario='existing-valid';assert.equal((await run()).unchanged,1);assert.equal(writes.length,2);
  } finally {
    globalThis.fetch=originalFetch;
    for(const name of envNames){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
    assert.ok(path.resolve(root).startsWith(path.resolve(prefix)));rmSync(root,{recursive:true,force:true});
  }
});

test('隔离Postgres：私有配置持久化、RLS拒绝学生、历史NULL保留、迁移可重放', {timeout:90_000}, async () => {
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
      CREATE TABLE case_snapshot_answers(case_id text,version text,diagnosis text);
      ALTER TABLE case_snapshot_answers ENABLE ROW LEVEL SECURITY;
      CREATE POLICY teacher_only ON case_snapshot_answers TO authenticated USING (current_setting('fixture.teacher',true)='true');
      GRANT USAGE ON SCHEMA "${schema}" TO authenticated; GRANT SELECT ON case_snapshot_answers TO authenticated;
      INSERT INTO case_snapshot_answers VALUES ('synthetic','old','synthetic');`);
    const migration=await readFile('supabase/migrations/20261027114509_case_snapshot_private_binding_config.sql','utf8');
    const before=(await db.query('SELECT relacl::text,relrowsecurity FROM pg_class WHERE oid=$1::regclass',[`"${schema}".case_snapshot_answers`])).rows;
    await db.exec(migration);await db.exec(migration);
    assert.equal((await db.query<{binding_config:unknown}>("SELECT binding_config FROM case_snapshot_answers WHERE version='old'")).rows[0].binding_config,null);
    const config=buildBindingConfigForInit(fixture());
    await db.query('INSERT INTO case_snapshot_answers(case_id,version,binding_config) VALUES($1,$2,$3::jsonb)',['synthetic','new',JSON.stringify(config)]);
    const fresh=(await db.query<{binding_config:unknown}>("SELECT binding_config FROM case_snapshot_answers WHERE version='new'")).rows[0].binding_config;
    const parsed=recordSchema.pick({testMedia:true,examMedia:true,testRelease:true}).parse(fresh);
    assert.deepEqual(buildBindingConfigForInit(parsed),config,'实际jsonb往返保留三组配置，键顺序不造成误冲突');
    const after=(await db.query('SELECT relacl::text,relrowsecurity FROM pg_class WHERE oid=$1::regclass',[`"${schema}".case_snapshot_answers`])).rows;
    assert.deepEqual(after,before,'既有表权限及RLS不变');
    await db.exec("SET ROLE authenticated; SELECT set_config('fixture.teacher','false',false)");
    assert.equal((await db.query('SELECT * FROM case_snapshot_answers')).rows.length,0);
    await db.exec("SELECT set_config('fixture.teacher','true',false)");
    assert.equal((await db.query('SELECT * FROM case_snapshot_answers')).rows.length,2);
    await db.exec('RESET ROLE; ALTER TABLE case_snapshot_answers DISABLE ROW LEVEL SECURITY');
    await assert.rejects(()=>db.exec(migration),/CASE_SNAPSHOT_ANSWERS_RLS_REQUIRED/);await db.exec('ROLLBACK');
    await db.exec('ALTER TABLE case_snapshot_answers ENABLE ROW LEVEL SECURITY; SET search_path TO pg_catalog');
    await assert.rejects(()=>db.exec(migration),/CASE_SNAPSHOT_TARGET_TENANT_MISMATCH/);await db.exec('ROLLBACK');
  } finally {await db.close();}
});
