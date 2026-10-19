import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// 独立 WASM PostgreSQL，只使用合成账号，验证真实 SQL/RLS。不是平台登录验收。
for (const integerActive of [false, true]) test(`班级数据库（is_active=${integerActive ? 'integer' : 'boolean'}）：授权、可信匹配、审核、跨班隔离`, { timeout: 90_000 }, async () => {
  const db = new PGlite();
  const ids = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005'];
  const [admin, teacherA, teacherB, studentA, studentB] = ids;
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      grant usage on schema public,auth to authenticated,anon;
      grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
    const initial = (await readFile('supabase/migrations/202608230001_pediatrics_agent.sql','utf8')).replace('create extension if not exists pgcrypto;','');
    await db.exec(initial);
    if (integerActive) await db.exec(`alter table cohorts alter column is_active drop default; alter table cohorts alter column is_active type integer using case when is_active then 1 else 0 end; alter table cohorts alter column is_active set default 1;`);
    await db.exec(`alter table profiles add column account_kind text not null default 'real';
      create table teacher_emails(email text primary key,note text);
      create function app_is_teacher() returns boolean language sql stable security definer as $$ select exists(select 1 from teacher_emails where email=auth.jwt()->>'email') $$;
      create table quiz_questions(id uuid primary key,case_id text,difficulty text);
      create table quiz_assignments(user_id uuid references profiles,question_id uuid references quiz_questions,is_correct boolean,assigned_at timestamptz default now(),answered_at timestamptz);
      alter table quiz_assignments enable row level security;
      grant select,insert,update,delete on all tables in schema public to authenticated;
      create policy legacy_global_teacher_profiles on profiles for select to authenticated using(app_is_teacher());
      create policy legacy_global_teacher_sessions on training_sessions for select to authenticated using(app_is_teacher());
      create policy legacy_global_teacher_reports on training_reports for select to authenticated using(app_is_teacher());`);
    await db.exec(await readFile('supabase/migrations/20261011100000_session_engagement_events.sql','utf8'));
    await db.exec(await readFile('supabase/migrations/20261019023824_classroom_management.sql','utf8'));
    for (const [index,id] of ids.entries()) {
      await db.query('insert into auth.users values($1)',[id]);
      await db.query('insert into profiles(id,display_name,app_role) values($1,$2,$3)',[id,`合成账号${index}`,index<3?'teacher':'student']);
    }
    await db.query('insert into teacher_emails(email) values($1)', ['admin@example.test']);
    await db.query('insert into project_administrators(user_id) values($1)',[admin]);
    async function asUser(id: string, cxid: string, trusted = false) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({email:id===admin?'admin@example.test':`${cxid}@example.test`,user_metadata:{cxid,realname:`合成${cxid}`},app_metadata:trusted?{chaoxing:{uid:cxid,fid:'test',studentNo:`00${cxid}`}}:{}})]);
      await db.exec('set role authenticated');
      await db.query('select class_sync_identity()');
    }
    async function scalar<T>(sql: string,args: unknown[]=[]): Promise<T> { const r=await db.query<Record<string,T>>(sql,args); return Object.values(r.rows[0])[0]; }
    await asUser(teacherA,'200'); await asUser(teacherB,'300');
    await asUser(admin,'100');
    assert.equal(await scalar('select teacher_access_grant($1,$2,true)',[teacherA,'200']),true);
    assert.equal(await scalar('select teacher_access_grant($1,$2,true)',[teacherB,'300']),true);
    await asUser(teacherA,'200');
    await assert.rejects(()=>db.query('select teacher_access_grant($1,$2,true)',[studentA,'400']),/FORBIDDEN/);
    const classA = await scalar<string>("select class_create('合成班 A')");
    assert.equal(await scalar("select class_create('合成班 A')"),classA);
    await asUser(teacherB,'300'); const classB=await scalar<string>("select class_create('合成班 B')");
    await asUser(teacherA,'200');
    await assert.rejects(()=>db.query('select class_workspace($1)',[classB]),/FORBIDDEN/);
    await db.query('select class_import_roster($1,$2)',[classA,JSON.stringify([{name:'合成学生A',cxid:'400',studentNo:''}])]);
    await asUser(studentA,'400');
    assert.equal(await scalar('select count(*)::int from cohort_members where user_id=auth.uid()'),0,'可编辑 cxid 不自动入班');
    await assert.rejects(()=>db.query("insert into cohort_members(cohort_id,user_id,role) values($1,$2,'student')",[classA,studentA]),/permission denied/);
    const request=await scalar<string>('select class_request_join($1,$2)',[classA,'00400']);
    await asUser(teacherB,'300'); await assert.rejects(()=>db.query('select class_review_request($1,true)',[request]),/FORBIDDEN/);
    await asUser(teacherA,'200'); await db.query('select class_review_request($1,true)',[request]);
    assert.equal(await scalar('select app_can_view_student($1)',[studentA]),true);
    assert.equal(await scalar('select app_can_view_student($1)',[studentB]),false);
    await asUser(studentB,'500',true);
    await asUser(teacherB,'300');
    await db.query('select class_import_roster($1,$2)',[classB,JSON.stringify([{name:'合成学生B',cxid:'500',studentNo:''}])]);
    assert.equal(await scalar('select app_can_view_student($1)',[studentB]),true);
    await db.exec('reset role');
    for(const id of [studentA,studentB]) await db.query(`insert into training_sessions(id,user_id,cohort_id,case_id,case_version,mode,stage,status,state,started_at,updated_at)
      values(gen_random_uuid(),$1,'10000000-0000-4000-8000-000000000102','peds-respiratory-001',1,'practice','history','active','{}',now(),now())`,[id]);
    await asUser(teacherA,'200');
    assert.equal(await scalar('select count(*)::int from training_sessions'),1,'旧全局教师策略被 restrictive 策略收紧');
    for(const fn of ['teacher_stats_per_student','teacher_stats_overall','teacher_stats_daily_trend','teacher_stats_case_distribution','teacher_stats_weekly_trend']) {
      await db.query(`select ${fn}(null,null,null,null)`);
      await assert.rejects(()=>db.query(`select ${fn}(null,null,$1,null)`,[studentB]),/FORBIDDEN/);
    }
    const stats=await scalar<{sessionCount:number}>('select teacher_stats_overall(null,null,null,null)');
    assert.equal(stats.sessionCount,1);
    await assert.rejects(()=>db.query('select teacher_stats_recent_sessions($1,50)',[studentB]),/FORBIDDEN/);
    await assert.rejects(()=>db.query('select teacher_stats_weak_areas(null,null,$1,3)',[studentB]),/FORBIDDEN/);
    await asUser(studentA,'400');
    const workspace=await scalar<{members:unknown[];roster:unknown[]}>('select class_workspace($1)',[classA]);
    assert.deepEqual(workspace.members,[]); assert.deepEqual(workspace.roster,[]);
    await assert.rejects(()=>db.query("select teacher_access_workspace('200')"),/FORBIDDEN/);
    await asUser(admin,'100'); await db.query('select teacher_access_revoke($1,true)',[teacherA]);
    await asUser(teacherA,'200'); assert.equal(await scalar('select app_is_teacher()'),false);
    await assert.rejects(()=>db.query("select class_create('不应创建')"),/FORBIDDEN/);
  } finally { await db.close(); }
});
