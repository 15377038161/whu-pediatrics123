import test from 'node:test';
import assert from 'node:assert/strict';
import {examCanvasMap,EXAM_BACK_TEMPLATE,requiredExamPosition} from '../src/domain/exam-canvas';
import {photoExamMap} from '../src/domain/exam-photo-map';
import {existsSync} from 'node:fs';

test('single canvas converts local coordinates back to the full image, and uses the same image for zoom',()=>{
  for(const posture of ['standing','supine'] as const)for(const region of ['rg-head-neck','rg-chest','rg-abdomen','rg-upper-limb','rg-lower-limb']){
    const local=photoExamMap('school-girl',posture,region)!;
    const full=examCanvasMap('school-girl',posture,region,'front',false);
    const zoom=examCanvasMap('school-girl',posture,region,'front',true);
    assert.equal(full.image,null);assert.equal(full.crop,undefined);assert.deepEqual(zoom.crop,local.crop);
    for(const point of full.sites){const inside=zoom.sites.find(p=>p.id===point.id)!;assert.ok(Math.abs(point.x-(local.crop!.x+inside.x/100*local.crop!.width))<.00001);assert.ok(point.y>=0&&point.y<=100);}
  }
});
test('general examinations retain the full patient image and back uses a real shared teaching image',()=>{
  const general=examCanvasMap('school-girl','standing','rg-general','front',true);
  assert.equal(general.image,null);assert.equal(general.crop,undefined);assert.equal(general.regions.length,6);
  assert.ok(existsSync('public'+EXAM_BACK_TEMPLATE));
  const back=examCanvasMap('school-girl','supine','rg-back','back',false);
  assert.equal(back.image,EXAM_BACK_TEMPLATE);assert.equal(back.sites.length,4);
  assert.ok(back.sites.find(p=>p.id==='left-kidney')!.x<back.sites.find(p=>p.id==='right-kidney')!.x);
});
test('unknown assets do not borrow another child’s pins and no plantar pin is placed on a shoe',()=>{
  assert.deepEqual(examCanvasMap(undefined,'standing',null,'front',false).regions,[]);
  assert.equal(examCanvasMap('school-girl','standing','rg-lower-limb','front',false).sites.some(p=>p.id==='plantar'),false);
});

test('position prompts appear only when needed and never request an unsupported legacy position',()=>{
  assert.equal(requiredExamPosition(null,'front','standing',['standing','supine']),null);
  assert.equal(requiredExamPosition('rg-abdomen','front','standing',['standing','supine']),'supine');
  assert.equal(requiredExamPosition('rg-abdomen','front','supine',['supine']),null);
  assert.equal(requiredExamPosition('rg-back','back','supine',['standing','supine']),'standing');
  assert.equal(requiredExamPosition('rg-back','back','supine',['supine','lateral']),'lateral');
  assert.equal(requiredExamPosition('rg-back','back','supine',['supine']),null);
});
