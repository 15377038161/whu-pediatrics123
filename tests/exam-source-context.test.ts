import test from 'node:test';
import assert from 'node:assert/strict';
import {hasAffirmedSourceMention,sourceHasSystemicExamConcern,sourceHasSystemicExamConcernForSite} from '../src/domain/exam-source-context';

test('negative source findings do not trigger the systemic-positive guard',()=>{
  for(const text of ['口唇无发绀，双下肢无水肿。','未见明显青紫、水肿及脱水表现。','否认肌无力。','水肿（-），发绀阴性。'])assert.equal(sourceHasSystemicExamConcern(text,''),false,text);
});
test('positive, uncertain and contrasting findings retain the conservative guard',()=>{
  for(const text of ['口唇发绀。','无发绀，但双下肢水肿。','无水肿而出现青紫。','未能排除休克。','脱水不能排除。','肌无力。','无发绀，稍后出现发绀。'])assert.equal(sourceHasSystemicExamConcern(text,''),true,text);
  assert.equal(sourceHasSystemicExamConcern('未见发绀。','低血容量性休克'),true);
});
test('brain-reference selection respects negation without treating uncertainty as normal',()=>{
  assert.equal(hasAffirmedSourceMention('无神经系统异常。',['脑','神经']),false);
  assert.equal(hasAffirmedSourceMention('不排除脑病。',['脑','神经']),true);
  assert.equal(hasAffirmedSourceMention('未见异常，脑室增宽。',['脑','神经']),true);
});

test('site-specific systemic guards preserve neuromuscular reflex conflicts',()=>{
  for(const part of ['elbow','knee']){
    assert.equal(sourceHasSystemicExamConcernForSite('','先天性肌无力','reflex-hammer',part),true);
    assert.equal(sourceHasSystemicExamConcernForSite('','周围性瘫痪','reflex-hammer',part),true);
  }
});

test('independent local morphology is not blocked by unrelated systemic findings',()=>{
  for(const [tool,part] of [['otoscope','ears'],['tongue-depressor','mouth']]){
    assert.equal(sourceHasSystemicExamConcernForSite('双下肢水肿。','先天性肌无力',tool,part),false,`${tool}:${part}`);
    assert.equal(sourceHasSystemicExamConcernForSite('','危重病例',tool,part),true,`${tool}:${part}`);
  }
});
