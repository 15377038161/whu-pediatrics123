import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EXAM_LOCATIONS} from '../src/domain/source-exam-contract';
import {instrumentsForSite} from '../src/domain/exam-anatomy';
import {ageMonths,detailedExamStandard,instrumentApplicability} from '../src/domain/exam-authoring-standard';
test('every existing tool/site has explicit normal, abnormal, units/reference and method',()=>{
 let count=0;
 for(const [site] of EXAM_LOCATIONS)for(const tool of instrumentsForSite(site)){
  const result=detailedExamStandard(tool,site);
  assert.ok(result.normal.length>15,`${tool}:${site}:normal`);
  assert.ok(result.abnormal.length>15,`${tool}:${site}:abnormal`);
  assert.ok(result.parameters.length>15,`${tool}:${site}:parameters`);
  assert.ok(result.technique.length>10);count++;
 }
 assert.ok(count>150);
});
test('age, thermometer and fontanelle applicability are explicit',()=>{
 assert.equal(ageMonths('8岁27天')!>96,true);
 assert.equal(ageMonths('6个月'),6);assert.equal(ageMonths('资料未提供'),null);
 assert.equal(instrumentApplicability('tympanic-thermometer','ears',2).status,'not_applicable');
 assert.equal(instrumentApplicability('tympanic-thermometer','ears',12).status,'applicable');
 assert.equal(instrumentApplicability('measuring-tape','fontanelle',4).status,'not_applicable');
 assert.equal(instrumentApplicability('stethoscope','eyes',96).status,'not_applicable');
 assert.equal(instrumentApplicability('standing-scale','growth',4).status,'not_applicable');
 assert.equal(instrumentApplicability('infant-scale','growth',96).status,'conditional');
});
test('standards do not mix visible and auscultatory patient results',()=>{
 assert.ok(!detailedExamStandard('inspection','right-lung-upper').normal.includes('呼吸音'));
 assert.ok(!detailedExamStandard('palpation','mitral-area').normal.startsWith('二尖瓣听诊区：心率'));
 assert.throws(()=>detailedExamStandard('stethoscope','eyes'),/UNMAPPED_TOOL_SITE/);
});
