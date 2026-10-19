import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRosterText } from '@/lib/class-roster';

test('名单允许单个编号，保留学号前导零和 CSV 转义', () => {
  assert.deepEqual(parseRosterText('\uFEFF姓名,cxid,学号\n张同学,123,\n"李,同学",,00123'), [
    { name: '张同学', cxid: '123', studentNo: '' }, { name: '李,同学', cxid: '', studentNo: '00123' },
  ]);
  assert.equal(parseRosterText('姓名\t学号\n王同学\t0001')[0].studentNo, '0001');
});
test('名单拒绝缺编号、重复、错误表头和不完整 CSV，不静默覆盖', () => {
  for (const source of ['姓名,cxid\n甲,', '姓名,cxid\n甲,1\n乙,1', '姓名\n甲', '姓名,cxid\n甲,1,2', '姓名,cxid\n"甲,1']) {
    assert.throws(() => parseRosterText(source));
  }
});
