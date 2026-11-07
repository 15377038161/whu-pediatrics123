import assert from 'node:assert/strict';
import test from 'node:test';
import { photoExamMap } from '@/domain/exam-photo-map';
import { PATIENT_ASSETS } from '@/domain/patient-assets';
import { ANATOMY_REGIONS } from '@/domain/exam-anatomy';

test('所有已登记人物体位均有独立照片定位，未知素材不套用另一张照片坐标',()=>{
  for(const asset of PATIENT_ASSETS)for(const posture of asset.postures){
    const map=photoExamMap(asset.assetId,posture,'rg-head-neck');
    assert.ok(map,`${asset.assetId}:${posture}`);
    assert.equal(map.regions.length,6);
    for(const point of map.regions)assert.ok(point.x>0&&point.x<100&&point.y>0&&point.y<100);
    for(const region of ANATOMY_REGIONS){
      const detail=photoExamMap(asset.assetId,posture,region.id)!;
      for(const point of detail.sites)assert.ok(point.x>=0&&point.x<=100&&point.y>=0&&point.y<=100);
    }
  }
  assert.equal(photoExamMap('unknown-person','standing','rg-head-neck'),null);
  assert.equal(photoExamMap('newborn-boy','standing','rg-head-neck'),null);
});

test('婴儿手部和新生儿手部按各自卧姿定位，不把成人垂手坐标放到婴儿腿上',()=>{
  for(const key of ['infant-boy','newborn-boy']){
    const map=photoExamMap(key,'supine','rg-upper-limb')!;
    assert.ok(map.sites.some(point=>point.id==='hands'));
    assert.ok(map.sites.some(point=>point.id==='finger'));
    const hand=map.sites.find(point=>point.id==='hands')!;
    const photoY=map.crop!.y+hand.y/100*map.crop!.height;
    const groin=map.regions.find(point=>point.id==='rg-groin')!;
    assert.ok(photoY<groin.y);
  }
});
