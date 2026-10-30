import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClinicalEvent } from '@/domain/agent';
import {buildClinicalOperationRows} from '@/lib/clinical-operation-rows';
const event=(id:string,request:string,code:string,correct:boolean|null=null):ClinicalEvent=>({id,clientEventId:request,type:'ORDER_TEST',stage:'tests',summary:id,correct,evidenceCodes:code?[code]:[],createdAt:'2026-10-30T00:00:00Z'});
test('batch requests persist one stable row without losing evidence, summaries or media',()=>{
 const a=event('event-1','request-1','SOURCE_TEST_0',true);a.media=[{fileId:'synthetic-image',kind:'image',caption:'fixture'}];
 const b=event('event-2','request-1','SOURCE_TEST_1',true);b.media=a.media;
 const session={id:'session',events:[a,b,event('event-3','request-2','',null)]};
 const rows=buildClinicalOperationRows(session);assert.equal(rows.length,2);assert.equal(rows[0].id,'event-1');
 assert.deepEqual(rows[0].result.evidenceCodes,['SOURCE_TEST_0','SOURCE_TEST_1']);assert.equal(rows[0].payload.summary,'event-1\nevent-2');
 assert.equal(rows[0].payload.media?.length,1);assert.equal(rows[0].result.correct,true);assert.equal(rows[1].result.correct,null);
 assert.deepEqual(buildClinicalOperationRows(session),rows);
});
test('unmatched batch requests remain unscored and have a unique conflict key',()=>{
 const rows=buildClinicalOperationRows({id:'s',events:[event('1','r',''),event('2','r','')]});
 assert.equal(rows.length,1);assert.deepEqual(rows[0].result,{correct:null,evidenceCodes:[]});
 assert.equal(rows[0].payload.media,null);
});
