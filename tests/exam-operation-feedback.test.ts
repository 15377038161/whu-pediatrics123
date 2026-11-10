import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ExamOperationFeedback,type ExamObservation} from '../src/components/exam-region-panel';
const noop=()=>undefined;
const props={onClose:noop,onReplayAudio:noop};
const observation:ExamObservation={bodyPartId:'eyes',toolId:'inspection',status:'success',title:'视诊 · 眼',detail:'合成客观所见，只应在共享病例中展示',sound:null};
test('success is a compact acknowledgement without duplicating detailed findings over the patient',()=>{
 const html=renderToStaticMarkup(createElement(ExamOperationFeedback,{...props,observation}));
 assert.ok(html.includes('role="status"'));assert.ok(html.includes('视诊 · 眼已记录'));
 assert.ok(html.includes('共享病例记录'));assert.ok(!html.includes(observation.detail));
 assert.ok(!html.includes('exam-observation-detail'));assert.ok(!html.includes('ce-result'));
});
test('a blocked operation retains its precise error outside the patient figure',()=>{
 const error={...observation,status:'blocked' as const,detail:'器材与部位不匹配，请重新选择'};
 const html=renderToStaticMarkup(createElement(ExamOperationFeedback,{...props,observation:error,showReference:false}));
 assert.ok(html.includes('ce-feedback-error'));assert.ok(html.includes(error.detail));
 assert.ok(!html.includes('exam-technique-note'));assert.ok(!html.includes('ce-result'));
});
test('no observation produces no stale feedback',()=>{
 assert.equal(renderToStaticMarkup(createElement(ExamOperationFeedback,{...props,observation:null})), '');
});
