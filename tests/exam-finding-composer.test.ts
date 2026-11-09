import test from 'node:test';
import assert from 'node:assert/strict';
import {composeExamFinding,hasAbnormalMarker,isAffirmativelyNormal,simulatedFinding,type ComposeRequest} from '../src/domain/exam-finding-composer';

const request:ComposeRequest={tool:'palpation',part:'hands',group:'limbs',protocolNormal:'一般正常参考',sourceExams:[],siteConcern:false,groupAbnormal:false,partLabel:'手部',groupLabel:'四肢'};
test('denied findings remain negative; a contrasting positive cannot become normal',()=>{
  for(const text of ['无水肿。','未见皮疹及出血点。','未闻及啰音。','双肺呼吸音清，未闻及干湿啰音。']){
    assert.equal(hasAbnormalMarker(text),false,text);
    assert.equal(isAffirmativelyNormal(text),true,text);
  }
  for(const text of ['无水肿，但可见发绀。','未闻及哮鸣音，右下肺可闻湿啰音。','咽充血，无脓点。'])assert.equal(hasAbnormalMarker(text),true,text);
});
test('exact source stays verbatim; a group finding never acquires local precision',()=>{
  assert.deepEqual(composeExamFinding({...request,sourceExams:[['palpation','hands','手部','左手局部压痛。']]}),{result:'左手局部压痛。',origin:'source',scope:'local',sourceRef:{tool:'palpation',part:'hands'}});
  const result=composeExamFinding({...request,tool:'stethoscope',part:'right-lung-lower',group:'chest-lung',partLabel:'右下肺',groupLabel:'双肺',sourceExams:[['stethoscope','chest-lung','肺部','右下肺湿啰音，左肺呼吸音清。']]});
  assert.equal(result.scope,'whole-region');
  assert.match(result.result,/不能|不把/);
});
test('different methods never substitute observations or disclose another requested result',()=>{
  const result=composeExamFinding({...request,tool:'otoscope',part:'ears',group:'ears',sourceExams:[['inspection','ears','耳','耳廓有皮疹。']]});
  assert.equal(result.origin,'reference');
  assert.equal(result.crossModality,true);
  assert.doesNotMatch(result.result,/耳廓有皮疹/);
});
test('abnormal or systemic context blocks blanket normal simulation',()=>{
  for(const context of [{siteConcern:true},{groupAbnormal:true}])assert.equal(composeExamFinding({...request,...context}).origin,'reference');
  assert.equal(composeExamFinding(request).origin,'teaching-simulation');
});
test('missing measurements and age-sensitive grading never invent readings',()=>{
  for(const [tool,part] of [['tympanic-thermometer','ears'],['bp-cuff','upper-arm'],['oximeter','finger'],['standing-scale','growth'],['palpation','fontanelle'],['palpation','plantar'],['palpation','liver-spleen']])assert.equal(simulatedFinding(tool,part,'部位'),null);
});
test('normal templates stay within the selected method and location',()=>{
  assert.doesNotMatch(simulatedFinding('palpation','elbow','肘部')!,/浮髌/);
  assert.doesNotMatch(simulatedFinding('palpation','hands','手部')!,/足背|桡动脉|充盈/);
  assert.doesNotMatch(simulatedFinding('inspection','chest-heart','心前区')!,/叩诊|心界/);
  assert.doesNotMatch(simulatedFinding('palpation','spine','脊柱')!,/叩击/);
  assert.doesNotMatch(simulatedFinding('stethoscope','abdomen','腹部')!,/振水声|次\/分/);
});
