import assert from 'node:assert/strict';
import test from 'node:test';
import {extractObjectiveTestReport} from '@/domain/test-report-extraction';
const specs=[{label:'血常规',pattern:/血常规|WBC|Hb|PLT/i},{label:'炎症指标',pattern:/CRP|PCT/i},{label:'血糖',pattern:/血糖|GLU/i},{label:'胸部CT',pattern:/胸部CT/i}];
test('合并一行报告拆成当前项目，其他化验结果和诊断不释放',()=>{
  const source='血常规：WBC 7.2，Hb 110，CRP 20，血糖 5.3。胸部CT：右肺片状影，未见胸腔积液，结论：某病诊断。';
  const cbc=extractObjectiveTestReport(source,'血常规',specs);
  assert.match(cbc,/7.2/);assert.match(cbc,/110/);assert.doesNotMatch(cbc,/20|5.3|CT|某病/);
  const ct=extractObjectiveTestReport(source,'胸部CT',specs);
  assert.match(ct,/片状影/);assert.match(ct,/未见胸腔积液/);assert.doesNotMatch(ct,/某病|诊断|血糖/);
});
test('同一片段多个检查无法安全拆分时保守不释放',()=>{
  assert.equal(extractObjectiveTestReport('血常规和CRP分别为一组混合结果','血常规',specs),'');
});
test('泛称影像不吞掉具体CT及连续所见，也不把CT结果当成未注明方式的报告',()=>{
  const markers=[{label:'胸部CT',pattern:/胸部CT/},{label:'胸部影像',pattern:/胸部|肺野/,fallbackFor:['胸部CT']}];
  const source='胸部CT：双肺片状影，肺野另见结节，未见胸腔积液。';
  assert.match(extractObjectiveTestReport(source,'胸部CT',markers),/结节/);
  assert.equal(extractObjectiveTestReport(source,'胸部影像',markers),'');
});
