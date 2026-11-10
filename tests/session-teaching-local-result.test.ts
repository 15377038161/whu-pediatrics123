import test from 'node:test';
import assert from 'node:assert/strict';
import {teachingExamResult} from '../src/lib/session-teaching';
import type {TeachingExam} from '../src/domain/teaching-package';
const exam={origin:'source',scope:'whole-region',result:'整体原文中另一个部位的保留信息',technique:'本次检查手法',reaction:'本次配合反应',localSupplement:{result:'当前定位点的固定局部所见'}} as unknown as TeachingExam;
test('local operation releases only selected finding and preserves the private whole record',()=>{
 const before=JSON.stringify(exam),text=teachingExamResult(exam,'guided');
 assert.ok(text.includes(exam.localSupplement!.result));assert.ok(!text.includes(exam.result));
 assert.ok(text.includes(exam.technique));assert.ok(text.includes(exam.reaction));
 assert.equal(JSON.stringify(exam),before);
});
test('OSCE local result excludes teaching technique and reaction hints',()=>{
 const text=teachingExamResult(exam,'osce');assert.ok(text.includes(exam.localSupplement!.result));
 assert.ok(!text.includes(exam.result));assert.ok(!text.includes(exam.technique));assert.ok(!text.includes(exam.reaction));
});
test('old versions without a supplement keep their original result',()=>{
 const old={...exam,localSupplement:undefined};const text=teachingExamResult(old,'guided');
 assert.ok(text.includes(old.result));assert.ok(text.includes('【原记录】'));
});
test('OSCE reference items do not release patient conclusions',()=>{
 const text=teachingExamResult({...exam,origin:'reference',localSupplement:undefined},'osce');
 assert.ok(text.includes('缺少独立患者查体记录'));assert.ok(!text.includes(exam.result));
});
