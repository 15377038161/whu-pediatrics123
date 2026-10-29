import './fixtures/legacy-engine-catalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {TEACHER_CASE_LINKS} from '@/domain/teacher-case-links';
import {createInitialSession} from '@/lib/agent-engine';
import {hydrateReleasedExamMedia,findReleasedMedia} from '@/lib/case-media';
import {buildReport} from '@/lib/scoring';
import {ReportView} from '@/components/report-view';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const schema='tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema';
const owner='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const sid='00000000-0000-4000-8000-000000000003';
const code='SOURCE_EX_stethoscope_chest';
const image={fileId:'synthetic-exam-image',kind:'image' as const,caption:'synthetic'};

test('报告冻结材料版本；旧报告无版本或事件ID时不猜图、不重算',()=>{
  const session=createInitialSession('synthetic','guided');session.sourceSnapshotVersion='synthetic-version';
  const report=buildReport(session);assert.equal(report.sourceSnapshotVersion,'synthetic-version');
  report.sourceSnapshotVersion=undefined;report.evidence[0].eventIds=['synthetic-event'];
  delete report.releasedMediaEventIds; // Legacy reports predate the explicit released-media snapshot.
  assert.ok(renderToStaticMarkup(createElement(ReportView,{report,readonly:true})).includes('历史报告未保存材料版本'));
  const oldScore=report.totalScore;
  for(const item of report.evidence)delete (item as Partial<typeof item>).eventIds;
  assert.doesNotThrow(()=>renderToStaticMarkup(createElement(ReportView,{report,readonly:true})));
  assert.equal(report.totalScore,oldScore);
});

test('复盘重建仅补已有正确查体事件，保留历史图片且不创建证据或操作',()=>{
  const session=createInitialSession('synthetic','guided');session.sourceSnapshotVersion='v1';session.unlockedEvidence=[code];
  session.events=[{id:'synthetic-event',clientEventId:'synthetic-event',type:'EXAM_ACTION',stage:'exam',correct:true,evidenceCodes:[code],summary:'synthetic',createdAt:'2026-10-27T00:00:00Z'}];
  const bindings=[{evidenceCode:code,media:[image]}];
  const rejected=structuredClone(session);rejected.events[0].correct=false;
  hydrateReleasedExamMedia(rejected,bindings);assert.equal(findReleasedMedia(rejected,image.fileId),null);
  const noEvidence=structuredClone(session);noEvidence.unlockedEvidence=[];
  hydrateReleasedExamMedia(noEvidence,bindings);assert.equal(noEvidence.events[0].media,undefined);
  hydrateReleasedExamMedia(session,bindings);assert.deepEqual(findReleasedMedia(session,image.fileId),image);
  const restored=JSON.parse(JSON.stringify(session));
  hydrateReleasedExamMedia(restored,[{evidenceCode:code,media:[{...image,fileId:'different-version-image'}]}]);
  assert.deepEqual(restored.events,session.events,'已经冻结在事件中的媒体不得因重建换图');
  assert.equal(session.events.length,1);assert.deepEqual(session.unlockedEvidence,[code]);
});

test('隔离Postgres：14入口只投影已有正确查体证据对应媒体，准备/错操作/错版本不放图', {timeout:90_000},async()=>{
  const db=new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;
      CREATE SCHEMA "${schema}";SET search_path TO "${schema}";
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.actor',true),'')::uuid $$;
      CREATE FUNCTION app_is_teacher() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE TABLE training_sessions(id uuid PRIMARY KEY,user_id uuid,status text,state jsonb);
      CREATE TABLE case_snapshot_facts(case_id text,version text,facts jsonb);
      CREATE TABLE case_snapshot_answers(case_id text,version text,diagnosis text,plan text);
      ALTER TABLE case_snapshot_answers ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA "${schema}",auth TO authenticated,anon;GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;`);
    for(const name of ['20261016000000_case_tests_rpc_reaffirm.sql','20261010130000_reference_teacher_only.sql','20261026233836_case_snapshot_entry_source_keys.sql','20261027114509_case_snapshot_private_binding_config.sql']) {
      await db.exec(await readFile('supabase/migrations/'+name,'utf8'));
    }
    const acl=async()=> (await db.query('SELECT proacl::text FROM pg_proc WHERE oid=$1::regprocedure',[`"${schema}".case_snapshot_get_facts(text,text,uuid)`])).rows;
    const before=await acl();const migration=await readFile('supabase/migrations/20261027134242_case_exam_media_evidence_projection.sql','utf8');
    await db.exec(migration);await db.exec(migration);assert.deepEqual(await acl(),before);
    const call=async(entry:string,v='v1')=>(await db.query<{value:Record<string,unknown>|null}>('SELECT case_snapshot_get_facts($1,$2,$3) value',[entry,v,sid])).rows[0].value;
    for(const [entry,link] of Object.entries(TEACHER_CASE_LINKS)) {
      await db.exec('RESET ROLE;TRUNCATE training_sessions,case_snapshot_facts,case_snapshot_answers');
      const state={caseId:entry,sourceSnapshotVersion:'v1',unlockedEvidence:['EX_PREP'],events:[] as unknown[]};
      await db.query('INSERT INTO training_sessions VALUES($1,$2,$3,$4::jsonb)',[sid,owner,'active',JSON.stringify(state)]);
      await db.query('INSERT INTO case_snapshot_facts VALUES($1,$2,$3::jsonb)',[link.sourceId,'v1',JSON.stringify({sections:{history:'synthetic',exam:'synthetic',tests:'synthetic'},examMedia:[{examId:'must-strip'}],testMedia:[{fileId:'must-strip'}]})]);
      await db.query('INSERT INTO case_snapshot_answers(case_id,version,binding_config) VALUES($1,$2,$3::jsonb)',[link.sourceId,'v1',JSON.stringify({examMedia:[
        {examId:'source-exam-stethoscope-chest',media:[{...image,url:'must-strip'}]},
        {examId:'source-exam-thermometer-axillary',media:[{...image,fileId:'unperformed-image'}]}]})]);
      await db.query("SELECT set_config('fixture.actor',$1,false)",[owner]);await db.exec('SET ROLE authenticated');
      const prepared=await call(entry);assert.ok(!('examMedia' in prepared!)&&!('testMedia' in prepared!),'手卫生不释放任何查体图');
      for(const correct of [false,true]) {
        await db.exec('RESET ROLE');
        state.unlockedEvidence=['EX_PREP',code];state.events=[{type:'EXAM_ACTION',stage:'exam',correct,evidenceCodes:[code]}];
        await db.query('UPDATE training_sessions SET state=$1::jsonb WHERE id=$2',[JSON.stringify(state),sid]);await db.exec('SET ROLE authenticated');
        const projected=await call(entry);
        if(!correct)assert.ok(!('examMedia' in projected!));
        else assert.deepEqual(projected?.examMedia,[{examId:'source-exam-stethoscope-chest',media:[image]}]);
      }
      assert.equal(await call(entry,'v2'),null);assert.equal(await call(link.sourceId),null);
      await db.query("SELECT set_config('fixture.actor',$1,false)",[other]);assert.equal(await call(entry),null);
    }
    await db.exec('SET ROLE anon');await assert.rejects(()=>call('synthetic'),/permission denied/);
  }finally{await db.close();}
});
