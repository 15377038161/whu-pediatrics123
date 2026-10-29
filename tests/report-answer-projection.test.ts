import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createInitialSession} from '@/lib/agent-engine';
import {buildReport} from '@/lib/scoring';
import {projectReportForRole,studentReportRecommendation} from '@/lib/report-projection';

function syntheticReport(){
 const report=buildReport(createInitialSession('synthetic-student','guided'));
 report.evidence.push(...['SOURCE_DIAGNOSIS_REFERENCE','SOURCE_PLAN_REFERENCE'].map(code=>({code,label:'合成标准答案',detail:'synthetic-private-answer',achieved:true,score:0,maxScore:0,eventIds:[]})));
 return report;
}

test('学生报告不含整段标准诊断/处置；教师、原始成绩、提交和历史对象保持',()=>{
 const report=syntheticReport(),before=structuredClone(report),student=projectReportForRole(report,'student');
 assert.ok(!JSON.stringify(student).includes('synthetic-private-answer'));
 assert.equal(student.recommendation,studentReportRecommendation);
 assert.deepEqual(student.evidence,report.evidence.filter(e=>!e.code.endsWith('_REFERENCE')));
 assert.equal(student.totalScore,report.totalScore);assert.deepEqual(student.abilities,report.abilities);assert.deepEqual(student.studentSubmissions,report.studentSubmissions);
 assert.deepEqual(report,before);assert.equal(projectReportForRole(report,'teacher'),report);
 assert.deepEqual(projectReportForRole(student,'student'),student);
});

test('隔离Postgres：直接RPC同样过滤历史答案，保留本人/匿名边界与原行/ACL', {timeout:90_000},async()=>{
 const schema='tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema';const q='"'+schema+'"';const db=new PGlite();
 const owner='10000000-0000-0000-0000-000000000001',other='10000000-0000-0000-0000-000000000002',id='20000000-0000-0000-0000-000000000001';
 try{
  await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE SCHEMA ${q};SET search_path TO ${q};
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.actor',true),'')::uuid $$;
   CREATE TABLE training_reports(id uuid,session_id uuid,user_id uuid,case_id text,mode text,total_score integer,status text,data jsonb,created_at timestamptz);
   CREATE FUNCTION report_get_mine(p_report_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT null::jsonb $$;
   CREATE FUNCTION report_list_mine() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT null::jsonb $$;
   REVOKE ALL ON FUNCTION report_get_mine(uuid),report_list_mine() FROM PUBLIC,anon;
   GRANT USAGE ON SCHEMA ${q},auth TO authenticated,anon;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
   GRANT EXECUTE ON FUNCTION report_get_mine(uuid),report_list_mine() TO authenticated;`);
  const acl=async()=> (await db.query(`SELECT proname,proacl::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname=$1 AND proname IN ('report_get_mine','report_list_mine') ORDER BY proname`,[schema])).rows;
  const before=await acl();await db.exec(await readFile('supabase/migrations/20261027181036_student_report_answer_projection.sql','utf8'));assert.deepEqual(await acl(),before);
  const report=syntheticReport();await db.query(`INSERT INTO ${q}.training_reports VALUES($1,$1,$2,'synthetic-case','guided',$3,'ready',$4::jsonb,now())`,[id,owner,report.totalScore,JSON.stringify(report)]);
  const get=async()=> (await db.query<{report:{data:typeof report}|null}>(`SELECT ${q}.report_get_mine($1) AS report`,[id])).rows[0].report;
  const list=async()=> (await db.query<{reports:Array<{data:typeof report}>|null}>(`SELECT ${q}.report_list_mine() AS reports`)).rows[0].reports;
  await db.query("SELECT set_config('fixture.actor',$1,false)",[owner]);await db.exec('SET ROLE authenticated');
  const one=await get();assert.deepEqual(one?.data,projectReportForRole(report,'student'));assert.deepEqual((await list())?.[0].data,one?.data);
  await assert.rejects(()=>db.query(`SELECT ${q}.report_student_projection('{}'::jsonb)`),/permission denied/);
  await db.query("SELECT set_config('fixture.actor',$1,false)",[other]);assert.equal(await get(),null);assert.deepEqual(await list(),[]);
  await db.query("SELECT set_config('fixture.actor','',false)");assert.equal(await get(),null);assert.equal(await list(),null);
  await db.exec('SET ROLE anon');await assert.rejects(get,/permission denied/);
  await db.exec('RESET ROLE');const raw=await db.query<{data:typeof report}>(`SELECT data FROM ${q}.training_reports WHERE id=$1`,[id]);assert.deepEqual(raw.rows[0].data,report);
 }finally{await db.close();}
});
