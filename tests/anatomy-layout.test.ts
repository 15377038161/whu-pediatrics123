import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Box3,PerspectiveCamera,Vector3 } from 'three';
import manifest from '../public/models/anatomy/manifest.json';
import { anatomyStructures } from '../src/domain/anatomy-structures';
import { fitAnatomyDistance,layoutAnatomy } from '../src/lib/anatomy-layout';

function actualBounds() {
  const binary=readFileSync('public/models/anatomy/piper-child-6yo.glb');
  const doc=JSON.parse(binary.subarray(20,20+binary.readUInt32LE(12)).toString());
  const boxes=new Map<string,Box3>();
  const whole=new Box3();
  for (const node of doc.nodes) {
    const accessor=doc.accessors[doc.meshes[node.mesh].primitives[0].attributes.POSITION];
    const box=new Box3(new Vector3(...accessor.min),new Vector3(...accessor.max));
    boxes.set(node.extras.id,box);whole.union(box);
  }
  const center=whole.getCenter(new Vector3()),scale=2.7/whole.getSize(new Vector3()).y;
  return anatomyStructures.map(structure => {
    const box=new Box3();
    for (const part of structure.parts) box.union(boxes.get(part.id)!);
    box.min.sub(center).multiplyScalar(scale);box.max.sub(center).multiplyScalar(scale);
    return { id:structure.id,region:structure.region,box };
  });
}

test('展示分组不丢网格、不重复计入，同一长骨的源分段保持同组',() => {
  const ids=anatomyStructures.flatMap(item => item.parts.map(part => part.id));
  assert.equal(ids.length,manifest.parts.length);
  assert.equal(new Set(ids).size,manifest.parts.length);
  for (const label of ['股骨（左）','胫骨（右）']) {
    const grouped=anatomyStructures.filter(item => item.label===label);
    assert.equal(grouped.length,1);assert.ok(grouped[0].parts.length>1);
  }
  assert.equal(anatomyStructures.filter(item => item.region==='skull').length,3,'材料层如实保留，不假称完整逐骨图谱');
});

test('真实 GLB 平铺：全景/单区域/单结构不重叠，保持原尺寸，手机和桌面镜头包含每一结构',() => {
  const all=actualBounds();
  for (const aspect of [.6,1,1.8]) for (const items of [all,all.filter(item => item.region==='thorax'),all.slice(0,1)]) {
    const layout=layoutAnatomy(items,aspect);
    const transformed=items.map(item => item.box.clone().translate(layout.offsets.get(item.id)!));
    const overview=new Box3();
    transformed.forEach((box,i) => {
      overview.union(box);
      assert.ok(box.getSize(new Vector3()).distanceTo(items[i].box.getSize(new Vector3()))<1e-10,'只能平移，不能单独缩放或变形');
      assert.ok(Math.abs(box.getCenter(new Vector3()).z)<1e-10,'结构中心在同一展示平面');
      for (let j=0;j<i;j++) {
        const other=transformed[j];
        assert.ok(box.max.x<=other.min.x || other.max.x<=box.min.x || box.max.y<=other.min.y || other.max.y<=box.min.y,`${items[i].id} 与 ${items[j].id} 投影重叠`);
      }
    });
    for (const section of layout.sections) overview.union(section.box);
    const camera=new PerspectiveCamera(38,aspect,.01,100);
    const center=overview.getCenter(new Vector3());
    camera.position.copy(center).add(new Vector3(0,0,fitAnatomyDistance(overview,38,aspect)));
    camera.lookAt(center);camera.updateMatrixWorld();
    for (const box of transformed) for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
      const screen=new Vector3(x,y,z).project(camera);
      assert.ok(Math.abs(screen.x)<1 && Math.abs(screen.y)<1,'不能裁切展开后的结构');
    }
  }
  assert.equal(layoutAnatomy([],1).offsets.size,0);
});
