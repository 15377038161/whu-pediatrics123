import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../public/models/anatomy/manifest.json';
test('儿童模型完整性：6岁来源、八区域、头颈表面、GLB与清单一致', () => {
  const binary=readFileSync('public/models/anatomy/piper-child-6yo.glb');
  assert.equal(binary.readUInt32LE(0),0x46546c67);
  assert.equal(binary.readUInt32LE(4),2);
  assert.equal(binary.readUInt32LE(8),binary.length);
  assert.equal(createHash('sha256').update(binary).digest('hex'),manifest.meshSha256);
  const doc=JSON.parse(binary.subarray(20,20+binary.readUInt32LE(12)).toString());
  assert.equal(manifest.age,6);assert.equal(doc.meshes.length,manifest.parts.length);
  assert.equal(new Set(manifest.parts.map(part => part.id)).size,manifest.parts.length);
  assert.equal(new Set(manifest.parts.map(part => part.region)).size,8);
  assert.ok(manifest.parts.some(part => part.sourcePart === 'HE_BO_ExternalTable'));
  assert.ok(manifest.parts.some(part => part.sourcePart === 'NK_BO_C1_2D'));
  assert.ok(manifest.parts.some(part => part.sourcePart === 'HE_BO_InternalTable'));
  assert.ok(manifest.sourceFiles['main_Head_Brain.k']);
  assert.equal(manifest.parts.find(part => part.id === '4114')?.label,'第1肋骨（左）');
  assert.equal(manifest.parts.find(part => part.id === '4136')?.region,'right-arm');
  assert.ok(manifest.parts.every(part => part.triangles>0));
  assert.ok(doc.accessors.filter((item:{type:string}) => item.type==='VEC3').every((item:{min:number[];max:number[]}) => [...item.min,...item.max].every(Number.isFinite)));
  assert.ok(readFileSync('public/models/anatomy/LICENSE.txt','utf8').includes('Any public release of any scientific claims'));
  assert.ok(readFileSync('public/models/anatomy/piper-corresponding-source.zip').length>1000);
  const dataStart=28+binary.readUInt32LE(12);
  for (const mesh of doc.meshes) {
    const primitive=mesh.primitives[0];
    const positions=doc.accessors[primitive.attributes.POSITION];
    const indices=doc.accessors[primitive.indices];
    const normals=doc.accessors[primitive.attributes.NORMAL];
    const indexStart=dataStart+doc.bufferViews[indices.bufferView].byteOffset;
    const normalStart=dataStart+doc.bufferViews[normals.bufferView].byteOffset;
    for (let i=0;i<indices.count;i++) assert.ok(binary.readUInt32LE(indexStart+i*4)<positions.count,'索引不得越界');
    for (let i=0;i<normals.count;i++) {
      const values=[0,4,8].map(offset => binary.readFloatLE(normalStart+i*12+offset));
      assert.ok(Math.abs(Math.hypot(...values)-1)<.0001,'法线必须有效且归一化');
    }
  }
});
