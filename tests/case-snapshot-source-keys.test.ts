import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';

const schema = 'tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema';
const migrationPath = 'supabase/migrations/20261026233836_case_snapshot_entry_source_keys.sql';
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const session = '00000000-0000-4000-8000-000000000003';
const version = 'synthetic-version-1';
const names = ['case_snapshot_get_facts', 'case_snapshot_list_tests', 'case_snapshot_get_test',
  'case_snapshot_get_reference', 'case_snapshot_record_test_order'];

// Isolated PostgreSQL/WASM fixtures only. No network, accounts, JWT or live OAuth proof.
test('关联入口：保留入口归属/绑定版本，按固定来源恢复、下单、逐项读取与重进', { timeout: 90_000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
      CREATE FUNCTION app_is_teacher() RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT coalesce(current_setting('test.teacher',true),'false')::boolean $$;
      CREATE TABLE training_sessions(id uuid PRIMARY KEY,user_id uuid,status text,state jsonb);
      CREATE TABLE case_snapshot_facts(case_id text,version text,facts jsonb);
      CREATE TABLE case_snapshot_answers(case_id text,version text,diagnosis text,plan text);
      GRANT USAGE ON SCHEMA "${schema}",auth TO authenticated,anon;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;`);
    // Real historical migrations establish existing RPCs/ACL before the repair.
    await db.exec(await readFile('supabase/migrations/20261016000000_case_tests_rpc_reaffirm.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/20261010130000_reference_teacher_only.sql','utf8'));
    const call = async (fn: string, entry: string, v = version, testId = 'source-test-0') => {
      const hasTest = fn === 'case_snapshot_get_test' || fn === 'case_snapshot_record_test_order';
      return (await db.query<{value: unknown}>(`SELECT ${fn}($1,$2,$3::uuid${hasTest ? ',$4' : ''}) AS value`,
        hasTest ? [entry,v,session,testId] : [entry,v,session])).rows[0].value;
    };
    const seed = async (entry: string, source: string) => {
      await db.exec(`RESET ROLE; TRUNCATE training_sessions,case_snapshot_facts,case_snapshot_answers;`);
      await db.query('INSERT INTO training_sessions VALUES($1,$2,$3,$4::jsonb)',
        [session,owner,'active',JSON.stringify({caseId:entry,sourceSnapshotVersion:version,orderedTests:[],events:[]})]);
      await db.query('INSERT INTO case_snapshot_facts VALUES($1,$2,$3::jsonb)', [source,version,
        JSON.stringify({sections:{history:'synthetic history',exam:'synthetic exam',tests:'血常规：synthetic result A\n胸片：synthetic result B',diagnosis:'hidden',plan:'hidden'}})]);
      await db.query('INSERT INTO case_snapshot_answers VALUES($1,$2,$3,$4)',[source,version,'synthetic diagnosis','synthetic plan']);
      await db.query("SELECT set_config('test.actor',$1,false),set_config('test.teacher','false',false)",[owner]);
      await db.exec('SET ROLE authenticated');
    };
    const links = Object.entries(TEACHER_CASE_LINKS);
    assert.equal(links.length,14);
    await seed(links[0][0],links[0][1].sourceId);
    assert.equal(await call('case_snapshot_get_facts',links[0][0]),null,'before: entry key cannot find source facts');
    assert.equal(await call('case_snapshot_get_facts',links[0][1].sourceId),null,'before: source key fails strict entry guard');
    await db.exec('RESET ROLE');
    const beforeACL = (await db.query(`SELECT proname,proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=$1 AND p.proname=ANY($2::text[]) ORDER BY proname`,[schema,names])).rows;
    const migration = await readFile(migrationPath,'utf8');
    await db.exec(migration);
    await db.exec(migration); // Replay must be idempotent.
    const afterACL = (await db.query(`SELECT proname,proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=$1 AND p.proname=ANY($2::text[]) ORDER BY proname`,[schema,names])).rows;
    assert.deepEqual(afterACL,beforeACL,'no new execute grants');
    for (const [entry,link] of [...links,['teacher-canonical',{sourceId:'teacher-canonical'}] as const,
      ['teacher-unknown',{sourceId:'teacher-unknown'}] as const]) {
      await seed(entry,link.sourceId);
      const facts = await call('case_snapshot_get_facts',entry) as {sections:Record<string,string>};
      assert.equal(facts.sections.history,'synthetic history',entry);
      assert.equal(facts.sections.exam,undefined);
      assert.equal(facts.sections.tests,undefined);
      assert.equal(facts.sections.diagnosis,undefined);
      const catalog = await call('case_snapshot_list_tests',entry) as {id:string;label:string}[];
      assert.deepEqual(catalog,[{id:'source-test-0',label:'血常规'},{id:'source-test-1',label:'胸片'}]);
      assert.equal(await call('case_snapshot_get_test',entry),null,'no result before order');
      assert.equal(await call('case_snapshot_get_reference',entry),null,'students never gain teacher reference');
      assert.equal(await call('case_snapshot_record_test_order',entry,version,'source-test-999'),null);
      assert.deepEqual(await call('case_snapshot_record_test_order',entry),['source-test-0']);
      assert.deepEqual(await call('case_snapshot_record_test_order',entry),['source-test-0'],'idempotent order');
      assert.match((await call('case_snapshot_get_test',entry) as {result:string}).result,/synthetic result A/);
      assert.equal(await call('case_snapshot_get_test',entry,version,'source-test-1'),null,'one order cannot unlock all results');
      await db.exec('RESET ROLE; SET ROLE authenticated'); // Database read again, without application cache.
      assert.match((await call('case_snapshot_get_test',entry) as {result:string}).result,/synthetic result A/);
      await db.query("SELECT set_config('test.teacher','true',false)");
      assert.deepEqual(await call('case_snapshot_get_reference',entry),{diagnosis:'synthetic diagnosis',plan:'synthetic plan'});
      for (const fn of names) {
        assert.equal(await call(fn,entry,'wrong-version'),null,`${fn}: version`);
        assert.equal(await call(fn,entry+'-different'),null,`${fn}: entry`);
        if (entry!==link.sourceId) assert.equal(await call(fn,link.sourceId),null,`${fn}: cannot substitute canonical identity`);
      }
      await db.query("SELECT set_config('test.actor',$1,false)",[other]);
      for (const fn of names) assert.equal(await call(fn,entry),null,`${fn}: owner`);
      await db.query("SELECT set_config('test.actor','',false)");
      for (const fn of names) assert.equal(await call(fn,entry),null,`${fn}: no identity`);
      await db.exec('RESET ROLE');
      const state = (await db.query<{state:{caseId:string;sourceSnapshotVersion:string}}>('SELECT state FROM training_sessions')).rows[0].state;
      assert.equal(state.caseId,entry,'stored historical entry never rewritten');
      assert.equal(state.sourceSnapshotVersion,version);
      await db.query("UPDATE training_sessions SET status='completed',state=jsonb_set(state,'{events}',$1::jsonb)",[JSON.stringify([{type:'FINISH_SESSION'}])]);
      await db.query("SELECT set_config('test.actor',$1,false),set_config('test.teacher','false',false)",[owner]);
      await db.exec('SET ROLE authenticated');
      assert.equal(await call('case_snapshot_record_test_order',entry,version,'source-test-1'),null,'completed sessions cannot receive new orders');
      assert.equal(await call('case_snapshot_get_reference',entry),null,'completion cannot turn students into teachers');
    }
    await db.exec('SET ROLE anon');
    for (const fn of names) await assert.rejects(()=>call(fn,'teacher-canonical'),/permission denied/);
    await db.exec('RESET ROLE; SET search_path TO pg_catalog');
    await assert.rejects(()=>db.exec(migration),/CASE_SNAPSHOT_TARGET_TENANT_MISMATCH/);
    await db.exec('ROLLBACK');
  } finally { await db.close(); }
});
