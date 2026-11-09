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

test('local ear and oropharyngeal morphology can be simulated despite unrelated systemic risks',()=>{
  const ear=fixture();ear.exams[0].toolId='otoscope';ear.exams[0].bodyPartId='ears';
  const earResult=reviseExamPackage(ear,'','先天性肌无力','双下肢水肿。').exams[0];
  assert.equal(earResult.origin,'teaching-simulation');
  assert.match(earResult.result,/外耳道|鼓膜/);
  assert.doesNotMatch(earResult.result,/腱反射|肌力/);
  const mouth=fixture();mouth.exams[0].toolId='tongue-depressor';mouth.exams[0].bodyPartId='mouth';
  const mouthResult=reviseExamPackage(mouth,'','先天性肌无力','双下肢水肿。').exams[0];
  assert.equal(mouthResult.origin,'teaching-simulation');
  assert.match(mouthResult.result,/咽部|扁桃体/);
  assert.doesNotMatch(mouthResult.result,/体温|耳温/);
});

test('local positives and critical illness keep independent morphology as reference',()=>{
  const cases:Array<[TeachingExam['toolId'],TeachingExam['bodyPartId'],string,string]>=[
    ['otoscope','ears','耳痛。',''],
    ['otoscope','ears','','危重病例'],
    ['tongue-depressor','mouth','咽部充血。',''],
    ['tongue-depressor','mouth','口唇发绀。','先天性肌无力'],
    ['reflex-hammer','knee','','先天性肌无力'],
    ['reflex-hammer','elbow','','周围性瘫痪'],
  ];
  for(const [tool,part,history,diagnosis] of cases){
    const pack=fixture();pack.exams[0].toolId=tool;pack.exams[0].bodyPartId=part;
    assert.equal(reviseExamPackage(pack,'',diagnosis,history).exams[0].origin,'reference',`${tool}:${part}`);
  }
});

test('measurement references expose units and recording conditions without inventing readings',()=>{
  const cases:Array<[TeachingExam['toolId'],TeachingExam['bodyPartId'],string]>=[
    ['axillary-thermometer','axilla','℃'],
    ['infrared-thermometer','forehead','℃'],
    ['tympanic-thermometer','ears','℃'],
    ['bp-cuff','upper-arm','mmHg'],
    ['oximeter','finger','次/分'],
    ['standing-scale','growth','kg'],
    ['infant-scale','growth','kg'],
    ['length-board','growth','cm'],
    ['stadiometer','growth','cm'],
    ['measuring-tape','growth','cm'],
    ['measuring-tape','scalp','cm'],
    ['measuring-tape','fontanelle','cm'],
  ];
  for(const [tool,part,unit] of cases){
    const pack=fixture();pack.exams[0].toolId=tool;pack.exams[0].bodyPartId=part;
    pack.exams[0].result='额部已有整体记录：T38.5℃。此处为旧版串科参考。';
    const exam=reviseExamPackage(pack,'','').exams[0];
    assert.equal(exam.origin,'reference',`${tool}:${part}`);
    assert.ok(exam.result.includes(unit),`${tool}:${part} result must include ${unit}`);
    assert.ok(exam.technique.includes(unit),`${tool}:${part} technique must include ${unit}`);
    assert.doesNotMatch(exam.result,/\d+(?:\.\d+)?\s*(?:℃|mmHg|cm|kg|g|次\/分|%)/,`${tool}:${part} invented a reading`);
    assert.doesNotMatch(exam.result,/额部已有整体记录|旧版串科参考/);
  }
});

test('fontanelle, reflex and plantar references require independent age-appropriate records',()=>{
  const fontanelle=fixture();fontanelle.exams[0].toolId='palpation';fontanelle.exams[0].bodyPartId='fontanelle';
  fontanelle.exams[0].result='额部已有整体记录：T38.5℃。';
  const fontanelleResult=reviseExamPackage(fontanelle,'','').exams[0];
  assert.equal(fontanelleResult.origin,'reference');
  assert.match(fontanelleResult.result,/前囟|年龄/);
  assert.doesNotMatch(fontanelleResult.result,/T38|额部已有整体记录/);

  const reflex=fixture();reflex.exams[0].toolId='reflex-hammer';reflex.exams[0].bodyPartId='knee';
  const reflexResult=reviseExamPackage(reflex,'','先天性肌无力').exams[0];
  assert.equal(reflexResult.origin,'reference');
  assert.match(reflexResult.result,/不补具体等级/);
  assert.match(reflexResult.technique,/左右侧/);

  const plantar=fixture();plantar.exams[0].toolId='reflex-hammer';plantar.exams[0].bodyPartId='plantar';
  const plantarResult=reviseExamPackage(plantar,'','').exams[0];
  assert.equal(plantarResult.origin,'reference');
  assert.match(plantarResult.result,/不虚构阴性/);
  assert.match(plantarResult.technique,/左右侧/);
});
