import assert from 'node:assert/strict';
import test from 'node:test';
import { EXAM_LOCATIONS } from '../src/domain/source-exam-contract';
import { EXAM_REGIONS, SUPINE_ONLY_PARTS, partLabel, regionForPart } from '../src/domain/exam-regions';

const locationIds: readonly string[] = EXAM_LOCATIONS.map(([id]) => id);
const BUTTON_HEIGHT = 44;
const POSTURES = ['standing', 'supine'] as const;

test('6 大区覆盖全部子部位，且每个子部位只归属一个大区', () => {
  assert.equal(EXAM_REGIONS.length, 6);
  const owned = EXAM_REGIONS.flatMap((region) => [...region.parts]);
  assert.equal(new Set(owned).size, owned.length, '子部位被两个大区重复收录会让学生点到两次');
  assert.deepEqual([...owned].sort(), [...locationIds].sort());
  for (const region of EXAM_REGIONS) {
    assert.equal(regionForPart(region.parts[0])?.id, region.id);
    assert.ok(region.parts.length >= 3 && region.parts.length <= 7, `${region.id} 子部位数超出面板可点范围`);
  }
});

test('10 个旧部位 id 全部保留原名，在飞会话的已解锁证据码不作废', () => {
  for (const legacy of ['forehead', 'mouth', 'neck', 'chest', 'upper-arm', 'skin', 'abdomen', 'finger', 'hands', 'limbs']) {
    assert.ok(locationIds.includes(legacy), legacy);
    assert.ok(regionForPart(legacy), `${legacy} 未归入任何大区`);
  }
  assert.equal(locationIds.length, 24);
});

test('partLabel 全覆盖且不返回空串，未收录 id 原样回退暴露数据缺口', () => {
  for (const [id, label] of EXAM_LOCATIONS) {
    assert.equal(partLabel(id), label);
    assert.ok(label.trim().length > 0, id);
  }
  assert.equal(partLabel('no-such-part'), 'no-such-part');
  assert.equal(regionForPart('no-such-part'), null);
});

test('仰卧位限定部位都在册，且不含站姿即可完成的部位', () => {
  for (const part of SUPINE_ONLY_PARTS) {
    assert.ok(locationIds.includes(part), part);
    assert.ok(['abdomen', 'liver-spleen', 'groin'].includes(part), `${part} 不需要强制仰卧`);
  }
  for (const standing of ['chest', 'chest-lung', 'chest-heart', 'neck', 'limbs', 'spine']) {
    assert.equal(SUPINE_ONLY_PARTS.has(standing), false, standing);
  }
});

test('同栏大区锚点纵向间距不小于按钮高度，常驻 6 个按钮本身不重叠', () => {
  for (const posture of POSTURES) {
    for (const side of ['left', 'right'] as const) {
      const tops = EXAM_REGIONS.filter((region) => region.side === side)
        .map((region) => region.anchorTop[posture === 'supine' ? 1 : 0])
        .sort((a, b) => a - b);
      for (let i = 1; i < tops.length; i += 1) {
        // 最不利图框高 340px（新生儿方图）：百分比差要换算成像素仍够一个点击目标。
        assert.ok((tops[i] - tops[i - 1]) / 100 * 340 >= BUTTON_HEIGHT, `${side} 栏 ${posture} 第 ${i} 个锚点与前一个只差 ${(tops[i] - tops[i - 1])}%`);
      }
    }
  }
});
