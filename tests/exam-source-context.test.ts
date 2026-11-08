import test from 'node:test';
import assert from 'node:assert/strict';
import {hasAffirmedSourceMention,sourceHasSystemicExamConcern} from '../src/domain/exam-source-context';

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
