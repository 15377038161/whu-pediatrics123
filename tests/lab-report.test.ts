import assert from 'node:assert/strict';
import test from 'node:test';
import {extractLabRows} from '@/domain/lab-report';
test('保留数值、比较符、单位与原始时间，不把参考范围填成患者结果',()=>{
  const rows=extractLabRows('2023-01-03 13点 血气：pH 6.83，HCO3-:<3.0mmol/L；2023-01-04 pH 7.35；血糖23.1mmol/L','血气分析');
  assert.equal(rows[0].value,'6.83');assert.equal(rows[0].reportedAt,'2023-01-03 13点');
  assert.equal(rows[1].value,'<3.0');assert.equal(rows[1].unit,'mmol/L');assert.equal(rows[2].reportedAt,'2023-01-04');
  assert.deepEqual(extractLabRows('双肺结节约3mm','胸部CT'),[]);
});
test('缺单位保留缺失标记，尿液定性结果不编造为具体数值',()=>{
  const rows=extractLabRows('尿蛋白+++；PLT 20','尿常规');
  assert.equal(rows[0].value,'+++');assert.equal(rows[1].unit,'原文未注明');
  assert.equal(rows.some(r=>r.value==='正常'),false);
});
