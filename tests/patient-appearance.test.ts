import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { patientAppearance } from '../src/domain/patient-appearance';
test('病例性别决定虚拟角色，两姿势固定同一个人且所有资源可部署', () => {
  const seen=new Set<string>();
  for (let i=0;i<20;i++) for (const sex of ['男','女']) {
    const standing=patientAppearance(sex,'standing',`case-${i}`);
    const supine=patientAppearance(sex,'supine',`case-${i}`);
    assert.equal(standing.key,supine.key);
    assert.ok(standing.key.startsWith(sex==='女' ? 'girl-' : 'boy-'));
    assert.deepEqual(standing,patientAppearance(sex,'standing',`case-${i}`));
    assert.notEqual(standing.src,supine.src);
    for (const item of [standing,supine]) { assert.ok(item.src);assert.ok(existsSync(`public${item.src}`)); }
    seen.add(standing.key);
  }
  assert.equal(seen.size,4);
});
test('性别缺失不猜男孩，不从患者姓名或病种推断性别', () => {
  for (const value of ['','待核验','性别未记录','未知']) {
    assert.equal(patientAppearance(value,'standing','case-girl-name').src,null);
    assert.equal(patientAppearance(value,'supine','case-boy-name').src,null);
  }
  assert.ok(patientAppearance(' 女 ','standing','case').key.startsWith('girl-'));
});
