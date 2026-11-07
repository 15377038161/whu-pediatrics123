import assert from 'node:assert/strict';
import test from 'node:test';
import { ANATOMY_REGIONS, EXAM_INSTRUMENTS, instrumentsForSite } from '@/domain/exam-anatomy';
import { EXAM_LOCATIONS } from '@/domain/source-exam-contract';
import { SUPINE_ONLY_PARTS, partLabel } from '@/domain/exam-regions';
import { examProtocol } from '@/domain/exam-protocol';

test('新目录覆盖全部规范部位，左右肺野按患者方向定位',()=>{
  const sites=ANATOMY_REGIONS.flatMap(r=>r.sites);
  assert.equal(ANATOMY_REGIONS.length,8);
  assert.equal(new Set(sites.map(s=>s.id)).size,sites.length);
  assert.deepEqual(sites.map(s=>s.id).sort(),EXAM_LOCATIONS.map(([id])=>id).sort());
  assert.ok(sites.find(s=>s.id==='right-lung-upper')!.x<50);
  assert.ok(sites.find(s=>s.id==='right-lung-back')!.x>50);
  for(const site of sites)assert.ok(site.x>0&&site.x<100&&site.y>0&&site.y<100);
});
test('三个测温器材分开，错误部位不可选；肌力不用叩诊锤代替',()=>{
  assert.ok(instrumentsForSite('axilla').includes('axillary-thermometer'));
  assert.equal(instrumentsForSite('forehead').includes('axillary-thermometer'),false);
  assert.ok(instrumentsForSite('forehead').includes('infrared-thermometer'));
  assert.ok(instrumentsForSite('ears').includes('tympanic-thermometer'));
  assert.equal(instrumentsForSite('upper-limb-power').includes('reflex-hammer'),false);
});
test('可选操作均有规范说明，旧部位标签仍可读',()=>{
  const tools=new Map(EXAM_INSTRUMENTS.map(t=>[t.id,t]));
  for(const [id,label] of EXAM_LOCATIONS){
    assert.equal(partLabel(id),label);
    for(const tool of instrumentsForSite(id)){
      assert.ok(tools.has(tool));assert.ok(examProtocol(tool,id)?.technique);
      if(!['inspection','palpation','percussion'].includes(tool))assert.ok(tools.get(tool)?.image);
    }
  }
  assert.equal(partLabel('unregistered'),'unregistered');
  for(const id of SUPINE_ONLY_PARTS)assert.ok(EXAM_LOCATIONS.some(([part])=>id===part));
});
