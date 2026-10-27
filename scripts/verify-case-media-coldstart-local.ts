/** Isolated disk PostgreSQL + loopback PostgREST adapter. No real Auth/device/medical proof.
 * Run `seed <ignored output directory>` then `reopen <same directory>` in separate processes.
 * Never deletes or overwrites an existing database; all source facts and tokens are synthetic. */
import {PGlite} from '@electric-sql/pglite';
import {createServer} from 'node:http';
import {existsSync,readdirSync,mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createInitialSession,runAgentTurn} from '@/lib/agent-engine';
import {AgentRepository} from '@/lib/repository';
import {buildFactsPayloadForInit,buildBindingConfigForInit} from '@/lib/teacher-case-import';
import {recordSchema} from '@/lib/teacher-case-data';
import {computeCaseDataVersion} from '@/lib/case-data-version';
import {findReleasedMedia} from '@/lib/case-media';
import {buildReport} from '@/lib/scoring';

const schema='tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema';
const owner='00000000-0000-4000-8000-000000000001',sid='00000000-0000-4000-8000-000000000003';
const entry='teacher-毛细支气管炎',source='teacher-急性毛细支气管炎';
const code='SOURCE_EX_stethoscope_chest';
const record=recordSchema.parse({caseId:source,sourceName:'synthetic',sourceDocument:'synthetic',age:'1月',sex:'女',complaint:'synthetic',
 sections:{history:'合成工程病史',exam:'呼吸音：合成工程所见。',tests:'血常规：合成工程结果',diagnosis:'synthetic',plan:'synthetic'},
 vitals:{temperature:null,heartRate:null,respiratoryRate:null,spo2:null},documents:[],
 testMedia:[{testId:'source-test-0',media:[{fileId:'synthetic-test-v1',kind:'image',caption:'synthetic'}]}],
 examMedia:[{examId:'source-exam-stethoscope-chest',media:[{fileId:'synthetic-exam-v1',kind:'image',caption:'synthetic'}]}]});
const version=computeCaseDataVersion(record);
let checkpoint='start';

async function main(){
 const [phase,arg]=process.argv.slice(2);assert.ok(['seed','reopen','inspect'].includes(phase));assert.ok(arg);
 const root=path.resolve(arg),relative=path.relative(path.resolve('output'),root);
 assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Only an owned ignored output directory is allowed');
 const dataDir=path.join(root,'db');
 if(phase==='seed')assert.ok(!existsSync(dataDir)||readdirSync(dataDir).length===0,'Never reset an existing database');
 else assert.ok(existsSync(dataDir));
 mkdirSync(root,{recursive:true});
 for(const name of Object.keys(process.env))if(/^(CODER_|COZE_|SUPABASE_|RLS_PROBE_|PERSIST_PROBE_)/.test(name))delete process.env[name];
 process.env.PEDIATRICS_KNOWLEDGE_ROOT=path.join(root,'empty-knowledge');process.env.ENABLE_AI_FIXTURE='true';
 checkpoint='open-disk-database';const db=new PGlite(dataDir);
 try{
  if(phase==='seed'){
   await db.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE SCHEMA auth;CREATE SCHEMA "${schema}";SET search_path TO "${schema}";
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('fixture.actor',true),'')::uuid $$;
    CREATE FUNCTION app_is_teacher() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE TABLE training_sessions(id uuid PRIMARY KEY,user_id uuid,status text,state jsonb);
    CREATE TABLE case_snapshot_facts(case_id text,version text,facts jsonb);
    CREATE TABLE case_snapshot_answers(case_id text,version text,diagnosis text,plan text);
    ALTER TABLE case_snapshot_answers ENABLE ROW LEVEL SECURITY;
    CREATE TABLE training_messages(id text PRIMARY KEY,payload jsonb);
    CREATE TABLE clinical_operations(id text PRIMARY KEY,payload jsonb);
    GRANT USAGE ON SCHEMA "${schema}",auth TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
   for(const name of ['20261016000000_case_tests_rpc_reaffirm.sql','20261010130000_reference_teacher_only.sql','20261026233836_case_snapshot_entry_source_keys.sql',
    '20261027114509_case_snapshot_private_binding_config.sql','20261027124136_case_test_private_media_release.sql','20261027134242_case_exam_media_evidence_projection.sql']){
    await db.exec(readFileSync(path.join('supabase/migrations',name),'utf8'));
   }
   const session=createInitialSession(owner,'guided',entry,undefined,version,sid);
   session.id=sid;session.sourceSnapshotVersion=version;session.stage='assessment';session.unlockedEvidence=['EX_PREP',code];
   session.events=[{id:'synthetic-exam-event',clientEventId:'synthetic-exam-event',type:'EXAM_ACTION',stage:'exam',correct:true,evidenceCodes:[code],summary:'synthetic exam',createdAt:session.startedAt}];
   await db.query('INSERT INTO training_sessions VALUES($1,$2,$3,$4::jsonb)',[sid,owner,'active',JSON.stringify(session)]);
   await db.query('INSERT INTO case_snapshot_facts VALUES($1,$2,$3::jsonb)',[source,version,JSON.stringify(buildFactsPayloadForInit(record))]);
   await db.query('INSERT INTO case_snapshot_answers(case_id,version,binding_config) VALUES($1,$2,$3::jsonb)',[source,version,JSON.stringify(buildBindingConfigForInit(record))]);
   // A newer snapshot must not replace the old session's media after process restart.
   await db.query('INSERT INTO case_snapshot_answers(case_id,version,binding_config) VALUES($1,$2,$3::jsonb)',[source,'different-version',JSON.stringify({examMedia:[{examId:'source-exam-stethoscope-chest',media:[{fileId:'must-not-drift',kind:'image',caption:'synthetic'}]}]})]);
   console.log(JSON.stringify({phase,syntheticOnly:true,persistedToDisk:true,version}));return;
  }
  checkpoint='reopen-schema';await db.exec(`SET search_path TO "${schema}"`);
  const rpcNames=new Set(['case_snapshot_get_facts','case_snapshot_list_tests','case_snapshot_get_test','case_snapshot_record_test_order']);
  const server=createServer(async(req,res)=>{
   try{
    const url=new URL(req.url!,'http://127.0.0.1');const table=url.pathname.split('/').at(-1)!;
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
    let data:unknown=null;
    if(url.pathname.includes('/rpc/')&&rpcNames.has(table)){
     await db.query("SELECT set_config('fixture.actor',$1,false)",[owner]);await db.exec('SET ROLE authenticated');
     const args=[body.p_case_id,body.p_version,body.p_session_id];if('p_test_id'in body)args.push(body.p_test_id);
     try{data=(await db.query<{value:unknown}>(`SELECT ${table}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;}
     finally{await db.exec('RESET ROLE');}
    }else if(table==='training_sessions'&&req.method==='GET'){
     assert.equal(url.searchParams.get('id'),'eq.'+sid);
     data=(await db.query('SELECT state,user_id,null AS cohort_id FROM training_sessions WHERE id=$1 AND user_id=$2',[sid,owner])).rows;
    }else if(table==='training_sessions'&&req.method==='PATCH'){
     assert.equal(url.searchParams.get('id'),'eq.'+sid);assert.equal(url.searchParams.get('user_id'),'eq.'+owner);
     await db.query('UPDATE training_sessions SET state=$1::jsonb,status=$2 WHERE id=$3 AND user_id=$4',[JSON.stringify(body.state),body.status,sid,owner]);data=null;
    }else if(['training_messages','clinical_operations'].includes(table)&&req.method==='POST'){
     for(const item of body){assert.equal(item.session_id,sid);await db.query(`INSERT INTO ${table}(id,payload) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`,[item.id,JSON.stringify(item)]);}data=null;
    }else throw new Error('SYNTHETIC_ENDPOINT_NOT_ALLOWED');
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));
   }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'SYNTHETIC_ADAPTER_FAILURE'}));}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
  process.env.COZE_SUPABASE_URL=`http://127.0.0.1:${address.port}`;process.env.COZE_SUPABASE_ANON_KEY='synthetic-public-key';
  try{
   const actor={id:owner,role:'student' as const,displayName:'synthetic',studentNo:null,provider:'chaoxing' as const,chaoxingUid:null,accessToken:'synthetic-non-jwt-loopback-only'};
   checkpoint='repository-restore';const repo=new AgentRepository(actor);const session=await repo.getSession(sid);
   checkpoint='exam-media-restored';
   assert.equal(session.sourceSnapshotVersion,version);assert.ok(findReleasedMedia(session,'synthetic-exam-v1'));assert.equal(findReleasedMedia(session,'must-not-drift'),null);
   if(phase==='inspect'){
    assert.equal(session.status,'completed');assert.ok(findReleasedMedia(session,'synthetic-test-v1'));
    const report=buildReport(session);assert.equal(report.sourceSnapshotVersion,version);
    assert.equal(report.totalScore,Object.values(report.abilities).reduce((a,b)=>a+b,0));
    console.log(JSON.stringify({phase,syntheticOnly:true,thirdProcessCompletedSessionRestored:true,examAndTestMediaPreserved:true,reportVersionPreserved:true,productionAccepted:false}));return;
   }
   checkpoint='order-test';await runAgentTurn(session,{type:'ORDER_TEST',data:{testId:'source-test-0'}},'synthetic-test-after-restart',{accessToken:actor.accessToken});
   checkpoint='test-media-released';
   assert.ok(findReleasedMedia(session,'synthetic-test-v1'));
   await runAgentTurn(session,{type:'SUBMIT_DECISION',data:{diagnosis:'合成工程判断',summary:'合成工程摘要',diagnosisBasis:'只验证提交字段与材料证据的保存，不作医学判断',differentials:'合成工程鉴别'}},'synthetic-decision');
   await runAgentTurn(session,{type:'SUBMIT_PLAN',data:{priority:'合成工程优先事项',detail:'合成工程字段验证，不作为医疗建议'}},'synthetic-plan');
   await runAgentTurn(session,{type:'SEND_COMMUNICATION',data:{text:'合成工程沟通：理解您的担心，会继续评估并说明下一步安排。'}},'synthetic-communication');
   await runAgentTurn(session,{type:'FINISH_SESSION',data:{}},'synthetic-finish');
   assert.equal(session.status,'completed');await repo.saveSession(session);
   const reread=await repo.getSession(sid);assert.ok(findReleasedMedia(reread,'synthetic-exam-v1'));assert.ok(findReleasedMedia(reread,'synthetic-test-v1'));
   checkpoint='report-link';const report=buildReport(reread);assert.equal(report.sourceSnapshotVersion,version);
   assert.ok(report.evidence.some(item=>item.eventIds.some(id=>reread.events.some(event=>event.id===id&&event.media?.length))));
   console.log(JSON.stringify({phase,syntheticOnly:true,separateProcessDiskDatabaseRestored:true,examMediaRestored:true,testMediaReleasedAndSaved:true,reportVersionAndEventLinked:true,historicalMediaDidNotDrift:true,realAuthOrProductionAccepted:false}));
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 }finally{await db.close();}
}
main().catch(error=>{console.error(JSON.stringify({failure:'LOCAL_MEDIA_COLDSTART_FAILED',checkpoint,
  errorType:error instanceof Error?error.name:'unknown',code:typeof error?.code==='string'&&/^[A-Z_0-9]+$/.test(error.code)?error.code:null}));process.exitCode=1;});
