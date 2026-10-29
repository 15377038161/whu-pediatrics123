import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_CATALOG } from '../src/domain/case-catalog';
import { getPublicCase, isTrainableCase } from '../src/lib/case-identity';
import { getCase } from '../src/domain/case';

test('合成演示病例不在活动目录且不能新建；历史定义保留', () => {
  assert.equal(CASE_CATALOG.length, 67);
  for (const id of ['peds-respiratory-001', 'peds-wheeze-002']) {
    assert.equal(isTrainableCase(id), false);
    assert.throws(() => getPublicCase(id), /CASE_NOT_FOUND/);
    assert.equal(getCase(id).id, id);
  }
});
