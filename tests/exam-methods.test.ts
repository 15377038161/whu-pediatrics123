import assert from 'node:assert/strict';
import test from 'node:test';
import { postureAllows, sourceExamDefinitions } from '../src/domain/exam-methods';
import { SUPINE_ONLY_PARTS } from '../src/domain/exam-regions';

const result = (records: string[][], method: string, part?: string) =>
  records.find(row => row[0] === method && (part === undefined || row[1] === part))?.[3] ?? '';
const at = (text: string, method: string, part?: string) => result(sourceExamDefinitions(text), method, part);

test('乳房发育视诊与结节触诊分别取原文，不用心肺听诊替代', () => {
  const records = sourceExamDefinitions('双侧乳房结节约3*3cm，Tanner分期B2期，乳晕颜色稍深，双肺呼吸音清。');
  assert.equal(result(records, 'inspection', 'breast'), 'Tanner分期B2期，乳晕颜色稍深');
  assert.equal(result(records, 'palpation', 'breast'), '双侧乳房结节约3*3cm');
  assert.equal(result(records, 'stethoscope', 'chest-lung'), '双肺呼吸音清');
  // 乳房记录归乳房，不再塞进胸廓视诊
  assert.equal(result(records, 'inspection', 'chest'), '');
  assert.equal(at('乳房未见发育。', 'inspection', 'breast'), '乳房未见发育');
  assert.equal(at('胸廓对称。', 'palpation', 'chest'), '');
});

test('源记录中的结膜和巩膜证据可由眼部检查取得，不混入口咽结果', () => {
  const records = sourceExamDefinitions('结膜充血，巩膜黄染，咽红，扁桃体不大。');
  assert.equal(result(records, 'flashlight', 'eyes'), '结膜充血，巩膜黄染');
  assert.equal(result(records, 'tongue-depressor', 'mouth'), '咽红，扁桃体不大');
  assert.equal(at('结膜无充血。', 'flashlight', 'eyes'), '结膜无充血');
});

test('口咽检查保留扁桃体分度及局部分泌物续段，不吸收心肺结果', () => {
  const records = sourceExamDefinitions('咽充血，扁桃体Ⅱ度肿大，表面可见脓点，口腔黏膜无溃疡，双肺呼吸音清。');
  assert.equal(result(records, 'tongue-depressor', 'mouth'), '咽充血，扁桃体Ⅱ度肿大，表面可见脓点，口腔黏膜无溃疡');
  assert.equal(result(records, 'stethoscope', 'chest-lung'), '双肺呼吸音清');
});

test('浅表淋巴结记录由淋巴结触诊取得，阳性阴性均保留，不混入头面检查', () => {
  // 川崎病原文形态：淋巴结肿大连同质地/触痛续段描述完整吸收，不被其他查体截走
  const records = sourceExamDefinitions('T 36.5℃，颈软，颈部及腹股沟浅表淋巴结可触及肿大，质韧活动可，无触痛，结膜充血，咽红。');
  assert.equal(result(records, 'palpation', 'lymph-nodes'), '颈部及腹股沟浅表淋巴结可触及肿大，质韧活动可，无触痛');
  assert.equal(result(records, 'inspection', 'neck'), '颈软');
  assert.equal(result(records, 'thermometer', 'forehead'), 'T 36.5℃');
  assert.equal(result(records, 'flashlight', 'eyes'), '结膜充血');
  // 续段被吸收后不得再泄漏到其他器材×部位
  assert.equal(result(records, 'palpation', 'groin'), '');
  // 含“耳”“头”字样的淋巴结描述不得被耳镜/头面视诊抢走；大小/质地/融合续段完整保留
  const multiSite = sourceExamDefinitions('枕部、耳前耳后、颈前颈后、颌下、腋下、腹股沟可扪及数枚肿大淋巴结，大小约1.2*1.7cm左右，质硬，相互融合成片状，无触痛，双眼睑无水肿。');
  assert.equal(result(multiSite, 'palpation', 'lymph-nodes'), '枕部、耳前耳后、颈前颈后、颌下、腋下、腹股沟可扪及数枚肿大淋巴结，大小约1.2*1.7cm左右，质硬，相互融合成片状，无触痛');
  assert.equal(result(multiSite, 'otoscope', 'ears'), '');
  assert.equal(result(multiSite, 'flashlight', 'eyes'), '双眼睑无水肿');
  // 关键阴性同样可取得；阴性后不吸收续段，皮肤表现（咖啡斑）不误入淋巴结触诊
  const negative = sourceExamDefinitions('浅表淋巴结未扪及肿大，腹股沟处可见最大约8*8cm咖啡斑。');
  assert.equal(result(negative, 'palpation', 'lymph-nodes'), '浅表淋巴结未扪及肿大');
  assert.equal(result(negative, 'inspection', 'skin'), '腹股沟处可见最大约8*8cm咖啡斑');
  // 无淋巴结记录时不生成淋巴结触诊结果
  assert.equal(at('颈软，双肺呼吸音清。', 'palpation', 'lymph-nodes'), '');
});

test('脑膜刺激征“颈稍抵抗”归入颈部视诊，不虚构正常颈软', () => {
  const records = sourceExamDefinitions('颈稍抵抗，克氏征阳性。');
  assert.equal(result(records, 'inspection', 'neck'), '颈稍抵抗');
  assert.equal(result(records, 'reflex-hammer', 'neuro'), '克氏征阳性');
});

test('腹部视触叩听与反射分别取对应原文片段，不传播完整查体答案', () => {
  const records = sourceExamDefinitions('腹稍胀，无压痛，移动浊音（+），肠鸣音正常，双下肢水肿，膝反射存在。');
  assert.equal(result(records, 'inspection', 'abdomen'), '腹稍胀');
  assert.equal(result(records, 'palpation', 'abdomen'), '无压痛');
  assert.equal(result(records, 'percussion', 'abdomen'), '移动浊音（+）');
  assert.equal(result(records, 'stethoscope', 'abdomen'), '肠鸣音正常');
  assert.equal(result(records, 'reflex-hammer', 'neuro'), '膝反射存在');
  assert.equal(result(records, 'inspection', 'limbs'), '双下肢水肿');
  assert.ok(!result(records, 'palpation', 'abdomen').includes('肠鸣音'));
});

test('出血点/瘀点瘀斑归入皮肤视诊，牙龈出血归入口咽，不遗漏皮肤黏膜出血证据（ITP 实审驱动）', () => {
  // ITP 原文形态：皮肤出血体征此前不命中任何查体关键词而整体丢失
  const records = sourceExamDefinitions('全身可见散在针尖样出血点，颈部可见出血点融合成片，牙龈出血，咽充血，颈软。');
  assert.equal(result(records, 'inspection', 'skin'), '全身可见散在针尖样出血点，颈部可见出血点融合成片');
  assert.equal(result(records, 'tongue-depressor', 'mouth'), '牙龈出血，咽充血');
  // “颈部可见出血点融合成片”是皮肤表现，不得被淋巴结触诊抢走
  assert.equal(result(records, 'palpation', 'lymph-nodes'), '');
});

test('痰鸣音归入肺部听诊，呼吸稍促归入胸部视诊，震颤归入胸部触诊', () => {
  const records = sourceExamDefinitions('呼吸稍促，可见轻度吸气三凹征，双肺呼吸音粗，可闻及痰鸣音，无震颤。');
  assert.equal(result(records, 'stethoscope', 'chest-lung'), '双肺呼吸音粗，可闻及痰鸣音');
  assert.equal(result(records, 'inspection', 'chest'), '呼吸稍促，可见轻度吸气三凹征');
  assert.equal(result(records, 'palpation', 'chest'), '无震颤');
  // 痰鸣音不得串入腹部听诊（肠鸣音仍归腹部）
  const mixed = sourceExamDefinitions('可闻及痰鸣音，肠鸣音正常。');
  assert.equal(result(mixed, 'stethoscope', 'abdomen'), '肠鸣音正常');
  assert.equal(result(mixed, 'stethoscope', 'chest-lung'), '可闻及痰鸣音');
  assert.equal(result(mixed, 'stethoscope', 'chest-heart'), '');
});

test('缺陷a：心与肺的听诊结果分开，不混成一坨', () => {
  const records = sourceExamDefinitions('双肺呼吸音粗，可闻及细湿啰音，心音有力，心律齐，未闻及杂音。');
  const lung = result(records, 'stethoscope', 'chest-lung');
  const heart = result(records, 'stethoscope', 'chest-heart');
  assert.equal(lung, '双肺呼吸音粗，可闻及细湿啰音');
  assert.equal(heart, '心音有力，心律齐，未闻及杂音');
  assert.ok(!lung.includes('心音') && !lung.includes('杂音'));
  assert.ok(!heart.includes('呼吸音') && !heart.includes('啰音'));
  // 腹部血管杂音归腹部听诊，不进心脏听诊
  assert.equal(at('脐周可闻及血管杂音。', 'stethoscope', 'chest-heart'), '');
});

test('缺陷b：黄疸与皮疹归皮肤，精神/面色反应归一般状态，巩膜归眼部', () => {
  const records = sourceExamDefinitions('皮肤黄染，精神萎靡，面色苍白，反应差，巩膜黄染。');
  const skin = result(records, 'inspection', 'skin');
  assert.equal(skin, '皮肤黄染，面色苍白');
  assert.ok(!skin.includes('精神') && !skin.includes('反应') && !skin.includes('巩膜'));
  assert.equal(result(records, 'inspection', 'general-state'), '精神萎靡，反应差');
  assert.equal(result(records, 'flashlight', 'eyes'), '巩膜黄染');
  assert.equal(at('全身皮疹呈充血性斑丘疹。', 'inspection', 'skin'), '全身皮疹呈充血性斑丘疹');
});

test('缺陷c：腹肌稍紧张被腹部触诊命中，不因“稍”字漏掉', () => {
  assert.equal(at('腹肌稍紧张，有压痛。', 'palpation', 'abdomen'), '腹肌稍紧张，有压痛');
  assert.equal(at('腹肌紧张，反跳痛阳性。', 'palpation', 'abdomen'), '腹肌紧张，反跳痛阳性');
  assert.equal(at('腹软，无压痛。', 'palpation', 'abdomen'), '腹软，无压痛');
});

test('缺陷d：巴宾斯基征与病理征阳性归神经系统检查，不只认“巴氏”', () => {
  const records = sourceExamDefinitions('双侧巴宾斯基征阳性，Babinski征可疑，病理征未引出。');
  assert.equal(result(records, 'reflex-hammer', 'neuro'), '双侧巴宾斯基征阳性，Babinski征可疑，病理征未引出');
  assert.equal(at('克氏征与布氏征均阳性。', 'reflex-hammer', 'neuro'), '克氏征与布氏征均阳性');
});

test('缺陷e：仰卧位限定部位由 SUPINE_ONLY_PARTS 统一给出，新增腹部类部位不再绕过', () => {
  assert.deepEqual([...SUPINE_ONLY_PARTS].sort(), ['abdomen', 'groin', 'liver-spleen']);
  for (const part of SUPINE_ONLY_PARTS) {
    assert.equal(postureAllows(part, 'standing'), false, part);
    assert.equal(postureAllows(part, 'supine'), true, part);
  }
  assert.equal(postureAllows('chest', 'standing'), true);
  assert.equal(postureAllows('chest-lung', 'standing'), true);
});

test('新增部位各有归属：头围/耳鼻鼻/脊柱关节/肝脾腹股沟/指甲/生命体征', () => {
  assert.equal(at('头围48cm，前囟平坦。', 'measuring-tape', 'forehead'), '头围48cm');
  assert.equal(at('头围48cm，前囟平坦。', 'inspection', 'forehead'), '前囟平坦');
  assert.equal(at('双耳鼓膜充血，外耳道无分泌物。', 'otoscope', 'ears'), '双耳鼓膜充血，外耳道无分泌物');
  assert.equal(at('鼻翼扇动，鼻腔无分泌物。', 'inspection', 'nose'), '鼻翼扇动，鼻腔无分泌物');
  assert.equal(at('脊柱无侧弯，棘突无压痛。', 'inspection', 'spine'), '脊柱无侧弯');
  assert.equal(at('脊柱无侧弯，棘突无压痛。', 'palpation', 'spine'), '棘突无压痛');
  assert.equal(at('膝关节肿胀，浮髌试验阴性。', 'palpation', 'joints'), '膝关节肿胀，浮髌试验阴性');
  assert.equal(at('肝脾肋下未及。', 'palpation', 'liver-spleen'), '肝脾肋下未及');
  assert.equal(at('脾无肿大。', 'palpation', 'liver-spleen'), '脾无肿大');
  assert.equal(at('脾脏肋下约7cm。', 'palpation', 'liver-spleen'), '脾脏肋下约7cm');
  assert.equal(at('腹股沟可触及疝，阴囊无红肿。', 'palpation', 'groin'), '腹股沟可触及疝，阴囊无红肿');
  assert.equal(at('未见杵状指，甲床红润。', 'inspection', 'nails'), '未见杵状指，甲床红润');
  assert.equal(at('血压90/60mmHg。', 'bp-cuff', 'upper-arm'), '血压90/60mmHg');
  assert.equal(at('SpO2 95%。', 'oximeter', 'finger'), 'SpO2 95%');
  assert.equal(at('体温38.5℃。', 'thermometer', 'forehead'), '体温38.5℃');
});

test('神经系统阴性体征归入神经系统与反射检查，不丢失关键阴性（ITP 颅内出血警示评估）', () => {
  const records = sourceExamDefinitions('神经系统查体无异常，四肢肌力肌张力正常，膝反射存在。');
  assert.equal(result(records, 'reflex-hammer', 'neuro'), '神经系统查体无异常，四肢肌力肌张力正常，膝反射存在');
  // 肌张力不得同时混入四肢视诊
  assert.equal(result(records, 'inspection', 'limbs'), '');
});

test('对光反射归眼部与瞳孔检查，淋巴结/扁桃体/肝脾/肠鸣音/神经系统各归其位（DKA 原文形态）', () => {
  const records = sourceExamDefinitions('双侧瞳孔等大等圆，对光反射灵敏，浅表淋巴结未扪及肿大，双侧扁桃体I°大，肝脾肋下未及，肠鸣音正常，神经系统检查无异常。');
  assert.equal(result(records, 'flashlight', 'eyes'), '双侧瞳孔等大等圆，对光反射灵敏');
  assert.equal(result(records, 'tongue-depressor', 'mouth'), '双侧扁桃体I°大');
  assert.equal(result(records, 'palpation', 'lymph-nodes'), '浅表淋巴结未扪及肿大');
  assert.equal(result(records, 'palpation', 'liver-spleen'), '肝脾肋下未及');
  assert.equal(result(records, 'palpation', 'abdomen'), '');
  assert.equal(result(records, 'stethoscope', 'abdomen'), '肠鸣音正常');
  assert.equal(result(records, 'reflex-hammer', 'neuro'), '神经系统检查无异常');
  // 对光反射是眼部证据，不得被神经系统条目重复吸收
  assert.ok(!result(records, 'reflex-hammer', 'neuro').includes('对光反射'));
});

test('原始反射与腹壁反射不丢，胸廓叩诊与肺部叩诊各按部位归位', () => {
  assert.equal(at('拥抱反射不完全，吸吮反射弱。', 'reflex-hammer', 'neuro'), '拥抱反射不完全，吸吮反射弱');
  assert.equal(at('腹壁反射减弱，腱反射减弱。', 'reflex-hammer', 'neuro'), '腹壁反射减弱，腱反射减弱');
  assert.equal(at('右下肺叩诊浊音。', 'percussion', 'chest'), '右下肺叩诊浊音');
  // 无相应记录时不补正常值
  assert.equal(at('双肺呼吸音清。', 'reflex-hammer', 'neuro'), '');
});

test('裸词关键词不跨部位串味：压痛只归所在部位，肺叩诊不进腹部', () => {
  const tenderness = sourceExamDefinitions('棘突压痛，膝关节压痛，颈部压痛，右下腹压痛。');
  assert.equal(result(tenderness, 'palpation', 'abdomen'), '右下腹压痛');
  assert.equal(result(tenderness, 'palpation', 'spine'), '棘突压痛');
  assert.equal(result(tenderness, 'palpation', 'joints'), '膝关节压痛');
  assert.equal(result(tenderness, 'palpation', 'neck'), '颈部压痛');
  assert.equal(at('右下肺叩诊浊音。', 'percussion', 'abdomen'), '');
  assert.equal(at('移动浊音阳性，腹部叩诊呈鼓音。', 'percussion', 'abdomen'), '移动浊音阳性，腹部叩诊呈鼓音');
});

test('没有记录不补正常值；腹部新请求需仰卧，历史请求保留兼容', () => {
  assert.ok(sourceExamDefinitions('').every(row => !row[3]));
  assert.equal(postureAllows('abdomen', 'standing'), false);
  assert.equal(postureAllows('abdomen', 'supine'), true);
  assert.equal(postureAllows('abdomen'), true);
  assert.equal(postureAllows('chest', 'standing'), true);
});
