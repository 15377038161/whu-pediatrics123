import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';
import { decodeCaseTestResult } from '@/lib/case-snapshot';

const schema='tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema';
const owner='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const sid='00000000-0000-4000-8000-000000000003';

test('检查结果解码：待回报不带结果/媒体，已释放只认同一检查的图片元数据',()=>{
  const media=[{fileId:'synthetic-file',kind:'image',caption:'synthetic',url:'do-not-retain'}];
  assert.deepEqual(decodeCaseTestResult({id:'source-test-0',pending:true,result:'hidden',media},'source-test-0'),
    {id:'source-test-0',label:'',result:'',pending:true,resultDelayNote:'标本已送检，结果待回报。'});
  assert.equal(decodeCaseTestResult({id:'source-test-1',result:'other'},'source-test-0'),null);
  assert.deepEqual(decodeCaseTestResult({id:'source-test-0',result:'synthetic',media},'source-test-0')?.media,
    [{fileId:'synthetic-file',kind:'image',caption:'synthetic'}]);
});

test('隔离Postgres：已下单+绑定版本+阶段后只释放该项媒体，14关联不越过入口/归属', {timeout:90_000},async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.actor',true),'')::uuid $$;
      CREATE FUNCTION app_is_teacher() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE TABLE training_sessions(id uuid PRIMARY KEY,user_id uuid,status text,state jsonb);
      CREATE TABLE case_snapshot_facts(case_id text,version text,facts jsonb);
      CREATE TABLE case_snapshot_answers(case_id text,version text,diagnosis text,plan text);
      ALTER TABLE case_snapshot_answers ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA "${schema}",auth TO authenticated,anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;`);
    await db.exec(await readFile('supabase/migrations/20261016000000_case_tests_rpc_reaffirm.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/20261010130000_reference_teacher_only.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/20261026233836_case_snapshot_entry_source_keys.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/20261027114509_case_snapshot_private_binding_config.sql','utf8'));
    const acl=async()=> (await db.query('SELECT proacl::text FROM pg_proc WHERE oid=$1::regprocedure',[`"${schema}".case_snapshot_get_test(text,text,uuid,text)`])).rows;
    const before=await acl();
    const migration=await readFile('supabase/migrations/20261027124136_case_test_private_media_release.sql','utf8');
    await db.exec(migration);await db.exec(migration);assert.deepEqual(await acl(),before);
    const call=async(entry:string,version='v1',id='source-test-0')=>decodeCaseTestResult(
      (await db.query<{value:unknown}>('SELECT case_snapshot_get_test($1,$2,$3,$4) value',[entry,version,sid,id])).rows[0].value,id);
    for(const [entry,link] of Object.entries(TEACHER_CASE_LINKS)) {
      await db.exec('RESET ROLE; TRUNCATE training_sessions,case_snapshot_facts,case_snapshot_answers');
      await db.query('INSERT INTO training_sessions VALUES($1,$2,$3,$4::jsonb)',[sid,owner,'active',JSON.stringify({caseId:entry,sourceSnapshotVersion:'v1',stage:'history',orderedTests:[],events:[]})]);
      await db.query('INSERT INTO case_snapshot_facts VALUES($1,$2,$3::jsonb)',[link.sourceId,'v1',JSON.stringify({sections:{history:'synthetic',exam:'synthetic',tests:'血常规：synthetic A\n胸片：synthetic B'}})]);
      const config={testRelease:[{testId:'source-test-0',availableFromStage:'assessment',resultDelayNote:'synthetic delayed'}],testMedia:[
        {testId:'source-test-0',media:[{fileId:'synthetic-a',kind:'image',caption:'synthetic A',url:'must-not-return'}]},
        {testId:'source-test-1',media:[{fileId:'synthetic-b',kind:'image',caption:'synthetic B'}]}]};
      await db.query('INSERT INTO case_snapshot_answers(case_id,version,binding_config) VALUES($1,$2,$3::jsonb)',[link.sourceId,'v1',JSON.stringify(config)]);
      await db.query("SELECT set_config('fixture.actor',$1,false)",[owner]);await db.exec('SET ROLE authenticated');
      assert.equal(await call(entry),null,'未下单不能探测结果或媒体');
      await db.query('SELECT case_snapshot_record_test_order($1,$2,$3,$4)',[entry,'v1',sid,'source-test-0']);
      const pending=await call(entry);assert.equal(pending?.pending,true);assert.equal(pending?.result,'');assert.equal(pending?.media,undefined);
      assert.equal(await call(entry,'v2'),null);assert.equal(await call(link.sourceId),null,'来源键不能冒充入口键');
      await db.query("SELECT set_config('fixture.actor',$1,false)",[other]);assert.equal(await call(entry),null);
      await db.exec('RESET ROLE');await db.query("UPDATE training_sessions SET state=jsonb_set(state,'{stage}','\"assessment\"') WHERE id=$1",[sid]);
      await db.query("SELECT set_config('fixture.actor',$1,false)",[owner]);await db.exec('SET ROLE authenticated');
      const released=await call(entry);assert.equal(released?.result,'血常规：synthetic A');assert.deepEqual(released?.media,[{fileId:'synthetic-a',kind:'image',caption:'synthetic A'}]);
      const facts=(await db.query<{value:Record<string,unknown>}>('SELECT case_snapshot_get_facts($1,$2,$3) value',[entry,'v1',sid])).rows[0].value;
      assert.ok(!('binding_config' in facts)&&!('testMedia' in facts),'一般事实投影不带私有媒体');
      assert.equal(await call(entry,'v1','source-test-1'),null,'未下单的其他检查不泄露');
      assert.deepEqual((await call(entry))?.media,released?.media,'同绑定重进仍取同一媒体');
    }
    await db.exec('SET ROLE anon');await assert.rejects(()=>call('synthetic'),/permission denied/);
  } finally {await db.close();}
});
