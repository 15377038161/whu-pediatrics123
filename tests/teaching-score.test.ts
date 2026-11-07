import assert from 'node:assert/strict';
import test from 'node:test';
import {gradeTeachingPoint,clinicalEvidenceRatio} from '@/domain/teaching-score';
import type {TeachingRubricItem} from '@/domain/teaching-package';
const point:TeachingRubricItem={id:'monitor',section:'plan',level:'basic',label:'监测血糖与电解质',maxScore:4,concepts:[['血糖'],['电解质','血钾']],evidenceCodes:[],fullAnswer:'监测血糖和电解质',partialAnswer:'只覆盖一项',incorrectAnswer:'未监测',safetyCritical:true,sourceLocator:'synthetic',unsafePhrases:[]};
test('查体观察解释留给教师复核，不因关键词命中或未命中自动判医学分',()=>{
  const manual={...point,id:'exam-interpret',section:'exam' as const,concepts:[['观察'],['提示']]};
  for(const text of ['观察提示异常','已经完成查体','']){
    const grade=gradeTeachingPoint(manual,text,new Set());
    assert.equal(grade.status,'not_assessable');assert.equal(grade.ratio,0);assert.match(grade.explanation,/教师/);
  }
});
test('简答、同义词满分，方向正确部分分，空话不能拿满分',()=>{
  assert.equal(gradeTeachingPoint(point,'血糖、血钾',new Set()).ratio,1);
  assert.equal(gradeTeachingPoint(point,'监测血糖',new Set()).ratio,.5);
  assert.equal(gradeTeachingPoint(point,'对症治疗',new Set()).ratio,0);
  assert.equal(gradeTeachingPoint(point,'不监测血糖，不需要复查电解质',new Set()).ratio,0);
});
test('有结果但未说明检查目的先给半分，重复证据不叠加',()=>{
  const check={...point,section:'tests' as const,evidenceCodes:['test-a'],concepts:[]};
  assert.equal(gradeTeachingPoint(check,'',new Set(['test-a'])).ratio,.5);
  assert.equal(gradeTeachingPoint(check,'',new Set(['test-a','test-a']),true).ratio,1);
  assert.equal(gradeTeachingPoint(check,'申请过',new Set(),true).ratio,0);
});
test('缺少可靠判据时不可评价，不用“提交过”冒充临床正确',()=>{
  assert.equal(gradeTeachingPoint({...point,concepts:[]},'补充内容',new Set()).status,'not_assessable');
});

test('危险措施只影响所属安全点，正确拒绝危险措施不扣分',()=>{
  const safety={...point,unsafePhrases:['静脉推注胰岛素']};
  assert.equal(gradeTeachingPoint(safety,'监测血糖和血钾，静脉推注胰岛素',new Set()).status,'incorrect');
  assert.equal(gradeTeachingPoint(safety,'监测血糖和血钾，不静脉推注胰岛素',new Set()).ratio,1);
  assert.equal(gradeTeachingPoint(safety,'监测血糖和血钾，不建议静脉推注胰岛素',new Set()).ratio,1);
});
test('概括诊断只得部分分，简称与大小写不影响完整诊断',()=>{
  const diagnosis={...point,concepts:[['糖尿病酮症酸中毒','DKA']],partialConcepts:[['糖尿病']],safetyCritical:false};
  assert.equal(gradeTeachingPoint(diagnosis,'dka',new Set()).ratio,1);
  assert.equal(gradeTeachingPoint(diagnosis,'糖尿病',new Set()).ratio,.5);
  assert.equal(gradeTeachingPoint(diagnosis,'否认糖尿病',new Set()).ratio,0);
});
test('病历模板占位不算有效书写，简短的临床记录不受字数限制',()=>{
  const note={...point,section:'note' as const,concepts:[['主诉'],['查体'],['诊断'],['计划']],safetyCritical:false};
  assert.equal(gradeTeachingPoint(note,'主诉：略；查体：同上；诊断：待补；计划：无',new Set()).ratio,0);
  assert.equal(gradeTeachingPoint(note,'主诉：多尿1周；查体：腹软；诊断：DKA；计划：监测血糖血钾',new Set()).ratio,1);
});
test('诊断依据需要实际临床内容，空标签和相反阴性不能得分',()=>{
  const records=[{area:'history',text:'咳嗽3天，无发热。'},{area:'exam',text:'双肺可闻湿啰音。'}];
  assert.equal(clinicalEvidenceRatio('依据病史、查体和检查',records),0);
  assert.equal(clinicalEvidenceRatio('有发热',records),0);
  assert.equal(clinicalEvidenceRatio('咳嗽3天',records),.5);
  assert.equal(clinicalEvidenceRatio('咳嗽伴双肺湿啰音，支持肺部疾病',records),1);
});
