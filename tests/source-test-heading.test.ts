import assert from 'node:assert/strict';
import test from 'node:test';
import {trustedTestLabel} from '@/domain/case';
test('grouped source headings retain provenance while stripping dates and results',()=>{
 assert.equal(trustedTestLabel('1.辅检：外院（2020-01-01）血气分析：合成结果',0),'外院检查记录');
 assert.equal(trustedTestLabel('入院后相关检查：血气分析：合成结果',1),'入院后相关检查');
 assert.equal(trustedTestLabel('辅检：其他未分类资料',0),'检查记录 1');
 assert.equal(trustedTestLabel('血气分析：合成结果',0),'血气分析');
});
