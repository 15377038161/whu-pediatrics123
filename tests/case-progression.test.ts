import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLevelLocks } from '../src/domain/case-progression';

const ids = ['a', 'b', 'c', 'd'];

test('初始状态只有第一关解锁', () => {
  const locks = buildLevelLocks(ids, []);
  assert.deepEqual(locks.map((lock) => lock.unlocked), [true, false, false, false]);
  assert.deepEqual(locks.map((lock) => lock.level), [1, 2, 3, 4]);
});

test('完成第一关后第二关解锁，第三关仍锁', () => {
  const locks = buildLevelLocks(ids, [{ id: 's1', caseId: 'a', status: 'completed' }]);
  assert.deepEqual(locks.map((lock) => lock.unlocked), [true, true, false, false]);
  assert.equal(locks[0].completed, true);
});

test('当前可挑战关的进行中会话可继续', () => {
  const locks = buildLevelLocks(ids, [{ id: 's1', caseId: 'a', status: 'active' }]);
  assert.equal(locks.find((lock) => lock.caseId === 'a')?.unlocked, true);
  assert.equal(locks.find((lock) => lock.caseId === 'a')?.ongoing, true);
  assert.equal(locks.find((lock) => lock.caseId === 'b')?.unlocked, false);
});

test('后段进行中会话不能越过前面的未完成关', () => {
  const locks = buildLevelLocks(ids, [
    { id: 's1', caseId: 'a', status: 'active' },
    { id: 's2', caseId: 'c', status: 'active' },
  ]);
  assert.deepEqual(locks.map((lock) => lock.unlocked), [true, false, false, false]);
  assert.equal(locks.find((lock) => lock.caseId === 'c')?.ongoing, true);
});

test('完成前一关后只推进到下一关，后段 active 仍保持锁定', () => {
  const locks = buildLevelLocks(ids, [
    { id: 's1', caseId: 'a', status: 'completed' },
    { id: 's2', caseId: 'c', status: 'active' },
  ]);
  assert.deepEqual(locks.map((lock) => lock.unlocked), [true, true, false, false]);
  assert.equal(locks.find((lock) => lock.caseId === 'c')?.ongoing, true);
});

test('全部完成后不再有锁', () => {
  const locks = buildLevelLocks(ids, ids.map((caseId, index) => ({ id: `s${index}`, caseId, status: 'completed' })));
  assert.deepEqual(locks.map((lock) => lock.unlocked), [true, true, true, true]);
});

test('跳关完成不越过当前可挑战关卡：只解锁第一个未完成项', () => {
  const locks = buildLevelLocks(ids, [{ id: 's3', caseId: 'd', status: 'completed' }]);
  assert.equal(locks.find((lock) => lock.caseId === 'd')?.unlocked, true);
  assert.equal(locks.find((lock) => lock.caseId === 'a')?.unlocked, true);
  assert.equal(locks.find((lock) => lock.caseId === 'b')?.unlocked, false);
});

test('空病例列表与空会话不抛错', () => {
  assert.deepEqual(buildLevelLocks([], []), []);
});