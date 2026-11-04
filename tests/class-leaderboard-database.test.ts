import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

// 隔离 WASM PostgreSQL + 合成账号/JWT，验证真实迁移的授权、归属期间与计分过滤；不冒充真实教师会话。
const ids = {
  teacher: '00000000-0000-4000-8000-000000000001',
  studentA: '00000000-0000-4000-8000-000000000002',
  studentB: '00000000-0000-4000-8000-000000000003',
  studentC: '00000000-0000-4000-8000-000000000004',
};
let db: PGlite;
const migration = (name: string) => readFile(path.resolve('supabase/migrations', name), 'utf8');

async function asUser<T>(userId: string, run: () => Promise<T>): Promise<T> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [
    userId,
    JSON.stringify({ sub: userId, role: 'authenticated', email: `${userId}@example.test` }),
  ]);
  await db.exec('set role authenticated');
  try { return await run(); } finally {
    await db.exec('reset role');
    await db.exec("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','',false)");
  }
}

async function seedUser(userId: string, name: string, role = 'student') {
  await db.query('insert into auth.users(id) values($1)', [userId]);
  await db.query("insert into profiles(id,display_name,app_role,account_kind) values($1,$2,$3,'real')", [userId, name, role]);
}

async function joinClass(userId: string, classId: string) {
  await asUser(userId, () => db.query('select class_initial_select($1,$2)', [classId, crypto.randomUUID()]));
}

async function seedReport(userId: string, classId: string, score: number, data: object) {
  const sessionId = crypto.randomUUID();
  await db.query(`insert into training_sessions(id,user_id,cohort_id,case_id,case_version,mode,stage,status,state,started_at,updated_at)
    values($1,$2,$3,'synthetic-case',1,'practice','report','completed','{}',now(),now())`, [sessionId, userId, classId]);
  await db.query(`insert into training_reports(id,session_id,user_id,case_id,mode,total_score,data,status,created_at)
    values($1,$2,$3,'synthetic-case','practice',$4,$5,'ready',now())`, [crypto.randomUUID(), sessionId, userId, score, JSON.stringify(data)]);
}

async function leaderboard(userId: string, classId: string) {
  return asUser(userId, async () => {
    const result = await db.query<{ class_leaderboard_scores: { members: unknown[]; scores: { userId: string; caseId: string; score: number }[] } }>(
      'select class_leaderboard_scores($1)', [classId],
    );
    return result.rows[0].class_leaderboard_scores;
  });
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
  const initial = (await migration('202608230001_pediatrics_agent.sql')).replace('create extension if not exists pgcrypto;', '');
  await db.exec(initial);
  await db.exec(`alter table profiles alter column app_role drop default;
    alter table profiles alter column app_role type text using app_role::text;
    alter table profiles alter column app_role set default 'student';
    alter table profiles add column account_kind text not null default 'real';
    create table teacher_emails(email text primary key,note text);
    alter table teacher_emails enable row level security;
    create function app_is_teacher() returns boolean language sql stable security definer as $$ select exists(select 1 from teacher_emails where email=auth.jwt()->>'email') $$;
    create table quiz_questions(id uuid primary key,case_id text,difficulty text);
    create table quiz_assignments(user_id uuid references profiles,question_id uuid references quiz_questions,is_correct boolean,assigned_at timestamptz default now(),answered_at timestamptz);
    alter table quiz_questions enable row level security;
    alter table quiz_assignments enable row level security;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    create policy legacy_global_teacher_profiles on profiles for select to authenticated using(app_is_teacher());
    create policy legacy_global_teacher_sessions on training_sessions for select to authenticated using(app_is_teacher());
    create policy legacy_global_teacher_reports on training_reports for select to authenticated using(app_is_teacher());`);
  for (const file of [
    '20261011100000_session_engagement_events.sql',
    '20261015161000_profile_identity_server_role.sql',
    '20261019023824_classroom_management.sql',
    '20261021000000_class_self_onboarding.sql',
    '20261105000000_class_leaderboard.sql',
  ]) await db.exec(await migration(file));
  await db.query('insert into teacher_emails(email) values($1)', [`${ids.teacher}@example.test`]);
  await seedUser(ids.teacher, '教师', 'teacher');
  await seedUser(ids.studentA, '甲');
  await seedUser(ids.studentB, '乙');
  await seedUser(ids.studentC, '丙');
  await db.exec(`insert into cases(id,title,subtitle,status,current_version) values('synthetic-case','合成病例','仅用于隔离数据库测试','published',1);
    insert into case_versions(case_id,version,configuration,checksum) values('synthetic-case',1,'{}','synthetic');`);
}, { timeout: 90000 });

after(async () => { if (db) await db.close(); });

test('真实 SQL：有效成绩取同病例最高，未评分及历史全不可评估证据排除，无成绩学生保留', { timeout: 90000 }, async () => {
  const teacherA = await asUser(ids.teacher, () => db.query<{ id: string }>('select class_create($1) as id', ['积分榜甲班']));
  const classA = teacherA.rows[0].id;
  const teacherB = await asUser(ids.teacher, () => db.query<{ id: string }>('select class_create($1) as id', ['积分榜乙班']));
  const classB = teacherB.rows[0].id;
  await joinClass(ids.studentA, classA);
  await joinClass(ids.studentC, classA);
  await joinClass(ids.studentB, classB);

  await seedReport(ids.studentA, classA, 80, { evidence: [{ maxScore: 25, status: 'present' }] });
  await seedReport(ids.studentA, classA, 90, { evidence: [{ maxScore: 25, status: 'present' }] });
  await seedReport(ids.studentA, classA, 100, { unscored: true });
  await seedReport(ids.studentA, classA, 100, { evidence: [
    { maxScore: 25, status: 'not_assessable' },
    { maxScore: 10, status: 'not_applicable' },
  ] });
  // 旧报告无 unscored 且无 status，只要有评分项就不能误判为未评分。
  await seedReport(ids.studentB, classB, 65, { evidence: [{ maxScore: 25 }] });

  const a = await leaderboard(ids.studentA, classA);
  assert.equal(a.members.length, 2, '无成绩的丙仍应出现');
  assert.deepEqual(a.scores, [{ userId: ids.studentA, caseId: 'synthetic-case', score: 90 }]);
  const teacherView = await leaderboard(ids.teacher, classA);
  assert.deepEqual(teacherView, a, '任课教师与本班学生读取同一口径');
  const b = await leaderboard(ids.studentB, classB);
  assert.deepEqual(b.scores, [{ userId: ids.studentB, caseId: 'synthetic-case', score: 65 }]);
  await assert.rejects(() => leaderboard(ids.studentA, classB), /FORBIDDEN/, '学生不能读取非当前班级');

  const audit = await db.query<{ relname: string }>("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");
  assert.deepEqual(audit.rows, [], '不得引入关闭 RLS 的业务表');
  const privileges = await db.query<{ authenticated: boolean; anon: boolean }>(`select
    has_function_privilege('authenticated','class_leaderboard_scores(uuid)','execute') as authenticated,
    has_function_privilege('anon','class_leaderboard_scores(uuid)','execute') as anon`);
  assert.deepEqual(privileges.rows[0], { authenticated: true, anon: false });
});
