import assert from 'node:assert/strict';
import test from 'node:test';
import { isPlaceholderDemographic, preferResolvedDemographics } from '../src/domain/demographics';

test('占位串判定：空值与三种未记录写法', () => {
  assert.equal(isPlaceholderDemographic(undefined), true);
  assert.equal(isPlaceholderDemographic(null), true);
  assert.equal(isPlaceholderDemographic(''), true);
  assert.equal(isPlaceholderDemographic('  '), true);
  assert.equal(isPlaceholderDemographic('年龄未记录'), true);
  assert.equal(isPlaceholderDemographic('性别未记录'), true);
});

test('真实年龄性别不当占位', () => {
  assert.equal(isPlaceholderDemographic('6岁'), false);
  assert.equal(isPlaceholderDemographic('女'), false);
  assert.equal(isPlaceholderDemographic('10分钟'), false);
});

test('快照为占位时沿用已解析值，真实值以快照为准', () => {
  assert.deepEqual(
    preferResolvedDemographics({ age: '6岁', sex: '女' }, { age: '年龄未记录', sex: '性别未记录' }),
    { age: '6岁', sex: '女' },
  );
  assert.deepEqual(
    preferResolvedDemographics({ age: '6岁', sex: '女' }, { age: '3岁', sex: '男' }),
    { age: '3岁', sex: '男' },
  );
  assert.deepEqual(
    preferResolvedDemographics({ age: '6岁', sex: '女' }, { age: '年龄未记录', sex: '男' }),
    { age: '6岁', sex: '男' },
  );
});