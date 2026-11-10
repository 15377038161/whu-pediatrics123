import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyExamSelections} from '../src/domain/exam-authoring-selection';
import type {TeachingPackage} from '../src/domain/teaching-package';
// 守卫测试在schema出口之前触发，不依赖真实病例或外部身份。
const pack={caseId:'fixture',sourceVersion:'source-v1',version:'teaching-v1',age:'2岁',exams:[{id:'original',origin:'source'},{id:'missing',origin:'reference',toolId:'inspection',bodyPartId:'ears'}]} as unknown as TeachingPackage;
const value={caseId:'fixture',sourceVersion:'source-v1',inputTeachingVersion:'teaching-v1',selections:[{id:'missing',state:'normal',result:'固定教学模拟：双侧耳廓形态对称，耳道口无可见异常分泌物。',rationale:'本例局部病史与已有记录不冲突的固定教学设定。',origin:'teaching-simulation'}]};
test('selection rejects stale binding without mutating original',()=>{
 const before=JSON.stringify(pack);assert.throws(()=>applyExamSelections(pack,{...value,inputTeachingVersion:'other'}),/BINDING_MISMATCH/);assert.equal(JSON.stringify(pack),before);
});
test('selection rejects changing original source or unknown row',()=>{
 assert.throws(()=>applyExamSelections(pack,{...value,selections:[{...value.selections[0],id:'original'}]}),/SOURCE_ROW_IS_IMMUTABLE/);
 assert.throws(()=>applyExamSelections(pack,{...value,selections:[{...value.selections[0],id:'other'}]}),/UNKNOWN_SELECTION/);
});
test('selection does not silently overwrite an existing fixed teaching result',()=>{
 const fixed={...pack,exams:[{id:'fixed',origin:'teaching-simulation',toolId:'inspection',bodyPartId:'ears'}]} as unknown as TeachingPackage;
 assert.throws(()=>applyExamSelections(fixed,{...value,selections:[{...value.selections[0],id:'fixed'}]}),/EXISTING_TEACHING_RESULT_IS_IMMUTABLE/);
});
