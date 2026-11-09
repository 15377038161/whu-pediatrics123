import assert from 'node:assert/strict';
import test from 'node:test';
import type {SessionState} from '../src/domain/agent';
import {normalizeNoteContent} from '../src/domain/medical-note';
import {noteFromReleasedRecords,fillEmptyNoteSections} from '../src/domain/note-record-import';

test('仅从已释放记录导入，错误查体和内部答案不进入病历',()=>{
 const session={events:[
  {id:'ok',type:'EXAM_ACTION',correct:true,evidenceCodes:['OBS'],summary:'已查体：呼吸观察记录'},
  {id:'bad',type:'EXAM_ACTION',correct:false,evidenceCodes:['BLOCK'],summary:'错误操作提示'},
  {id:'test',type:'ORDER_TEST',correct:true,evidenceCodes:[],summary:'已申请检查，结果待回报'},
 ],messages:[],internalAnswer:'不应读到'} as unknown as Pick<SessionState,'events'|'messages'>;
 const content=noteFromReleasedRecords(session);
 assert.match(content.physicalExam??'',/呼吸观察/);
 assert.doesNotMatch(JSON.stringify(content),/错误操作|不应读到/);
 assert.match(content.auxiliaryTests??'',/待回报/);
 assert.equal(content.preliminaryDiagnosis,undefined);
 assert.equal(content.treatmentPlan,undefined);
});

test('导入只填空白，不覆盖已写内容，重复导入不重复追加',()=>{
 const draft=normalizeNoteContent({physicalExam:'学生已整理的查体'});
 const records={physicalExam:'新记录',presentIllness:'已获得的病史'};
 const next=fillEmptyNoteSections(draft,records);
 assert.equal(next.physicalExam,draft.physicalExam);
 assert.equal(next.presentIllness,'已获得的病史');
 assert.deepEqual(fillEmptyNoteSections(next,records),next);
 assert.equal(draft.presentIllness,'');
});
