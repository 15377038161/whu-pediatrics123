import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTeachingFeedback} from '../src/domain/teaching-score';
import type {SessionState} from '../src/domain/agent';
import type {TeachingPackage,TeachingRubricItem} from '../src/domain/teaching-package';
const item:TeachingRubricItem={id:'note-chief',section:'note',noteSection:'chiefComplaint',level:'basic',label:'主诉症状及病程',maxScore:3,concepts:[['咳嗽'],['一天','1天']],evidenceCodes:['HX_OK'],fullAnswer:'咳嗽一天',partialAnswer:'咳嗽',incorrectAnswer:'未记录',safetyCritical:false,sourceLocator:'synthetic',unsafePhrases:[]};
const session={mode:'guided',events:[],messages:[],orderedTests:[]} as unknown as SessionState;
const pack={rubricVersion:'note-primary-60-v1',version:'synthetic',rubric:[item],tests:[]} as unknown as TeachingPackage;
test('new scoring uses submitted section, not unsubmitted draft or another section',()=>{
 assert.equal(buildTeachingFeedback(session,pack,'咳嗽一天',{treatmentPlan:'咳嗽一天'}).totalScore,0);
 assert.equal(buildTeachingFeedback(session,pack,'',{chiefComplaint:'咳嗽一天'}).totalScore,3);
 assert.equal(buildTeachingFeedback(session,pack,'',{chiefComplaint:'咳嗽'}).totalScore,1.5);
});
test('process evidence does not automatically award note points',()=>{
 const observed={...session,events:[{correct:true,type:'CHECK_EXAM',evidenceCodes:['HX_OK'],summary:'已完成',id:'event'}]} as unknown as SessionState;
 assert.equal(buildTeachingFeedback(observed,pack,'',{chiefComplaint:''}).totalScore,0);
});
test('failed submission read is unassessable, valid empty submission is missing',()=>{
 assert.equal(buildTeachingFeedback(session,pack,'咳嗽一天').items[0].status,'not_assessable');
 assert.equal(buildTeachingFeedback(session,pack,'',{}).items[0].status,'missing');
});
test('legacy rubric still grades the original flattened note',()=>{
 const legacy={...pack,rubricVersion:undefined,rubric:[{...item,evidenceCodes:[]}]} as TeachingPackage;
 assert.equal(buildTeachingFeedback(session,legacy,'咳嗽一天').totalScore,3);
});
