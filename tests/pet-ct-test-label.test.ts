import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const schema='tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema';
const owner='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const sid='00000000-0000-4000-8000-000000000003';
const migration='supabase/migrations/20261028033510_case_pet_ct_test_label.sql';

test('隔离Postgres：PET/CT目录与结果同名，保留已下单/本人/版本及ACL守卫',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
   CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.actor',true),'')::uuid $$;
   CREATE FUNCTION app_is_teacher() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
   CREATE TABLE training_sessions(id uuid PRIMARY KEY,user_id uuid,status text,state jsonb);
   CREATE TABLE case_snapshot_facts(case_id text,version text,facts jsonb);
   CREATE TABLE case_snapshot_answers(case_id text,version text,diagnosis text,plan text);
   ALTER TABLE case_snapshot_answers ENABLE ROW LEVEL SECURITY;
   GRANT USAGE ON SCHEMA "${schema}",auth TO authenticated,anon;
   GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;`);
  for(const name of ['20261016000000_case_tests_rpc_reaffirm','20261010130000_reference_teacher_only','20261026233836_case_snapshot_entry_source_keys','20261027114509_case_snapshot_private_binding_config','20261027124136_case_test_private_media_release']){
   await db.exec(await readFile(`supabase/migrations/${name}.sql`,'utf8'));
  }
  const acl=async()=> (await db.query('SELECT proname,proacl::text FROM pg_proc WHERE oid IN ($1::regprocedure,$2::regprocedure) ORDER BY proname',[
   `"${schema}".case_snapshot_list_tests(text,text,uuid)`,`"${schema}".case_snapshot_get_test(text,text,uuid,text)`])).rows;
  const before=await acl();
  const entry='teacher-i型糖尿病伴有酮症酸中毒',source='teacher-1型糖尿病伴有酮症酸中毒';
  await db.query('INSERT INTO training_sessions VALUES($1,$2,$3,$4::jsonb)',[sid,owner,'active',JSON.stringify({caseId:entry,sourceSnapshotVersion:'v1',stage:'tests',orderedTests:[],events:[]})]);
  await db.query('INSERT INTO case_snapshot_facts VALUES($1,$2,$3::jsonb)',[source,'v1',JSON.stringify({sections:{tests:'PET/CT：synthetic hidden result\nCT：synthetic control'}})]);
  const catalogue=async()=> (await db.query<{value:Array<{id:string;label:string}>}>('SELECT case_snapshot_list_tests($1,$2,$3) value',[entry,'v1',sid])).rows[0].value;
  const result=async(id='source-test-0',version='v1',caseId=entry)=> (await db.query<{value:unknown}>('SELECT case_snapshot_get_test($1,$2,$3,$4) value',[caseId,version,sid,id])).rows[0].value;
  await db.query("SELECT set_config('fixture.actor',$1,false)",[owner]);
  assert.equal((await catalogue())[0].label,'检查记录 1');
  const sql=await readFile(migration,'utf8');await db.exec(sql);await db.exec(sql);assert.deepEqual(await acl(),before);
  await db.exec('SET ROLE authenticated');
  assert.deepEqual(await catalogue(),[{id:'source-test-0',label:'PET/CT'},{id:'source-test-1',label:'CT'}]);
  assert.equal(await result(),null);
  await db.query('SELECT case_snapshot_record_test_order($1,$2,$3,$4)',[entry,'v1',sid,'source-test-0']);
  assert.deepEqual(await result(),{id:'source-test-0',label:'PET/CT',result:'PET/CT：synthetic hidden result'});
  assert.equal(await result('source-test-1'),null);assert.equal(await result('source-test-0','v2'),null);assert.equal(await result('source-test-0','v1',source),null);
  await db.query("SELECT set_config('fixture.actor',$1,false)",[other]);assert.equal(await result(),null);assert.equal(await catalogue(),null);
  await db.exec('SET ROLE anon');await assert.rejects(()=>result(),/permission denied/);
 }finally{await db.close();}
});

test('新迁移只扩展两RPC的项目名，其他业务SQL与已验基线一致',async()=>{
 const changed=await readFile(migration,'utf8');
 for(const [name,file] of [['case_snapshot_list_tests','20261026233836_case_snapshot_entry_source_keys'],['case_snapshot_get_test','20261027124136_case_test_private_media_release']]){
  const pattern=new RegExp('CREATE OR REPLACE FUNCTION '+name+'\\(.*?\\$function\\$;','s');
  const previous=(await readFile(`supabase/migrations/${file}.sql`,'utf8')).match(pattern)?.[0];
  const current=changed.match(pattern)?.[0];assert.ok(previous&&current);
  assert.equal(current.replace("'PET/CT','CT','核磁共振'","'CT','核磁共振'"),previous);
 }
 assert.ok(!/\b(?:GRANT|REVOKE|CREATE POLICY|ALTER TABLE)\b/i.test(changed.replace(/^--.*$/gm,'')));
});
