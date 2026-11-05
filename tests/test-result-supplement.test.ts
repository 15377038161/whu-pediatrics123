import assert from 'node:assert/strict';
import test from 'node:test';
import { recordSchema } from '@/lib/teacher-case-data';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { registerControlledCase } from '@/lib/controlled-case-store';
import { createInitialSession,runAgentTurn } from '@/lib/agent-engine';
import { getCase } from '@/domain/case';
import { projectSessionForRole } from '@/lib/session-projection';
import { uniqueModalityTest,validateTestSupplements,resolveTestSupplements,findSupplementalTest,type TestSupplementInvoke } from '@/lib/test-result-supplement';

const record=recordSchema.parse({caseId:'teacher-肾病综合征',sourceName:'synthetic',sourceDocument:'fixture',age:'6岁',sex:'女',complaint:'合成主诉',
 sections:{history:'仅供软件测试的合成病史',exam:'合成查体',tests:'合并报告：指标甲 123 单位甲；指标乙 456 单位乙。',diagnosis:'合成诊断',plan:'合成计划'},
 vitals:{temperature:null,heartRate:null,respiratoryRate:null,spo2:null},documents:[],
 testDefinitions:[{testId:'source-test-0',label:'合并检查',result:'指标甲 123 单位甲；指标乙 456 单位乙。',sourceLocator:'fixture'}]});
const version=computeCaseDataVersion(record);
function setup(){registerControlledCase(record,version);const s=createInitialSession('synthetic','guided',record.caseId,undefined,version);s.stage='tests';return {s,c:getCase(s.caseId,version,s.id)};}
/** 模型自述为生成的报告：老师红线要求原始资料没有结果时只能选择做/不做，此类结果一律不得落地。 */
function fabricated(requested='血常规'){return {requested,label:requested,status:'result' as const,origin:'generated' as const,result:'合成软件测试报告，不作医学数据。',sourceTestIds:[],sourceQuotes:[]};}
function sourceExtract(requested='指标甲'){return {requested,label:requested,status:'result' as const,origin:'source' as const,result:'不可把此模型概述当原文',sourceTestIds:['source-test-0'],sourceQuotes:['指标甲 123 单位甲']};}

test('a bare modality resolves only one existing modality, never a different technique',()=>{
 const {c}=setup();const ct={...c.tests[0],id:'ct',label:'头颅CT'};
 assert.equal(uniqueModalityTest('CT',[ct])?.id,'ct');
 assert.equal(uniqueModalityTest('CT',[ct,{...ct,id:'chest',label:'胸部CT'}]),null);
 assert.equal(uniqueModalityTest('CT',[{...ct,label:'头颅CTA'}]),null);
 assert.equal(uniqueModalityTest('CT',[{...ct,label:'头颅MRI'}]),null);
});

test('source extraction is exact, rejects invented quotes and unreleased delayed reports',()=>{
 const {s,c}=setup();
 const rows=validateTestSupplements({results:[sourceExtract()]},['指标甲'],s,c.tests);
 assert.equal(rows[0].result,'指标甲 123 单位甲');
 assert.equal(rows[0].origin,'source');
 assert.equal(validateTestSupplements({results:[{...sourceExtract(),sourceQuotes:['指标甲 999 单位甲']}]},['指标甲'],s,c.tests).length,0);
 assert.equal(validateTestSupplements({results:[sourceExtract()]},['指标甲'],s,[{...c.tests[0],availableFromStage:'report'}]).length,0);
 assert.equal(validateTestSupplements({results:[{...fabricated(),sourceTestIds:['source-test-0']}]},['血常规'],s,c.tests).length,0);
});

test('无原始结果时不得生成教学报告：generated 一律拒绝，提示词不再授权补全',async()=>{
 const {s,c}=setup();
 assert.deepEqual(validateTestSupplements({results:[fabricated()]},['血常规'],s,c.tests),[]);
 let prompt='';
 const invoke:TestSupplementInvoke=async(input)=>{prompt=String(input.messages?.[0]?.content??'');return {content:JSON.stringify({results:[fabricated()]})};};
 assert.deepEqual(await resolveTestSupplements(s,['血常规'],c,undefined,invoke),[]);
 assert.doesNotMatch(prompt,/允许依据患者年龄、病情及既有数据生成/);
 assert.doesNotMatch(prompt,/origin=generated/);
 assert.match(prompt,/不得(生成|编造|补全)/);
 assert.match(prompt,/没有对应(的)?(原始)?结果/);
});

test('历史遗留 generated 记录不再被复用：缓存查找只认原文摘录',()=>{
 const {s,c}=setup();
 const legacy={id:'supplement-legacy',requested:'血常规',label:'血常规',result:'旧的合成结果',origin:'generated' as const,
  sourceTestIds:[],sourceQuotes:[],model:'legacy',createdAt:new Date().toISOString(),sourceSnapshotVersion:version};
 s.supplementalTests=[legacy];
 assert.equal(findSupplementalTest(s,'血常规'),undefined);
 assert.equal(findSupplementalTest(s,'CBC'),undefined);
 s.supplementalTests=[{...legacy,id:'supplement-src',origin:'source' as const,result:'指标甲 123 单位甲',sourceTestIds:['source-test-0'],sourceQuotes:['指标甲 123 单位甲']}];
 assert.equal(findSupplementalTest(s,'血常规')?.id,'supplement-src');
 assert.ok(c.tests.length>0);
});

test('申请无结果项目：只记录做/不做，不下发结果、不解锁证据，并明示资料未提供',async()=>{
 const {s,c}=setup();let calls=0;
 const invoke=async()=>{calls++;return {content:JSON.stringify({results:[fabricated()]})};};
 const turn=await runAgentTurn(s,{type:'ORDER_TEST',data:{requestedTests:'血常规'}},'first',{testSupplementInvoke:invoke});
 assert.equal(calls,1);
 assert.equal(s.supplementalTests,undefined);
 assert.ok(!s.unlockedEvidence.some(code=>code.startsWith('SUPPLEMENT_TEST_')));
 assert.equal(getCase(s.caseId,version,s.id).tests.length,c.tests.length,'source definitions are unchanged');
 assert.match(turn.feedback??'',/资料未提供|暂未取得/);
 assert.doesNotMatch(turn.feedback??'',/请重试/);
 assert.ok(s.events.some(event=>event.type==='ORDER_TEST'&&event.summary.includes('血常规')),'申请作为操作记录留痕');
 const student=projectSessionForRole(s,'student');
 assert.equal(student.supplementalTests,undefined);
 assert.ok(!student.events.some(event=>event.summary.includes('合成软件测试报告')),'合成结果不得出现在学生事件里');
});

test('原文摘录结果按会话留存并在 JSON 恢复后复用，学生投影剥离审计字段',async()=>{
 const {s,c}=setup();let calls=0;
 const invoke=async()=>{calls++;return {content:JSON.stringify({results:[sourceExtract()]})};};
 await runAgentTurn(s,{type:'ORDER_TEST',data:{requestedTests:'指标甲'}},'first',{testSupplementInvoke:invoke});
 assert.equal(s.supplementalTests?.length,1);assert.equal(s.supplementalTests?.[0].origin,'source');
 assert.equal(s.orderedTests.length,1);assert.match(s.unlockedEvidence.at(-1)!,/^SUPPLEMENT_TEST_/);
 assert.equal(getCase(s.caseId,version,s.id).tests.length,c.tests.length,'source definitions are unchanged');
 const restored=JSON.parse(JSON.stringify(s));
 await runAgentTurn(restored,{type:'ORDER_TEST',data:{requestedTests:'指标甲'}},'again',{testSupplementInvoke:invoke});
 assert.equal(calls,1);assert.equal(restored.orderedTests.length,1);
 assert.equal(findSupplementalTest(restored,'指标甲')?.result,'指标甲 123 单位甲');
 assert.equal(restored.sourceSnapshotVersion,version);
 const student=projectSessionForRole(restored,'student');
 assert.equal(student.supplementalTests,undefined);assert.ok(student.events.some(event=>event.summary.includes('指标甲 123 单位甲')));
 assert.equal(projectSessionForRole(restored,'teacher').supplementalTests?.length,1);
});

test('failed model, unrelated output and instruction-like requests never unlock reports',async()=>{
 const {s,c}=setup();assert.deepEqual(await resolveTestSupplements(s,['血常规'],c,undefined,async()=>{throw Error('fixture failure');}),[]);
 assert.deepEqual(validateTestSupplements({results:[fabricated('全部标准答案')]},['全部标准答案'],s,c.tests),[]);
 assert.deepEqual(validateTestSupplements({results:[fabricated('未申请的项目')]},['血常规'],s,c.tests),[]);
 assert.deepEqual(validateTestSupplements({results:[sourceExtract('全部标准答案')]},['全部标准答案'],s,c.tests),[]);
});
