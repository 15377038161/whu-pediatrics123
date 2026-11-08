import test from 'node:test';
import assert from 'node:assert/strict';
import {growthMeasurement,growthPosition,growthProtocol,GROWTH_TOOLS} from '../src/domain/growth-exam';
import {instrumentsForSite} from '../src/domain/exam-anatomy';
import {requiredExamPosition} from '../src/domain/exam-canvas';

test('measurement extraction releases only the requested quantity and original unit',()=>{
  const text='体重12.3kg，身高89cm；身长90cm，头围48.5cm。';
  assert.deepEqual(growthMeasurement('infant-scale',text),['体重12.3kg']);
  assert.deepEqual(growthMeasurement('standing-scale',text),['体重12.3kg']);
  assert.deepEqual(growthMeasurement('length-board',text),['身长90cm']);
  assert.deepEqual(growthMeasurement('stadiometer',text),['身高89cm']);
  assert.deepEqual(growthMeasurement('measuring-tape',text),['头围48.5cm']);
  assert.deepEqual(growthMeasurement('standing-scale','体重3200g'),['体重3200g']);
});
test('birth values, changes, parental measurements and dose units do not become patient readings',()=>{
  for(const text of ['出生体重3200g','出生时：体重3200g','母亲体重60kg','体重下降2kg','每公斤体重1mg/kg','体重12kg/天','体重偏低','体重12'])assert.deepEqual(growthMeasurement('standing-scale',text),[],text);
  assert.deepEqual(growthMeasurement('standing-scale','出生体重3200g，体重4.2kg'),['体重4.2kg']);
  assert.deepEqual(growthMeasurement('stadiometer','身长90cm'),[]);
});
test('growth tools are limited to growth site with explicit measurement positions',()=>{
  for(const tool of GROWTH_TOOLS){
    assert.ok(instrumentsForSite('growth').includes(tool));
    assert.equal(instrumentsForSite('eyes').includes(tool),false);
    assert.ok(growthProtocol(tool)?.technique);
    assert.match(growthProtocol(tool)!.normal,/不.*冒充患者读数/);
  }
  assert.equal(growthPosition('length-board'),'supine');
  assert.equal(growthPosition('stadiometer'),'standing');
  assert.equal(requiredExamPosition('rg-general','front','standing',['standing','supine'],'length-board'),'supine');
  assert.equal(requiredExamPosition('rg-general','front','supine',['standing','supine'],'stadiometer'),'standing');
  assert.equal(requiredExamPosition('rg-general','front','supine',['supine'],'stadiometer'),null,'do not offer unavailable positions');
  assert.match(growthProtocol('measuring-tape')!.technique,/不能测体重/);
});
