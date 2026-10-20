import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import audit from '../docs/anatomy-audit.json';
import summary from '../public/models/anatomy/audit-summary.json';
import manifest from '../public/models/anatomy/manifest.json';
import { anatomyStructures,structureNote } from '../src/domain/anatomy-structures';

test('核查绑定真实模型版本，不能将几何一致性标成医学审定或逐骨齐全',() => {
  const hash=(file:string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(audit.glbSha256,hash('public/models/anatomy/piper-child-6yo.glb'));
  assert.equal(audit.manifestSha256,hash('public/models/anatomy/manifest.json'));
  assert.equal(summary.modelSha256,manifest.meshSha256);
  assert.equal(summary.teachingAtlasComplete,false);
  assert.equal(summary.medicalReview,'not_performed');
  assert.equal(audit.geometryFidelityPassed,true);
  assert.ok(audit.geometryFidelity.every(item => item.missingTriangles===0 && item.extraTriangles===0));
});

test('桡骨/尺骨有源地标证据；骨盆推断标签和未定位结构不能被隐藏',() => {
  assert.equal(audit.forearmLandmarks.length,2);
  assert.ok(audit.forearmLandmarks.every(item => item.radiusLabelMatchesSourceLandmark && item.sourceComponents===2));
  const radius=anatomyStructures.find(item => item.label==='桡骨（左）')!;
  const pelvis=anatomyStructures.find(item => item.label==='髂骨（左）')!;
  assert.match(structureNote(radius),/地标/);
  assert.match(structureNote(pelvis),/推断/);
  assert.deepEqual(summary.ribsNumberedPerSide['左'],Array.from({length:11},(_,i) => i+1));
  assert.ok(summary.notIndividuallyIdentified.includes('第12肋骨（左）'));
  assert.ok(summary.notIndividuallyIdentified.includes('舌骨'));
  const keys=audit.namedInventory.map(item => `${item.region}:${item.name}`);
  assert.equal(new Set(keys).size,keys.length,'核对目标不能重复计数');
  assert.ok(audit.namedInventory.filter(item => item.region.endsWith('hand') || item.region.endsWith('foot')).every(item => item.status==='merged_unresolved'));
});
