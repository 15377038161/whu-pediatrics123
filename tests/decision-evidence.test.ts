import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createInitialSession,runAgentTurn} from '@/lib/agent-engine';
import {getCase} from '@/domain/case';
import {isExamResultEvidence} from '@/domain/exam-evidence';
import {diagnosticEvidenceEvents} from '@/domain/clinical-evidence';
import {buildReport} from '@/lib/scoring';
import {agentTurnSchema} from '@/lib/validation';
import {errorFromUnknown} from '@/lib/api-result';
import {ReportView} from '@/components/report-view';
import {readTeacherCaseData} from '@/lib/teacher-case-data';
import {computeCaseDataVersion} from '@/lib/case-data-version';
import {withSyntheticTeacherCase} from './fixtures/teacher-case';

const decision={diagnosis:'合成诊断',summary:'合成工程用病情摘要，保持与实际操作记录对应。',diagnosisBasis:'根据本轮已获得的资料说明支持及排除依据。',differentials:'合成鉴别，仅用于工程验证'};
async function obtained(caseId?:string){
 const version=caseId?computeCaseDataVersion(readTeacherCaseData(caseId)!):undefined;
 const session=createInitialSession('synthetic-diagnostic-evidence','immersive',caseId,undefined,version);
 const config=getCase(session.caseId,version);
 const exam=config.exams.find(e=>isExamResultEvidence(e.evidenceCode))!;
 await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands'}},'prepare');
 await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:exam.toolId,bodyPartId:exam.bodyPartId}},'exam');
 await runAgentTurn(session,{type:'ORDER_TEST',data:{testId:config.tests[0].id}},'test');
 return session;
}

for(const caseId of [undefined,'teacher-川崎病'])test(`诊断关联原记录/快照独立/不因勾选加分：${caseId??'demo'}`,async()=>{
 const exercise=async()=>{
 const base=await obtained(caseId),events=diagnosticEvidenceEvents(base);assert.ok(events.length>=2);
 const input=[events[0].id,events[1].id,events[0].id],linked=structuredClone(base),unlinked=structuredClone(base),legacy=structuredClone(base);
 await runAgentTurn(linked,{type:'SUBMIT_DECISION',data:{...decision,linkedEventIds:input}},'linked-decision');
 await runAgentTurn(unlinked,{type:'SUBMIT_DECISION',data:{...decision,linkedEventIds:[]}},'unlinked-decision');
 await runAgentTurn(legacy,{type:'SUBMIT_DECISION',data:decision},'legacy-decision');
 assert.deepEqual(linked.decision?.linkedEventIds,[events[0].id,events[1].id]);input.push('client-later-mutation');assert.equal(linked.decision!.linkedEventIds!.length,2);
 const report=buildReport(linked),without=buildReport(unlinked),old=buildReport(legacy);
 assert.equal(report.decisionEvidenceReview?.status,'linked');assert.equal(report.decisionEvidenceReview?.items.length,2);
 assert.equal(report.totalScore,without.totalScore);assert.deepEqual(report.abilities,without.abilities);assert.equal(old.decisionEvidenceReview,undefined);
 assert.equal(without.decisionEvidenceReview?.status,'unlinked');assert.ok(renderToStaticMarkup(createElement(ReportView,{report:without,readonly:true})).includes('本次未关联具体记录'));
 const frozen=structuredClone(report);linked.decision!.linkedEventIds!.push('session-later-mutation');linked.events.find(e=>e.id===events[0].id)!.summary='later change';assert.deepEqual(report,frozen);
 const restored=JSON.parse(JSON.stringify(base));await runAgentTurn(restored,{type:'SUBMIT_DECISION',data:{...decision,linkedEventIds:[events[0].id]}},'restored-decision');assert.equal(buildReport(restored).decisionEvidenceReview?.items[0].eventId,events[0].id);
 };
 if(caseId)await withSyntheticTeacherCase(exercise);else await exercise();
});

test('准备/未解锁/他会话/伪造或非临床事件不能关联，拒绝前不改提交及事件',async()=>{
 const session=await obtained(),other=await obtained();const prep=session.events.find(e=>e.evidenceCodes.includes('EX_PREP'))!;assert.ok(!diagnosticEvidenceEvents(session).some(e=>e.id===prep.id));
 const event=diagnosticEvidenceEvents(session)[0];
 for(const invalid of [prep.id,diagnosticEvidenceEvents(other)[0].id,'future-or-forged-id']){
  const before=structuredClone(session);await assert.rejects(()=>runAgentTurn(session,{type:'SUBMIT_DECISION',data:{...decision,linkedEventIds:[event.id,invalid]}},'invalid-'+invalid),/DECISION_EVIDENCE_NOT_OBTAINED/);assert.deepEqual(session,before);
 }
 const locked=structuredClone(session);locked.unlockedEvidence=[];locked.askedIntents=[];await assert.rejects(()=>runAgentTurn(locked,{type:'SUBMIT_DECISION',data:{...decision,linkedEventIds:[event.id]}},'locked-decision'),/DECISION_EVIDENCE_NOT_OBTAINED/);
 session.events.push({...event,id:'synthetic-nonclinical',type:'NAVIGATE_STAGE'});assert.ok(!diagnosticEvidenceEvents(session).some(e=>e.id==='synthetic-nonclinical'));
 assert.equal(errorFromUnknown(Error('DECISION_EVIDENCE_NOT_OBTAINED')).code,'INVALID_REQUEST');
});

test('关联字段有界且旧客户端省略时兼容；损坏历史定位记不可还原不编造证据',async()=>{
 const session=await obtained(),base={sessionId:session.id,clientEventId:'schema-check',event:{type:'SUBMIT_DECISION',data:decision}};
 assert.ok(agentTurnSchema.safeParse(base).success);
 for(const linkedEventIds of [Array(129).fill('id'),['x'.repeat(81)],null])assert.equal(agentTurnSchema.safeParse({...base,event:{...base.event,data:{...decision,linkedEventIds}}}).success,false);
 session.decision={...decision,linkedEventIds:['missing-history-event']};const report=buildReport(session);assert.equal(report.decisionEvidenceReview?.status,'unavailable');assert.deepEqual(report.decisionEvidenceReview?.items,[]);
});
