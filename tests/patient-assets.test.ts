import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { patientAppearance } from '../src/domain/patient-appearance';
import {
  PATIENT_ASSETS,
  CAREGIVER_ASSETS,
  patientAssetByKey,
  bindingGapNote,
  ageBandLabel,
  sexPresentationLabel,
} from '../src/domain/patient-assets';

test('资产清单不变量：assetId 唯一、全部合成素材、全部未审核、素材文件存在', () => {
  const ids = new Set<string>();
  for (const asset of PATIENT_ASSETS) {
    assert.ok(!ids.has(asset.assetId), `assetId 重复：${asset.assetId}`);
    ids.add(asset.assetId);
    assert.equal(asset.isSynthetic, true, '全部素材为合成虚拟示教插画');
    assert.equal(asset.reviewStatus, 'unaudited', '无素材完成专业审核，不伪装已审核');
    assert.equal(asset.license, 'project_internal_unreviewed', '许可条款待确认，不声称已获授权');
    assert.ok(asset.note.includes('虚拟'), '素材说明必须携带虚拟示教口径');
    for (const [posture, src] of Object.entries(asset.sources)) {
      assert.ok(asset.postures.includes(posture as 'standing' | 'supine'), `postures 声明与 sources 不一致：${asset.assetId}/${posture}`);
      assert.ok(typeof src === 'string' && existsSync(`public${src}`), `素材文件缺失：${src}`);
    }
  }
  // 新生儿/婴儿素材仅卧位（该月龄不能站立）
  for (const asset of PATIENT_ASSETS.filter((a) => a.ageBand === 'newborn' || a.ageBand === 'infant')) {
    assert.deepEqual(asset.postures, ['supine'], `${asset.assetId} 仅提供仰卧体位`);
    assert.equal(asset.sources.standing, undefined, `${asset.assetId} 不得提供站立素材`);
  }
});

test('patient-appearance 渲染 key 与资产清单一一对齐（含新生儿/婴儿固定素材）', () => {
  // 学龄前通用角色：男女各两个，任一 caseId 两个体位同 key
  for (const sex of ['男', '女']) {
    for (let i = 0; i < 12; i++) {
      const caseId = `case-${i}`;
      const standing = patientAppearance(sex, 'standing', caseId);
      const asset = patientAssetByKey(standing.key);
      assert.ok(asset, `key=${standing.key} 未登记到资产清单`);
      assert.equal(asset.sexPresentation, sex === '女' ? 'female' : 'male');
      assert.ok(asset.postures.includes('standing'));
      assert.ok(asset.postures.includes('supine'));
    }
  }
  // 新生儿/婴儿：固定同性别卧位素材，请求站立也按卧位返回
  for (const [sex, ageKnown] of [['男', '3天'], ['女', '2小时'], ['男', '8个月'], ['女', '11个月']] as const) {
    const appearance = patientAppearance(sex, 'standing', `infant-${sex}`, ageKnown);
    const asset = patientAssetByKey(appearance.key);
    assert.ok(asset, `key=${appearance.key} 未登记`);
    assert.ok(asset.ageBand === 'newborn' || asset.ageBand === 'infant');
    assert.deepEqual(asset.postures, ['supine']);
    assert.ok(appearance.src === asset.sources.supine, '新生儿/婴儿渲染素材须与清单一致');
  }
  // 幼儿/学龄/青少年（2026-10-23 独立项 C）：分档专属 key 与清单对齐，站姿/仰卧同一 key
  for (const [sex, age, key] of [
    ['男', '2岁', 'toddler-boy'], ['女', '3岁', 'toddler-girl'],
    ['男', '9岁', 'school-boy'], ['女', '8岁', 'school-girl'],
    ['男', '13岁', 'adolescent-boy'], ['女', '14岁', 'adolescent-girl'],
  ] as const) {
    const standing = patientAppearance(sex, 'standing', `align-${key}`, age);
    const supine = patientAppearance(sex, 'supine', `align-${key}`, age);
    assert.equal(standing.key, key, `${age}${sex} 应路由到 ${key}`);
    assert.equal(supine.key, key, '站姿/仰卧须同一虚拟个体');
    const asset = patientAssetByKey(key);
    assert.ok(asset, `${key} 未登记到资产清单`);
    assert.ok(asset.ageBand === 'toddler' || asset.ageBand === 'school' || asset.ageBand === 'adolescent');
    assert.equal(asset.sexPresentation, sex === '女' ? 'female' : 'male');
    assert.ok(standing.src === asset.sources.standing && supine.src === asset.sources.supine, `${key} 渲染素材须与清单一致`);
  }
  // 性别未知：不绑定任何素材（不猜性别）
  for (const value of ['', '待核验', '性别未记录', '未知']) {
    const appearance = patientAppearance(value, 'standing', 'case-x');
    assert.equal(appearance.src, null);
    assert.equal(patientAssetByKey(appearance.key), null);
  }
});

test('年龄段素材登记（2026-10-23 独立项 C）：幼儿/学龄/青少年分档素材已补、缺口关闭，未审核口径不变', () => {
  for (const band of ['toddler', 'school', 'adolescent'] as const) {
    const assets = PATIENT_ASSETS.filter((a) => a.ageBand === band);
    assert.equal(assets.length, 2, `${band} 应有男女各一条分档素材`);
    for (const asset of assets) {
      assert.deepEqual(asset.postures, ['standing', 'supine'], `${asset.assetId} 双体位齐全`);
      assert.equal(asset.reviewStatus, 'unaudited', '分档素材仍未完成专业审核，不伪装已审核');
      assert.equal(asset.isSynthetic, true);
    }
    // 同龄素材缺口已补：bindingGapNote 不再登记「复用学龄前通用角色」缺口
    assert.equal(bindingGapNote(band), null, `${band} 缺口已关闭`);
  }
  assert.ok(bindingGapNote('newborn')?.includes('仰卧'));
  assert.ok(bindingGapNote('infant')?.includes('仰卧'));
});

test('照护者素材缺口如实登记：当前无任何家长/照护者头像', () => {
  assert.equal(CAREGIVER_ASSETS.length, 0, '照护者素材缺失为当前真实状态，不虚构素材');
});

test('人物背景标签口径：未知不猜', () => {
  assert.equal(ageBandLabel('newborn'), '新生儿');
  assert.equal(ageBandLabel('preschool'), '学龄前');
  assert.equal(ageBandLabel('unknown'), '年龄未知');
  assert.equal(ageBandLabel('不存在的档'), '年龄未知');
  assert.equal(sexPresentationLabel('男'), '男');
  assert.equal(sexPresentationLabel('女'), '女');
  assert.equal(sexPresentationLabel('待核验'), '性别未注明');
});
