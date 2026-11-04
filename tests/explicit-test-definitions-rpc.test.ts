import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const SCHEMA = 'tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema';
const CASE_ID = 'teacher-异物吸入性窒息';
const VERSION = '7838e2aa1c4c53af';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const OTHER_SESSION = '44444444-4444-4444-8444-444444444444';
const CT_RESULT = 'CT：肺部（平扫+MPR）：右中间支气管内可见结节状高密度影，右肺中叶不张，双肺支气管血管束增多、紊乱，双肺可见沿支气管分布片状模糊影。';

async function actor(db: PGlite, userId: string) {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('fixture.actor', $1, false)`, [userId]);
  await db.exec('SET ROLE authenticated');
}

async function postgres(db: PGlite) {
  await db.exec('RESET ROLE');
  await db.query(`SELECT set_config('fixture.actor', '', false)`);
}

async function call(db: PGlite, name: string, params: unknown[]) {
  const placeholders = params.map((_, index) => `$${index + 1}`).join(',');
  const result = await db.query<{ value: unknown }>(`SELECT ${name}(${placeholders}) AS value`, params);
  return result.rows[0]?.value ?? null;
}

async function seed(db: PGlite, explicit: boolean) {
  await postgres(db);
  await db.exec('TRUNCATE training_sessions, case_snapshot_facts, case_snapshot_answers');
  const facts = { sections: { tests: explicit
    ? '1、血常规：白细胞计数6.9×10^9/L，中性粒细胞百分比57.2%，血红蛋白125g/L，血小板计数306×10^9/L。'
    : '1、血常规：白细胞计数6.9×10^9/L。\n2、血气分析：pH 7.38。' } };
  const bindingConfig = explicit ? {
    testDefinitions: [
      { testId: 'source-test-7', label: '血常规', aliases: ['血常规五分类'], result: '血常规：白细胞计数6.9×10^9/L。' },
      { testId: 'source-test-12', label: 'CT：肺部（平扫+MPR）', aliases: ['胸部CT', '肺部CT'], result: CT_RESULT },
    ],
    testRelease: [],
    testMedia: [{ testId: 'source-test-12', media: [{ fileId: 'object-ct', kind: 'image', caption: '右中间支气管高密度影' }] }],
  } : { testDefinitions: [], testRelease: [], testMedia: [] };
  await db.query('INSERT INTO case_snapshot_facts(case_id,version,facts) VALUES($1,$2,$3::jsonb)', [CASE_ID, VERSION, JSON.stringify(facts)]);
  await db.query('INSERT INTO case_snapshot_answers(case_id,version,binding_config) VALUES($1,$2,$3::jsonb)', [CASE_ID, VERSION, JSON.stringify(bindingConfig)]);
  const ownerState = JSON.stringify({ caseId: CASE_ID, sourceSnapshotVersion: VERSION, stage: 'tests', orderedTests: [], events: [] });
  await db.query(`INSERT INTO training_sessions(id,user_id,status,state) VALUES
    ($1,$2,'in_progress',$3::jsonb),($4,$5,'in_progress',$6::jsonb)`, [SESSION, OWNER, ownerState, OTHER_SESSION, OTHER, ownerState]);
}

test('显式 testDefinitions 驱动目录、下单与单行结果，旧快照保留回退且权限不放宽', { timeout: 90_000 }, async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
      CREATE SCHEMA "${SCHEMA}"; SET search_path TO "${SCHEMA}";
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.actor',true),'')::uuid $$;
      CREATE FUNCTION app_is_teacher() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE TABLE training_sessions(id uuid PRIMARY KEY,user_id uuid,status text,state jsonb);
      CREATE TABLE case_snapshot_facts(case_id text,version text,facts jsonb);
      CREATE TABLE case_snapshot_answers(case_id text,version text,diagnosis text,plan text);
      ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE case_snapshot_facts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE case_snapshot_answers ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA "${SCHEMA}",auth TO authenticated,anon;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
      REVOKE ALL ON training_sessions,case_snapshot_facts,case_snapshot_answers FROM public,anon,authenticated;`);
    for (const name of [
      '20261016000000_case_tests_rpc_reaffirm.sql',
      '20261010130000_reference_teacher_only.sql',
      '20261026233836_case_snapshot_entry_source_keys.sql',
      '20261027114509_case_snapshot_private_binding_config.sql',
      '20261027124136_case_test_private_media_release.sql',
      '20261028033510_case_pet_ct_test_label.sql',
    ]) await db.exec(readFileSync(join(MIGRATIONS, name), 'utf8'));
    const latest = readFileSync(join(MIGRATIONS, '20261105010000_case_explicit_test_definitions.sql'), 'utf8');
    await db.exec(latest);
    const acl = async () => (await db.query(`SELECT proname,proacl::text FROM pg_proc
      WHERE oid IN ($1::regprocedure,$2::regprocedure,$3::regprocedure) ORDER BY proname`, [
      `"${SCHEMA}".case_snapshot_list_tests(text,text,uuid)`,
      `"${SCHEMA}".case_snapshot_get_test(text,text,uuid,text)`,
      `"${SCHEMA}".case_snapshot_record_test_order(text,text,uuid,text)`,
    ])).rows;
    const before = await acl();
    await db.exec(latest);
    assert.deepEqual(await acl(), before, '幂等重放不得改变函数 ACL');

    await seed(db, true);
    await actor(db, OWNER);
    const catalog = await call(db, 'case_snapshot_list_tests', [CASE_ID, VERSION, SESSION]);
    assert.deepEqual(catalog, [
      { id: 'source-test-7', label: '血常规', aliases: ['血常规五分类'] },
      { id: 'source-test-12', label: 'CT：肺部（平扫+MPR）', aliases: ['胸部CT', '肺部CT'] },
    ], '目录必须采用显式 ID，而非旧 sections.tests 的行号');
    assert.ok(!JSON.stringify(catalog).includes('右中间支气管'), '目录不得泄露检查原文');
    assert.equal(await call(db, 'case_snapshot_get_test', [CASE_ID, VERSION, SESSION, 'source-test-12']), null, '未下单不得取报告');
    assert.equal(await call(db, 'case_snapshot_record_test_order', [CASE_ID, VERSION, SESSION, 'source-test-13']), null, '未定义 ID 必须拒绝');
    assert.deepEqual(await call(db, 'case_snapshot_record_test_order', [CASE_ID, VERSION, SESSION, 'source-test-12']), ['source-test-12'], '非旧行号范围内的显式 ID 必须可下单');
    assert.deepEqual(await call(db, 'case_snapshot_record_test_order', [CASE_ID, VERSION, SESSION, 'source-test-12']), ['source-test-12'], '重复下单保持幂等');
    assert.deepEqual(await call(db, 'case_snapshot_get_test', [CASE_ID, VERSION, SESSION, 'source-test-12']), {
      id: 'source-test-12', label: 'CT：肺部（平扫+MPR）', result: CT_RESULT,
      media: [{ fileId: 'object-ct', kind: 'image', caption: '右中间支气管高密度影' }],
    }, '结果必须逐字来自显式契约并保留已审核媒体投影');
    assert.equal(await call(db, 'case_snapshot_list_tests', [CASE_ID, 'wrong-version', SESSION]), null);
    assert.equal(await call(db, 'case_snapshot_get_test', [CASE_ID, 'wrong-version', SESSION, 'source-test-12']), null);
    assert.equal(await call(db, 'case_snapshot_record_test_order', [CASE_ID, VERSION, SESSION, 'source-test-12; select 1']), null, '非法 ID 必须按校验拒绝');

    await actor(db, OTHER);
    assert.equal(await call(db, 'case_snapshot_get_test', [CASE_ID, VERSION, OTHER_SESSION, 'source-test-12']), null, '其他学生自己的会话不得读取未下单报告');
    assert.equal(await call(db, 'case_snapshot_get_test', [CASE_ID, VERSION, SESSION, 'source-test-12']), null, '跨学生会话必须拒绝');
    assert.equal(await call(db, 'case_snapshot_record_test_order', [CASE_ID, VERSION, SESSION, 'source-test-12']), null);

    await seed(db, false);
    await actor(db, OWNER);
    assert.deepEqual(await call(db, 'case_snapshot_list_tests', [CASE_ID, VERSION, SESSION]), [
      { id: 'source-test-0', label: '血常规' }, { id: 'source-test-1', label: '血气分析' },
    ], '无显式契约的旧版本必须保留白名单逐行回退');
    assert.deepEqual(await call(db, 'case_snapshot_record_test_order', [CASE_ID, VERSION, SESSION, 'source-test-1']), ['source-test-1']);
    assert.deepEqual(await call(db, 'case_snapshot_get_test', [CASE_ID, VERSION, SESSION, 'source-test-1']), {
      id: 'source-test-1', label: '血气分析', result: '2、血气分析：pH 7.38。',
    });
    await db.exec('SET ROLE anon');
    await assert.rejects(() => call(db, 'case_snapshot_get_test', [CASE_ID, VERSION, SESSION, 'source-test-1']), /permission denied/);
  } finally {
    await db.close();
  }
});
