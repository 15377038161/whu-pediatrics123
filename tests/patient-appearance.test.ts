import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { patientAppearance, allowedPostures } from '../src/domain/patient-appearance';
import { parseAgeToDays, toAgeBand } from '../src/domain/communication-profile';
import summaries from '../src/domain/admission-summaries.json';
import { getPublicCase } from '../src/domain/case-catalog';

test('病例性别决定虚拟角色，两姿势固定同一个人且所有资源可部署', () => {
  const seen=new Set<string>();
  for (let i=0;i<20;i++) for (const sex of ['男','女']) {
    const standing=patientAppearance(sex,'standing',`case-${i}`,'4岁');
    const supine=patientAppearance(sex,'supine',`case-${i}`,'4岁');
    assert.equal(standing.key,supine.key);
    assert.ok(standing.key.startsWith(sex==='女' ? 'girl-' : 'boy-'));
    assert.deepEqual(standing,patientAppearance(sex,'standing',`case-${i}`,'4岁'));
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
  assert.ok(patientAppearance(' 女 ','standing','case','4岁').key.startsWith('girl-'));
});

/**
 * C01 修复回归：真实病例读入（admission-summaries.json）→ 目录投影（getPublicCase）
 * → 人物素材（patientAppearance）全链验证。新生儿与婴儿（≤1 岁）必须是同性别卧位
 * 婴儿形象，禁止站立儿童图与哈希兜底；未知年龄保持通用虚拟儿童（不虚构分档）。
 */
const NEWBORN_GIRL = '/media/clinical/virtual-newborn-girl-supine-v1.png';
const NEWBORN_BOY = '/media/clinical/virtual-newborn-boy-supine-v1.png';
/** 用户报告的原病例：出生 1 天女婴（皮肤黄染 1 天），真实存在于病例库。 */
const REPORTED_CASE_ID = 'case-e750c5ff-d229-43a6-8314-2e633cacdc32';

test('C01 真实病例链（用户报告原病例）：出生 1 天女婴投影为同性别卧位新生儿，非站立学龄前女孩', () => {
  const summary = (summaries as Record<string, { age: string; sex: string }>)[REPORTED_CASE_ID];
  assert.equal(summary.age, '1天');
  assert.equal(summary.sex, '女');
  // 目录投影（读入→投影）
  const profile = getPublicCase(REPORTED_CASE_ID);
  assert.equal(profile.patientImage, NEWBORN_GIRL);
  assert.ok(!profile.patientImage.includes('standing'));
  // 人物组件链（投影→素材）：站立体位请求也返回卧位形象，与目录投影同一素材
  const standing = patientAppearance('女', 'standing', REPORTED_CASE_ID, '1天');
  const supine = patientAppearance('女', 'supine', REPORTED_CASE_ID, '1天');
  assert.equal(standing.src, NEWBORN_GIRL);
  assert.equal(supine.src, NEWBORN_GIRL);
  assert.equal(standing.src, profile.patientImage);
  assert.ok(existsSync(`public${NEWBORN_GIRL}`));
});

test('C01 真实病例链：22 天男婴落新生儿卧位、6 岁女童保持通用虚拟儿童素材', () => {
  const newborn = getPublicCase('case-05779155-1092-4607-a3d2-966ffc0fc718');
  assert.equal((summaries as Record<string, { age: string }>)['case-05779155-1092-4607-a3d2-966ffc0fc718'].age, '22天');
  assert.equal(newborn.patientImage, NEWBORN_BOY);
  assert.ok(existsSync(`public${NEWBORN_BOY}`));
  const child = getPublicCase('case-5a51b3c9-ea4a-4c1b-96f8-20a9b59e44b7');
  assert.ok(child.patientImage.includes('virtual-child'));
  assert.notEqual(child.patientImage, NEWBORN_GIRL);
});

test('C01 全病例扫描：所有 ≤1 岁真实病例均为同性别卧位婴儿形象，无一使用站立儿童图', () => {
  const entries = Object.entries(summaries as Record<string, { age: string; sex: string }>);
  let youngInfantCount = 0;
  for (const [id, { age, sex }] of entries) {
    if (sex !== '男' && sex !== '女') continue;
    const band = toAgeBand(parseAgeToDays(age));
    const appearance = patientAppearance(sex, 'standing', id, age);
    if (band === 'newborn' || band === 'infant') {
      youngInfantCount += 1;
      assert.equal(appearance.src, sex === '女' ? NEWBORN_GIRL : NEWBORN_BOY, `${id}（${age}）应使用同性别卧位婴儿形象`);
      assert.ok(!appearance.src.includes('standing'), `${id}（${age}）不得使用站立儿童图`);
      // 新生儿/婴儿不参与哈希：同一病例重复解析稳定
      assert.equal(patientAppearance(sex, 'supine', id, age).key, appearance.key);
    } else {
      assert.ok(appearance.src === null || appearance.src.includes('virtual-child'), `${id}（${age}）应保持通用虚拟儿童素材`);
      assert.notEqual(appearance.src, NEWBORN_GIRL);
      assert.notEqual(appearance.src, NEWBORN_BOY);
    }
  }
  // 覆盖面自检：病例库确实存在足量 ≤1 岁真实病例（含天/小时/分钟/月多单位年龄表述）
  assert.ok(youngInfantCount >= 10, `≤1 岁病例数应 ≥ 10，实际 ${youngInfantCount}`);
});

test('C01 边界分档：1 天/28 天新生儿含边界，29 天起婴儿档，1 月/7 月婴儿均卧位，儿童站立体位正常', () => {
  assert.equal(patientAppearance('女', 'standing', 'x', '1天').src, NEWBORN_GIRL);
  assert.equal(patientAppearance('男', 'standing', 'x', '1天').src, NEWBORN_BOY);
  assert.equal(patientAppearance('女', 'standing', 'x', '28天').src, NEWBORN_GIRL);
  assert.equal(patientAppearance('男', 'standing', 'x', '29天').src, NEWBORN_BOY);
  assert.equal(patientAppearance('女', 'standing', 'x', '1月13天').src, NEWBORN_GIRL);
  assert.equal(patientAppearance('男', 'standing', 'x', '7月4天').src, NEWBORN_BOY);
  // 儿童档：站立请求返回站立图（通用虚拟儿童，哈希选择稳定）
  const childStanding = patientAppearance('女', 'standing', 'x', '8岁27天');
  assert.ok(childStanding.src !== null && /virtual-child/.test(childStanding.src));
  assert.ok(!childStanding.src.includes('newborn'));
  assert.equal(patientAppearance('女', 'standing', 'x', '8岁27天').key, childStanding.key);
});

test('未知年龄不猜学龄前：缺失、待核实和无法解析时均为明确占位', () => {
  const unknownAge = patientAppearance('女', 'standing', 'x', '待核验');
  assert.equal(unknownAge.src,null);
  assert.match(unknownAge.alt,/年龄未明确/);
  const noAge = patientAppearance('男', 'standing', 'x');
  assert.equal(noAge.src,null);
  for(const age of ['',undefined,'年龄未记录','无法解析']) for(const sex of ['男','女']) {
    assert.equal(patientAppearance(sex,'supine','a',age).src,null);
    assert.deepEqual(patientAppearance(sex,'standing','a',age),patientAppearance(sex,'standing','b',age));
  }
  assert.deepEqual(allowedPostures('待核验'), ['standing', 'supine']);
  assert.deepEqual(allowedPostures(undefined), ['standing', 'supine']);
  assert.deepEqual(allowedPostures(''), ['standing', 'supine']);
});

/**
 * 2026-10-23 独立项 C：幼儿/学龄/青少年分档专属素材路由。
 * 分档边界（communication-profile.toAgeBand）：toddler ≤3 岁、preschool ≤6 岁、
 * school <12 岁、adolescent ≥12 岁。站姿 v1/仰卧 v2 同一可识别个体（逐对图核通过）。
 */
test('独立项 C 年龄分档路由：幼儿/学龄/青少年使用分档专属素材，站姿/仰卧同一个体且文件存在', () => {
  const cases: Array<[string, '男' | '女', string, string]> = [
    ['2岁', '男', 'toddler-boy', 'virtual-child-toddler-boy'],
    ['2岁6个月', '女', 'toddler-girl', 'virtual-child-toddler-girl'],
    ['3岁', '男', 'toddler-boy', 'virtual-child-toddler-boy'], // toddler 上边界（≤3 岁）
    ['7岁', '女', 'school-girl', 'virtual-child-school-girl'],
    ['9岁', '男', 'school-boy', 'virtual-child-school-boy'],
    ['11岁', '女', 'school-girl', 'virtual-child-school-girl'], // school 上边界（<12 岁）
    ['12岁', '男', 'adolescent-boy', 'virtual-child-adolescent-boy'],
    ['14岁', '女', 'adolescent-girl', 'virtual-child-adolescent-girl'],
  ];
  for (const [age, sex, key, fragment] of cases) {
    const standing = patientAppearance(sex, 'standing', `band-${age}-${sex}`, age);
    const supine = patientAppearance(sex, 'supine', `band-${age}-${sex}`, age);
    assert.equal(standing.key, key, `${age}${sex} 应路由到 ${key}，实际 ${standing.key}`);
    assert.equal(supine.key, key, '站姿/仰卧须为同一虚拟个体');
    assert.ok(standing.src?.includes(`${fragment}-standing-v1`), `${age} 站姿素材路径`);
    assert.ok(supine.src?.includes(`${fragment}-supine-v2`), `${age} 仰卧素材路径（v2 竖构图）`);
    for (const item of [standing, supine]) { assert.ok(item.src); assert.ok(existsSync(`public${item.src}`), `素材缺失：${item.src}`); }
    assert.ok(!standing.src!.includes('newborn'), '分档素材不得与新生儿素材混淆');
  }
});

test('独立项 C 边界保持：学龄前（4-6 岁）仍走哈希通用素材，新生儿/婴儿固定卧位不受影响', () => {
  for (const age of ['4岁', '5岁', '6岁']) {
    const appearance = patientAppearance('女', 'standing', `band-keep-${age}`, age);
    assert.ok(/^(girl-a|girl-b)$/.test(appearance.key), `${age} 应保持学龄前哈希素材，实际 ${appearance.key}`);
    const boy = patientAppearance('男', 'standing', `band-keep-${age}`, age);
    assert.ok(/^(boy-a|boy-b)$/.test(boy.key), `${age} 应保持学龄前哈希素材，实际 ${boy.key}`);
  }
  assert.equal(patientAppearance('女', 'standing', 'band-keep-infant', '6个月').key, 'newborn-girl');
  assert.equal(patientAppearance('男', 'supine', 'band-keep-newborn', '15天').key, 'newborn-boy');
  assert.equal(patientAppearance('女', 'standing', 'band-keep-x', '待核验').src,null);
});

test('C01 allowedPostures：新生儿/婴儿（含 1 小时、10 分钟等窒息复苏病例年龄表述）仅仰卧', () => {
  assert.deepEqual(allowedPostures('1天'), ['supine']);
  assert.deepEqual(allowedPostures('28天'), ['supine']);
  assert.deepEqual(allowedPostures('29天'), ['supine']);
  assert.deepEqual(allowedPostures('1月13天'), ['supine']);
  assert.deepEqual(allowedPostures('7月4天'), ['supine']);
  assert.deepEqual(allowedPostures('1小时'), ['supine']);
  assert.deepEqual(allowedPostures('10分钟'), ['supine']);
  assert.deepEqual(allowedPostures('8岁27天'), ['standing', 'supine']);
  assert.deepEqual(allowedPostures('6岁'), ['standing', 'supine']);
});
