import test from 'node:test';
import assert from 'node:assert/strict';
import type {SessionState,TrainingReport} from '../src/domain/agent';
import {REVIEW_STAGES} from '../src/domain/post-visit-review';
import {assertReviewContext,buildPostVisitReviewInput,buildPostVisitReviewMessages,parsePostVisitReview,savedReviewMatches} from '../src/lib/post-visit-review';

export const reviewFixture=()=>({summary:'按实际记录复盘',priorities:[{stage:'history',title:'补充时间线',reason:'起病时点尚需核实',action:'先问何时开始，再问变化',citations:[{evidenceId:'q1',quote:'什么时候开始'}]}],stages:REVIEW_STAGES.map(stage=>({stage,strengths:[],gaps:[],nextSteps:['结合本轮目标核对已有记录'],citations:[]}))});
const report={id:'report-1',sessionId:'session-1',userId:'student-1',sourceSnapshotVersion:'source-a',mode:'guided',evidence:[],strengths:[],improvements:[],studentSubmissions:{decision:{diagnosis:'学生自己的判断'},plan:null,communication:null},totalScore:73} as unknown as TrainingReport;
const session={id:'session-1',userId:'student-1',reportId:'report-1',status:'completed',sourceSnapshotVersion:'source-a',teachingPackageVersion:'teaching-a',messages:[{id:'1',actor:'doctor',content:'什么时候开始不舒服？'}],events:[],decision:null,plan:null,communication:null} as unknown as SessionState;

test('only a completed, matching report and dual version can produce review context',()=>{
  assert.doesNotThrow(()=>assertReviewContext(report,session));
  for(const change of [{status:'active'},{reportId:'other'},{userId:'other'},{sourceSnapshotVersion:'new-source'}])assert.throws(()=>assertReviewContext(report,{...session,...change} as SessionState));
  assert.throws(()=>assertReviewContext({...report,teachingFeedback:{packageVersion:'other'} as TrainingReport['teachingFeedback']},session));
});
test('input preserves actual evidence and frozen submissions, omits source files and does not alter scores',()=>{
  const before=JSON.stringify({report,session});
  const {input,evidence,inputHash}=buildPostVisitReviewInput(report,session,null);
  assert.equal(evidence.length,2);
  assert.ok(evidence.some(item=>item.text==='什么时候开始不舒服？'));
  assert.match(JSON.stringify(input),/学生自己的判断/);
  assert.equal(inputHash,buildPostVisitReviewInput(report,session,null).inputHash);
  assert.match(buildPostVisitReviewMessages(input)[0].content as string,/不得改分/);
  assert.equal(JSON.stringify({report,session}),before);
  const privateReport={...report,evidence:[{code:'SOURCE_PLAN_REFERENCE',detail:'private-source-answer'}]} as TrainingReport;
  assert.ok(!JSON.stringify(buildPostVisitReviewInput(privateReport,session,null)).includes('private-source-answer'));
});
test('seven unique stages and exact evidence quotations required; invented references and scores rejected',()=>{
  const text=JSON.stringify(reviewFixture()),evidence=[{id:'q1',text:'什么时候开始不舒服？'}];
  assert.ok(parsePostVisitReview(text,evidence));
  assert.ok(parsePostVisitReview('```json\n'+text+'\n```',evidence));
  assert.equal(parsePostVisitReview(text,[{id:'q1',text:'其他文字'}]),null);
  const missing=reviewFixture();missing.stages[6].stage='history';
  assert.equal(parsePostVisitReview(JSON.stringify(missing),evidence),null);
  assert.equal(parsePostVisitReview(JSON.stringify({...reviewFixture(),totalScore:100}),evidence),null);
  assert.equal(parsePostVisitReview(JSON.stringify({...reviewFixture(),summary:'患者体温99℃'}),evidence),null);
  assert.ok(parsePostVisitReview(JSON.stringify({...reviewFixture(),summary:'原记录体温37℃'}),evidence,'原记录体温37℃'));
  assert.equal(parsePostVisitReview('not json',evidence),null);
});
test('cached feedback is returned only for the original report and source/teaching versions',()=>{
  const saved={reportId:'report-1',sourceVersion:'source-a',teachingVersion:'teaching-a',inputHash:'a',promptVersion:'v1',model:'fixture',generatedAt:'2026-11-09',content:reviewFixture()} as Parameters<typeof savedReviewMatches>[0];
  assert.equal(savedReviewMatches(saved,report,session),true);
  assert.equal(savedReviewMatches(saved,{...report,id:'other'},session),false);
  assert.equal(savedReviewMatches(saved,report,{...session,teachingPackageVersion:'new'}),false);
});
