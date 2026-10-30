import assert from 'node:assert/strict';
import test from 'node:test';
import { recordSchema } from '@/lib/teacher-case-data';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { buildBindingConfigForInit,buildFactsPayloadForInit } from '@/lib/teacher-case-import';
import { registerControlledCase } from '@/lib/controlled-case-store';
import { createInitialSession,runAgentTurn } from '@/lib/agent-engine';
import { EXAM_LOCATIONS } from '@/domain/source-exam-contract';

const bare={caseId:'teacher-川崎病',sourceName:'synthetic',sourceDocument:'fixture',age:'6岁',sex:'女',complaint:'合成测试主诉',sections:{history:'合成测试病史',exam:'',tests:'',diagnosis:'合成诊断',plan:'合成计划'},vitals:{temperature:null,heartRate:null,respiratoryRate:null,spo2:null},documents:[]};
const rule={toolId:'palpation',bodyPartId:'abdomen',label:'合成腹部触诊',result:'仅供测试的原始片段',postures:['supine'],sourceLocator:'fixture/体检段'};
test('schema rejects unknown anatomy, duplicate mappings and empty source references',()=>{
 assert.equal(recordSchema.safeParse({...bare,examRules:[rule]}).success,true);
 for(const examRules of [[{...rule,bodyPartId:'unknown'}],[rule,rule],[{...rule,sourceLocator:''}],[{...rule,postures:[]}]])assert.equal(recordSchema.safeParse({...bare,examRules}).success,false);
});
test('reviewed posture/result edits change version; private rules stay out of student facts',()=>{
 const record=recordSchema.parse({...bare,examRules:[rule]});const legacy=computeCaseDataVersion(bare);
 assert.equal(computeCaseDataVersion({...bare,examRules:undefined}),legacy);
 assert.notEqual(computeCaseDataVersion(record),legacy);
 assert.notEqual(computeCaseDataVersion({...record,examRules:[{...record.examRules![0],postures:['standing']}]}),computeCaseDataVersion(record));
 assert.notEqual(computeCaseDataVersion({...record,examRules:[{...record.examRules![0],result:'合成修订'}]}),computeCaseDataVersion(record));
 assert.equal('examRules' in buildFactsPayloadForInit(record),false);
 assert.deepEqual(buildBindingConfigForInit(record)?.examRules,record.examRules);
 assert.equal(new Set(EXAM_LOCATIONS.map(([id])=>id)).size,10);
});
test('server blocks wrong and omitted posture before releasing a configured result',async()=>{
 const record=recordSchema.parse({...bare,examRules:[rule,{...rule,toolId:'inspection',bodyPartId:'limbs',label:'合成站立观察',postures:['standing']}]});
 const version=computeCaseDataVersion(record);registerControlledCase(record,version);
 const session=createInitialSession('synthetic-user','guided',record.caseId,undefined,version);
 await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands'}},'contract-preparation');
 const execute=async(posture?:'standing'|'supine')=>runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'palpation',bodyPartId:'abdomen',posture}},'contract-'+crypto.randomUUID());
 await execute();assert.equal(session.events.at(-1)?.correct,false);
 await execute('standing');assert.equal(session.events.at(-1)?.correct,false);
 assert.equal(session.unlockedEvidence.includes('SOURCE_EX_palpation_abdomen'),false);
 await execute('supine');assert.equal(session.events.at(-1)?.correct,true);
 await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'inspection',bodyPartId:'limbs',posture:'supine'}},'wrong-second-posture');
 assert.equal(session.events.at(-1)?.correct,false);
 await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'inspection',bodyPartId:'limbs',posture:'standing'}},'right-second-posture');
 assert.equal(session.events.at(-1)?.correct,true);
});
