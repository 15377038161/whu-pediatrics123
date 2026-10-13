import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuxiliaryTest } from '../src/domain/case';
import { matchRequestedTest, matchRequestedTests, normalizeTestName, splitRequestedTests } from '../src/lib/test-name-matcher';

/** 辅助检查自主文本申请的服务端确定性别名匹配（任务2）：
 *  同义词组归一、单向前缀、跨方式不互通、模糊输入不猜测扩展。 */

function catalogItem(id: string, label: string): AuxiliaryTest {
  return { id, label, indication: '', result: '', appropriate: null, evidenceCode: `EV_${id.toUpperCase()}` };
}

const CATALOG = [
  catalogItem('cbc', '血常规'),
  catalogItem('crp', 'C反应蛋白'),
  catalogItem('chest-xray', '胸片'),
  catalogItem('chest-ct', '胸部CT'),
  catalogItem('head-mri', '头颅MRI'),
  catalogItem('echo', '超声心动图'),
  catalogItem('cbc-five', '血常规五分类'),
];

test('normalizeTestName：全角转半角、去空白、大小写归一', () => {
  assert.equal(normalizeTestName('　血 常 规 '), '血常规');
  assert.equal(normalizeTestName('ＣＢＣ'), 'cbc');
  assert.equal(normalizeTestName('  CRP '), 'crp');
});

test('splitRequestedTests：中英文分隔符切分，空项过滤', () => {
  assert.deepEqual(splitRequestedTests('血常规，C反应蛋白、胸片'), ['血常规', 'C反应蛋白', '胸片']);
  assert.deepEqual(splitRequestedTests('血常规, CRP;胸片\n头颅CT'), ['血常规', 'CRP', '胸片', '头颅CT']);
  assert.deepEqual(splitRequestedTests('、，； \n'), []);
});

test('同义词组：输入与目录 label 归一到同一规范名即匹配', () => {
  assert.equal(matchRequestedTest('CBC', CATALOG).test?.id, 'cbc');
  assert.equal(matchRequestedTest('胸部X线', CATALOG).test?.id, 'chest-xray');
  assert.equal(matchRequestedTest('心脏彩超', CATALOG).test?.id, 'echo');
  assert.equal(matchRequestedTest('ecg', CATALOG).test, null, '目录无该项：未匹配而非猜测');
});

test('跨方式不互通：胸片≠胸部CT、脑电图≠MRI（fail-closed）', () => {
  assert.equal(matchRequestedTest('胸片', CATALOG).test?.id, 'chest-xray');
  assert.equal(matchRequestedTest('胸部CT', CATALOG).test?.id, 'chest-ct');
  // 目录只有头颅MRI，裸「CT」不带部位不得猜测映射到任一CT项
  assert.equal(matchRequestedTest('CT', CATALOG).test, null);
  assert.equal(matchRequestedTest('B超', CATALOG).test, null);
});

test('单向前缀：输入更具体可匹配（label 是输入前缀），反向不匹配', () => {
  assert.equal(matchRequestedTest('血常规（复查）', CATALOG).test?.id, 'cbc');
  assert.equal(matchRequestedTest('血常规复查', CATALOG).test?.id, 'cbc');
  // 输入「血常规」不得默认扩展到更具体的「血常规五分类」
  assert.equal(matchRequestedTest('血常规', CATALOG).test?.id, 'cbc');
  assert.notEqual(matchRequestedTest('血常规', CATALOG).test?.id, 'cbc-five');
});

test('匹配成功不代表有结果：只返回目录项，result 由病例资料决定', () => {
  const matched = matchRequestedTest('胸片', CATALOG);
  assert.ok(matched.test);
  assert.equal(matched.test.result, '');
  assert.equal(matched.requested, '胸片', '学生原文回显');
});

test('未匹配：原文回显 + test=null（不编造、不猜测）', () => {
  const unmatched = matchRequestedTest('头颅CTA', CATALOG);
  assert.equal(unmatched.test, null);
  assert.equal(unmatched.requested, '头颅CTA');
});

test('批量匹配：保持输入顺序，重复输入各自返回相同结果', () => {
  const results = matchRequestedTests(['胸片', '不存在项', '胸部X线'], CATALOG);
  assert.equal(results.length, 3);
  assert.equal(results[0].test?.id, 'chest-xray');
  assert.equal(results[1].test, null);
  assert.equal(results[2].test?.id, 'chest-xray');
  assert.equal(results[0].requested, '胸片');
  assert.equal(results[2].requested, '胸部X线');
});

test('更具体项目优先精确匹配，增强/CTA/合并方式不降级成基础项', () => {
  assert.equal(matchRequestedTest('血常规五分类', CATALOG).test?.id, 'cbc-five');
  assert.equal(matchRequestedTest('胸部CTA', CATALOG).test, null);
  assert.equal(matchRequestedTest('胸腹部CT', CATALOG).test, null);
  assert.equal(matchRequestedTest('CT', CATALOG).status, 'ambiguous');
  assert.equal(matchRequestedTest('胸片', [...CATALOG, catalogItem('chest2', '胸片')]).status, 'ambiguous');
});
