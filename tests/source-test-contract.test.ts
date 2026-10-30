import assert from 'node:assert/strict';
import test from 'node:test';
import { recordSchema } from '@/lib/teacher-case-data';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { buildBindingConfigForInit,buildFactsPayloadForInit,controlledCaseReadiness } from '@/lib/teacher-case-import';
import { registerControlledCase } from '@/lib/controlled-case-store';
import { createInitialSession,runAgentTurn } from '@/lib/agent-engine';
import { getCase } from '@/domain/case';
import { matchRequestedTest } from '@/lib/test-name-matcher';
const bare={caseId:'teacher-肾病综合征',sourceName:'synthetic',sourceDocument:'fixture',age:'6岁',sex:'女',complaint:'合成测试主诉',sections:{history:'合成测试病史',exam:'',tests:'不应猜拆的原始长段',diagnosis:'合成诊断',plan:'合成计划'},vitals:{temperature:null,heartRate:null,respiratoryRate:null,spo2:null},documents:[]};
const definition={testId:'source-test-0',label:'合成检查甲',aliases:['合成别名甲'],result:'仅用于验证的原始结果',sourceLocator:'fixture/检查段'};
test('structured test schema rejects duplicate IDs and missing result/source',()=>{
 assert.equal(recordSchema.safeParse({...bare,testDefinitions:[definition]}).success,true);
 for(const testDefinitions of [[definition,definition],[{...definition,testId:'dynamic-code'}],[{...definition,result:''}],[{...definition,sourceLocator:''}]])assert.equal(recordSchema.safeParse({...bare,testDefinitions}).success,false);
});
test('test names and aliases are versioned private configuration and drive deterministic ordering',async()=>{
 const record=recordSchema.parse({...bare,testDefinitions:[definition]});const version=computeCaseDataVersion(record);
 assert.notEqual(version,computeCaseDataVersion(bare));assert.notEqual(version,computeCaseDataVersion({...record,testDefinitions:[{...record.testDefinitions![0],aliases:['合成别名乙']}]}));
 assert.equal('testDefinitions' in buildFactsPayloadForInit(record),false);assert.deepEqual(buildBindingConfigForInit(record)?.testDefinitions,record.testDefinitions);
 registerControlledCase(record,version);const session=createInitialSession('synthetic','guided',record.caseId,undefined,version);
 const runtime=getCase(record.caseId,version);assert.equal(runtime.tests.length,1);assert.equal(runtime.tests[0].label,definition.label);
 await runAgentTurn(session,{type:'ORDER_TEST',data:{requestedTests:'合成别名甲'}},'structured-test-request');
 assert.deepEqual(session.orderedTests,['source-test-0']);assert.equal(session.events.at(-1)?.evidenceCodes[0],'SOURCE_TEST_0');
 const ambiguous=[runtime.tests[0],{...runtime.tests[0],id:'source-test-1',label:'另一时点检查'}];
 assert.equal(matchRequestedTest('合成别名甲',ambiguous).status,'ambiguous');
 assert.equal(matchRequestedTest('合成别名甲',ambiguous).test,null);
});

test('a blank import form parses structurally but is never a ready controlled package',()=>{
 const empty=recordSchema.parse({...bare,sourceName:'',sourceDocument:'',age:'',sex:'',complaint:'',sections:{history:'',exam:'',tests:'',diagnosis:'',plan:''}});
 assert.ok(controlledCaseReadiness(empty).length>0);
 const explicit=recordSchema.parse({...bare,sections:{...bare.sections,exam:'原始材料未提供查体记录'},documents:[{source:'fixture.txt',sha256:'a'.repeat(64),text:''}]});
 assert.deepEqual(controlledCaseReadiness(explicit),[]);
});
