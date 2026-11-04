import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CASE_INDEX_NUMBER,
  TEACHER_CASE_CATALOG,
} from '../src/domain/teacher-case-catalog';

test('67 入口沿用受控清单编号并保留已退出入口空号', () => {
  assert.equal(TEACHER_CASE_CATALOG.length, 67);
  assert.equal(Object.keys(CASE_INDEX_NUMBER).length, 67);
  assert.deepEqual(
    Object.values(CASE_INDEX_NUMBER).sort((left, right) => left - right),
    [...Array.from({ length: 61 }, (_, index) => index + 1), 63, 66, 67, 68, 69, 70],
  );
  for (const item of TEACHER_CASE_CATALOG) {
    assert.equal(typeof CASE_INDEX_NUMBER[item.id], 'number', item.id);
  }
});

test('主入口与别名使用新版编号而不继承旧数组下标', () => {
  assert.equal(CASE_INDEX_NUMBER['teacher-1型糖尿病伴有酮症酸中毒'], 1);
  assert.equal(CASE_INDEX_NUMBER['teacher-i型糖尿病伴有酮症酸中毒'], 54);
  assert.equal(CASE_INDEX_NUMBER['teacher-中枢性尿崩症'], 2);
  assert.equal(CASE_INDEX_NUMBER['teacher-噬血细胞综合征'], 12);
  assert.equal(CASE_INDEX_NUMBER['teacher-特发性血小板减少性紫癜'], 38);
  assert.equal(CASE_INDEX_NUMBER['teacher-蚕豆病'], 49);
  assert.equal(CASE_INDEX_NUMBER['teacher-新生儿胎粪吸入肺炎'], 63);
  assert.equal(CASE_INDEX_NUMBER['teacher-肺炎支原体性肺炎'], 70);
});
