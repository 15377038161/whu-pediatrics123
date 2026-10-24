import assert from 'node:assert/strict';
import test from 'node:test';
import { postureAllows, sourceExamDefinitions } from '../src/domain/exam-methods';

test('乳房发育视诊与结节触诊分别取原文，不用心肺听诊替代', () => {
  const records = sourceExamDefinitions('双侧乳房结节约3*3cm，Tanner分期B2期，乳晕颜色稍深，双肺呼吸音清。');
  const result = (method: string) => records.find(row => row[0] === method && row[1] === 'chest')?.[3] ?? '';
  assert.equal(result('inspection'), 'Tanner分期B2期，乳晕颜色稍深');
  assert.equal(result('palpation'), '双侧乳房结节约3*3cm');
  assert.equal(result('stethoscope'), '双肺呼吸音清');
  assert.equal(sourceExamDefinitions('乳房未见发育。').find(row => row[0] === 'inspection' && row[1] === 'chest')?.[3], '乳房未见发育');
  assert.equal(sourceExamDefinitions('胸廓对称。').find(row => row[0] === 'palpation' && row[1] === 'chest')?.[3], '');
});

test('源记录中的结膜和巩膜证据可由头面检查取得，不混入口咽结果', () => {
  const records = sourceExamDefinitions('结膜充血，巩膜黄染，咽红，扁桃体不大。');
  assert.equal(records.find(row => row[0] === 'flashlight')?.[3], '结膜充血，巩膜黄染');
  assert.equal(records.find(row => row[0] === 'tongue-depressor')?.[3], '咽红，扁桃体不大');
  assert.equal(sourceExamDefinitions('结膜无充血。').find(row => row[0] === 'flashlight')?.[3], '结膜无充血');
});

test('浅表淋巴结记录由颈部触诊取得，阳性阴性均保留，不混入头面检查', () => {
  // 川崎病原文形态：淋巴结肿大连同质地/触痛续段描述完整吸收，不被其他查体截走
  const records = sourceExamDefinitions('T 36.5℃，颈软，颈部及腹股沟浅表淋巴结可触及肿大，质韧活动可，无触痛，结膜充血，咽红。');
  const neck = (method: string) => records.find(row => row[0] === method && row[1] === 'neck')?.[3] ?? '';
  assert.equal(neck('palpation'), '颈部及腹股沟浅表淋巴结可触及肿大，质韧活动可，无触痛');
  assert.equal(neck('inspection'), '颈软');
  assert.equal(records.find(row => row[0] === 'flashlight')?.[3], '结膜充血');
  // 含“耳”“头”字样的淋巴结描述不得被头面检查规则抢走；大小/质地/融合续段完整保留
  const multiSite = sourceExamDefinitions('枕部、耳前耳后、颈前颈后、颌下、腋下、腹股沟可扪及数枚肿大淋巴结，大小约1.2*1.7cm左右，质硬，相互融合成片状，无触痛，双眼睑无水肿。');
  assert.equal(multiSite.find(row => row[0] === 'palpation' && row[1] === 'neck')?.[3], '枕部、耳前耳后、颈前颈后、颌下、腋下、腹股沟可扪及数枚肿大淋巴结，大小约1.2*1.7cm左右，质硬，相互融合成片状，无触痛');
  assert.equal(multiSite.find(row => row[0] === 'flashlight')?.[3], '双眼睑无水肿');
  // 关键阴性同样可取得；阴性后不吸收续段，皮肤表现（咖啡斑）不误入淋巴结触诊
  const negative = sourceExamDefinitions('浅表淋巴结未扪及肿大，腹股沟处可见最大约8*8cm咖啡斑。');
  assert.equal(negative.find(row => row[0] === 'palpation' && row[1] === 'neck')?.[3], '浅表淋巴结未扪及肿大');
  // 无淋巴结记录时不生成颈部触诊结果
  assert.equal(sourceExamDefinitions('颈软，双肺呼吸音清。').find(row => row[0] === 'palpation' && row[1] === 'neck')?.[3] ?? '', '');
});

test('脑膜刺激征“颈稍抵抗”归入颈部视诊，不虚构正常颈软', () => {
  const records = sourceExamDefinitions('颈稍抵抗，克氏征阳性。');
  assert.equal(records.find(row => row[0] === 'inspection' && row[1] === 'neck')?.[3], '颈稍抵抗');
  assert.equal(records.find(row => row[0] === 'reflex-hammer')?.[3], '克氏征阳性');
});

test('腹部视触叩听与反射分别取对应原文片段，不传播完整查体答案', () => {
  const records = sourceExamDefinitions('腹稍胀，无压痛，移动浊音（+），肠鸣音正常，双下肢水肿，膝反射存在。');
  const result = (method: string, part: string) => records.find(row => row[0] === method && row[1] === part)?.[3] ?? '';
  assert.equal(result('inspection', 'abdomen'), '腹稍胀');
  assert.equal(result('palpation', 'abdomen'), '无压痛');
  assert.equal(result('percussion', 'abdomen'), '移动浊音（+）');
  assert.equal(result('stethoscope', 'abdomen'), '肠鸣音正常');
  assert.equal(result('reflex-hammer', 'limbs'), '膝反射存在');
  assert.ok(!result('palpation', 'abdomen').includes('肠鸣音'));
});
test('出血点/瘀点瘀斑归入皮肤视诊，牙龈出血归入口咽，不遗漏皮肤黏膜出血证据（ITP 实审驱动）', () => {
  // ITP 原文形态：皮肤出血体征此前不命中任何查体关键词而整体丢失
  const records = sourceExamDefinitions('全身可见散在针尖样出血点，颈部可见出血点融合成片，牙龈出血，咽充血，颈软。');
  assert.equal(records.find(row => row[0] === 'inspection' && row[1] === 'skin')?.[3], '全身可见散在针尖样出血点，颈部可见出血点融合成片');
  assert.equal(records.find(row => row[0] === 'tongue-depressor' && row[1] === 'mouth')?.[3], '牙龈出血，咽充血');
  // “颈部可见出血点融合成片”是皮肤表现，不得被颈部淋巴结触诊抢走
  assert.equal(records.find(row => row[0] === 'palpation' && row[1] === 'neck')?.[3] ?? '', '');
});

test('痰鸣音归入心肺听诊，呼吸稍促归入胸部视诊，震颤归入胸部触诊', () => {
  const records = sourceExamDefinitions('呼吸稍促，可见轻度吸气三凹征，双肺呼吸音粗，可闻及痰鸣音，无震颤。');
  assert.equal(records.find(row => row[0] === 'stethoscope' && row[1] === 'chest')?.[3], '双肺呼吸音粗，可闻及痰鸣音');
  assert.equal(records.find(row => row[0] === 'inspection' && row[1] === 'chest')?.[3], '呼吸稍促，可见轻度吸气三凹征');
  assert.equal(records.find(row => row[0] === 'palpation' && row[1] === 'chest')?.[3], '无震颤');
  // 痰鸣音不得串入腹部听诊（肠鸣音仍归腹部）
  const mixed = sourceExamDefinitions('可闻及痰鸣音，肠鸣音正常。');
  assert.equal(mixed.find(row => row[0] === 'stethoscope' && row[1] === 'abdomen')?.[3], '肠鸣音正常');
  assert.equal(mixed.find(row => row[0] === 'stethoscope' && row[1] === 'chest')?.[3], '可闻及痰鸣音');
});

test('神经系统阴性体征归入神经系统与反射检查，不丢失关键阴性（ITP 颅内出血警示评估）', () => {
  const records = sourceExamDefinitions('神经系统查体无异常，四肢肌力肌张力正常，膝反射存在。');
  assert.equal(records.find(row => row[0] === 'reflex-hammer')?.[3], '神经系统查体无异常，四肢肌力肌张力正常，膝反射存在');
  // 肌张力不得同时混入四肢视诊
  assert.equal(records.find(row => row[0] === 'inspection' && row[1] === 'limbs')?.[3] ?? '', '');
});

test('没有记录不补正常值；腹部新请求需仰卧，历史请求保留兼容', () => {
  assert.ok(sourceExamDefinitions('').every(row => !row[3]));
  assert.equal(postureAllows('abdomen', 'standing'), false);
  assert.equal(postureAllows('abdomen', 'supine'), true);
  assert.equal(postureAllows('abdomen'), true);
  assert.equal(postureAllows('chest', 'standing'), true);
});
