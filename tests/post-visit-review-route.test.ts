import test from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {LLMClient} from 'coder-coding-dev-sdk';
import {AgentRepository} from '../src/lib/repository';
import {GET,POST} from '../src/app/api/reports/[id]/review/route';
import type {SessionState,TrainingReport} from '../src/domain/agent';
import {REVIEW_STAGES,type SavedPostVisitReview} from '../src/domain/post-visit-review';

test('review route enforces ownership/completion, coalesces model calls and reuses saved output',async t=>{
  const names=['CODER_SUPABASE_URL','CODER_SUPABASE_ANON_KEY','COZE_SUPABASE_URL','COZE_SUPABASE_ANON_KEY','COZE_AI_API_KEY','COZE_AI_BASE_URL'];
  const before=names.map(name=>process.env[name]);
  const fetchBefore=globalThis.fetch;
  let userId='00000000-0000-0000-0000-000000000001',calls=0,saves=0,valid=true;
  const session={id:'session-fixture',userId,reportId:'report-fixture',status:'completed',sourceSnapshotVersion:'source-v1',teachingPackageVersion:'teaching-v1',messages:[{id:'1',actor:'doctor',content:'什么时候开始不舒服？'}],events:[],decision:null,plan:null,communication:null} as unknown as SessionState;
  const report={id:'report-fixture',sessionId:session.id,userId,sourceSnapshotVersion:'source-v1',mode:'guided',evidence:[],strengths:[],improvements:[],totalScore:63} as unknown as TrainingReport;
  const context={params:Promise.resolve({id:report.id})};
  const request=(auth=true)=>new NextRequest(`http://localhost/api/reports/${report.id}/review`,{headers:auth?{authorization:'Bearer synthetic-review-token'}:{}});
  t.mock.method(AgentRepository.prototype,'getReport',async()=>report);
  t.mock.method(AgentRepository.prototype,'getSession',async()=>structuredClone(session));
  t.mock.method(AgentRepository.prototype,'listMyNotes',async()=>[]);
  t.mock.method(AgentRepository.prototype,'savePostVisitReview',async(_id:string,review:SavedPostVisitReview)=>{saves++;session.postVisitReview=review;});
  t.mock.method(LLMClient.prototype,'invoke',async(_messages:unknown,config:{thinking:string;model:string})=>{
    calls++;assert.equal(config.thinking,'enabled');assert.ok(config.model);
    return {content:JSON.stringify({summary:'核对本次记录',priorities:[{stage:'history',title:'核对病程',reason:'按实际问答解释',action:'围绕病程继续追问',citations:[{evidenceId:valid?'message:1':'invented',quote:'什么时候开始'}]}],stages:REVIEW_STAGES.map(stage=>({stage,strengths:[],gaps:[],nextSteps:['按本轮目标复盘'],citations:[]}))})};
  });
  try{
    names.forEach(name=>delete process.env[name]);
    process.env.COZE_SUPABASE_URL='https://review.invalid';process.env.COZE_SUPABASE_ANON_KEY='synthetic-key';
    process.env.COZE_AI_API_KEY='synthetic-model-key';process.env.COZE_AI_BASE_URL='https://review.invalid/model';
    globalThis.fetch=async input=>{
      const url=String(input);assert.ok(url.startsWith('https://review.invalid/'));
      if(url.includes('/auth/v1/user'))return Response.json({id:userId,email:'fixture@example.invalid',email_confirmed_at:'2026-01-01',app_metadata:{app:{role:'student'}},user_metadata:{}});
      if(url.includes('/rpc/app_is_teacher'))return Response.json(false);
      throw Error('UNEXPECTED_FIXTURE_NETWORK');
    };
    assert.equal((await POST(request(false),context)).status,401);
    session.status='active';assert.equal((await POST(request(),context)).status,422);assert.equal(calls,0);
    session.status='completed';userId='00000000-0000-0000-0000-000000000002';
    assert.equal((await POST(request(),context)).status,403);assert.equal(calls,0);
    userId=session.userId;
    const responses=await Promise.all([POST(request(),context),POST(request(),context)]);
    assert.ok(responses.every(response=>response.status===200));assert.equal(calls,1);assert.equal(saves,1);
    const persisted=await (await GET(request(),context)).json();assert.equal(persisted.data.reportId,report.id);
    assert.equal((await POST(request(),context)).status,200);assert.equal(calls,1);
    assert.equal(report.totalScore,63);assert.equal(session.events.length,0);
    delete session.postVisitReview;valid=false;
    assert.equal((await POST(request(),context)).status,503);assert.equal(saves,1);assert.equal(report.totalScore,63);
  }finally{
    globalThis.fetch=fetchBefore;
    names.forEach((name,i)=>{if(before[i]===undefined)delete process.env[name];else process.env[name]=before[i];});
  }
});
