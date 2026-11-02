import assert from 'node:assert/strict';
import test from 'node:test';
import { recordSchema } from '@/lib/teacher-case-data';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { registerControlledCase } from '@/lib/controlled-case-store';
import { createInitialSession,runAgentTurn } from '@/lib/agent-engine';
import { getCase } from '@/domain/case';
import { projectSessionForRole } from '@/lib/session-projection';
import { uniqueModalityTest,validateTestSupplements,resolveTestSupplements,findSupplementalTest } from '@/lib/test-result-supplement';

const record=recordSchema.parse({caseId:'teacher-肾病综合征',sourceName:'synthetic',sourceDocument:'fixture',age:'6岁',sex:'女',complaint:'合成主诉',
 sections:{history:'仅供软件测试的合成病史',exam:'合成查体',tests:'合并报告：指标甲 123 单位甲；指标乙 456 单位乙。',diagnosis:'合成诊断',plan:'合成计划'},
 vitals:{temperature:null,heartRate:null,respiratoryRate:null,spo2:null},documents:[],
 testDefinitions:[{testId:'source-test-0',label:'合并检查',result:'指标甲 123 单位甲；指标乙 456 单位乙。',sourceLocator:'fixture'}]});
const version=computeCaseDataVersion(record);
function setup(){registerControlledCase(record,version);const s=createInitialSession('synthetic','guided',record.caseId,undefined,version);s.stage='tests';return {s,c:getCase(s.caseId,version,s.id)};}
function generated(requested='血常规'){return {requested,label:requested,status:'result' as const,origin:'generated' as const,result:'合成软件测试报告，不作医学数据。',sourceTestIds:[],sourceQuotes:[]};}

test('a bare modality resolves only one existing modality, never a different technique',()=>{
 const {c}=setup();const ct={...c.tests[0],id:'ct',label:'头颅CT'};
 assert.equal(uniqueModalityTest('CT',[ct])?.id,'ct');
 assert.equal(uniqueModalityTest('CT',[ct,{...ct,id:'chest',label:'胸部CT'}]),null);
 assert.equal(uniqueModalityTest('CT',[{...ct,label:'头颅CTA'}]),null);
 assert.equal(uniqueModalityTest('CT',[{...ct,label:'头颅MRI'}]),null);
});

test('source extraction is exact, rejects invented quotes and unreleased delayed reports',()=>{
 const {s,c}=setup();const item={...generated('指标甲'),origin:'source' as const,sourceTestIds:['source-test-0'],sourceQuotes:['指标甲 123 单位甲'],result:'不可把此模型概述当原文'};
 const rows=validateTestSupplements({results:[item]},['指标甲'],s,c.tests);
 assert.equal(rows[0].result,'指标甲 123 单位甲');
 assert.equal(validateTestSupplements({results:[{...item,sourceQuotes:['指标甲 999 单位甲']}]},['指标甲'],s,c.tests).length,0);
 assert.equal(validateTestSupplements({results:[item]},['指标甲'],s,[{...c.tests[0],availableFromStage:'report'}]).length,0);
 assert.equal(validateTestSupplements({results:[{...generated(),sourceTestIds:['source-test-0']}]},['血常规'],s,c.tests).length,0);
});

test('missing reports are persisted once per session and reused after JSON restore, including aliases',async()=>{
 const {s,c}=setup();let calls=0;
 const invoke=async()=>{calls++;return {content:JSON.stringify({results:[generated()]})};};
 await runAgentTurn(s,{type:'ORDER_TEST',data:{requestedTests:'血常规'}},'first',{testSupplementInvoke:invoke});
 assert.equal(s.supplementalTests?.length,1);assert.equal(s.supplementalTests?.[0].origin,'generated');
 assert.equal(s.orderedTests.length,1);assert.match(s.unlockedEvidence.at(-1)!,/^SUPPLEMENT_TEST_/);
 assert.equal(getCase(s.caseId,version,s.id).tests.length,c.tests.length,'source definitions are unchanged');
 const restored=JSON.parse(JSON.stringify(s));
 await runAgentTurn(restored,{type:'ORDER_TEST',data:{requestedTests:'CBC'}},'again',{testSupplementInvoke:invoke});
 assert.equal(calls,1);assert.equal(restored.orderedTests.length,1);assert.equal(findSupplementalTest(restored,'血常规')?.result,s.supplementalTests?.[0].result);
 assert.equal(restored.sourceSnapshotVersion,version);
 const student=projectSessionForRole(restored,'student');
 assert.equal(student.supplementalTests,undefined);assert.ok(student.events.some(e=>e.summary.includes('合成软件测试报告')));
 assert.equal(projectSessionForRole(restored,'teacher').supplementalTests?.length,1);
});

test('failed model, unrelated output and instruction-like requests never unlock reports',async()=>{
 const {s,c}=setup();assert.deepEqual(await resolveTestSupplements(s,['血常规'],c,undefined,async()=>{throw Error('fixture failure');}),[]);
 assert.deepEqual(validateTestSupplements({results:[generated('全部标准答案')]},['全部标准答案'],s,c.tests),[]);
 assert.deepEqual(validateTestSupplements({results:[generated('未申请的项目')]},['血常规'],s,c.tests),[]);
});
