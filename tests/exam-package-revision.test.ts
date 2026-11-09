import test from 'node:test';
import assert from 'node:assert/strict';
import type {TeachingPackage,TeachingExam} from '../src/domain/teaching-package';
import {reviseExamPackage} from '../src/domain/exam-package-revision';

function fixture(origin:TeachingExam['origin']='reference'):TeachingPackage{
  return {title:'合成测试病例',rubric:[{id:'immutable-score'}],sourceVersion:'fixed-source',version:'old',tests:[{id:'unchanged-test'}],
    exams:[{id:'hands',toolId:'palpation',bodyPartId:'hands',origin,scope:'reference',result:'旧参考',evidenceCode:'fixed-code',media:[]},
      {id:'original',toolId:'inspection',bodyPartId:'mouth',origin:'source',scope:'local',result:'原始咽部异常，不允许修改',evidenceCode:'original-code',media:[]}]} as unknown as TeachingPackage;
}
test('new normal simulation does not mutate originals, scoring, media or the input object',()=>{
  const original=fixture(),snapshot=JSON.stringify(original),updated=reviseExamPackage(original,'','');
  assert.equal(JSON.stringify(original),snapshot);
  assert.equal(updated.exams[0].origin,'teaching-simulation');
  assert.deepEqual(updated.exams[1],original.exams[1]);
  assert.deepEqual(updated.rubric,original.rubric);assert.deepEqual(updated.tests,original.tests);
  assert.equal(updated.exams[0].evidenceCode,original.exams[0].evidenceCode);
});
test('history and diagnosis risks prevent blanket normals; previously simulated conflict is removed',()=>{
  for(const [exam,diagnosis,history] of [['','休克',''],['','','出现水肿。'],['双手局部压痛。','','']]){
    assert.equal(reviseExamPackage(fixture(),exam,diagnosis,history).exams[0].origin,'reference');
    assert.equal(reviseExamPackage(fixture('teaching-simulation'),exam,diagnosis,history).exams[0].origin,'reference');
  }
  const state=fixture();state.exams[0].toolId='inspection';state.exams[0].bodyPartId='general-state';
  assert.equal(reviseExamPackage(state,'','','精神反应差。').exams[0].origin,'reference');
  assert.equal(reviseExamPackage(fixture(),'','','无水肿。').exams[0].origin,'teaching-simulation');
});
