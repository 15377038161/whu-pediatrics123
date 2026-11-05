import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIAGNOSIS_EXTRACTION_DISCLAIMER,
  buildExtractionPrompt,
  buildExtractedAnswer,
  parseExtractionResponse,
  resolveLinePhases,
} from '@/domain/diagnosis-answer-extract';

// 真实原件形态（knowledge/teaching-cases/teacher-化脓性脑膜炎.json 的 sections.diagnosis）：
// 文档序号 + 入院/出院混排，第一行「支气管肺炎」与第六行重名。
const MENINGITIS_DIAGNOSIS = [
  '二、入院诊断:支气管肺炎',
  '五、出院诊断:',
  '大肠埃希杆菌脑膜炎',
  '革兰阴性杆菌败血症',
  '先天性心脏畸形：卵圆孔未闭',
  '支气管肺炎',
  '轻度贫血',
].join('\n');

// 真实原件形态（teacher-中枢性尿崩症.json）：出院情况查体叙述混进 diagnosis 段。
const DIABETES_INSIPIDUS_DIAGNOSIS = [
  '入院诊断：中枢性尿崩症',
  '出院诊断：部分性中枢性尿崩症',
  '高泌乳素血症',
  '垂体柄增粗原因待查',
  '出院情况：患儿仍有多饮。查体：生命体征平稳，神清，精神尚可，口唇无发绀。',
].join('\n');

const MENINGITIS_PLAN =
  '四、诊疗经过：入院后完善三大常规、血培养及脑脊液检查。给予抗感染（舒普深、美罗培南）、降低颅内压（甘露醇）、抗炎（地塞米松）、支持治疗（免疫球蛋白）、止惊（苯巴比妥钠）治疗。';

const respond = (diagnoses: string[], management: string[] = []) =>
  JSON.stringify({ diagnoses, management });

test('resolveLinePhases：入院/出院声明逐行继承，未声明前为 unspecified', () => {
  assert.deepEqual(resolveLinePhases(MENINGITIS_DIAGNOSIS), [
    'admission',
    'discharge',
    'discharge',
    'discharge',
    'discharge',
    'discharge',
    'discharge',
  ]);
  assert.deepEqual(resolveLinePhases('支气管肺炎\n轻度贫血'), ['unspecified', 'unspecified']);
});

test('抽取结果带原件行号与入院/出院归属，重名诊断定位到首次出现行', () => {
  const result = buildExtractedAnswer(respond(['支气管肺炎', '大肠埃希杆菌脑膜炎', '轻度贫血']), {
    diagnosisText: MENINGITIS_DIAGNOSIS,
    planText: MENINGITIS_PLAN,
  });
  assert.deepEqual(result.diagnoses, [
    { sourceQuote: '支气管肺炎', sourceLine: 1, phase: 'admission' },
    { sourceQuote: '大肠埃希杆菌脑膜炎', sourceLine: 3, phase: 'discharge' },
    { sourceQuote: '轻度贫血', sourceLine: 7, phase: 'discharge' },
  ]);
  assert.equal(result.dropped.length, 0);
  assert.equal(result.disclaimer, DIAGNOSIS_EXTRACTION_DISCLAIMER);
});

test('红线：原件里没有的诊断一律丢弃并如实回报，不进标答', () => {
  const result = buildExtractedAnswer(respond(['革兰阴性杆菌败血症', '病毒性脑炎', '结核性脑膜炎']), {
    diagnosisText: MENINGITIS_DIAGNOSIS,
    planText: MENINGITIS_PLAN,
  });
  assert.deepEqual(result.diagnoses, [{ sourceQuote: '革兰阴性杆菌败血症', sourceLine: 4, phase: 'discharge' }]);
  assert.deepEqual(result.dropped.map((item) => item.sourceQuote), ['病毒性脑炎', '结核性脑膜炎']);
  assert.match(result.dropped[0].reason, /不是原件的逐字内容/);
});

test('只折叠空白差异：模型漏掉空格仍算逐字命中，改字则不命中', () => {
  const source = { diagnosisText: '入院诊断：重度 糖尿病酮症酸中毒', planText: '' };
  const tolerated = buildExtractedAnswer(respond(['重度糖尿病酮症酸中毒']), source);
  assert.equal(tolerated.diagnoses.length, 1);
  assert.equal(tolerated.diagnoses[0].sourceLine, 1);
  const rejected = buildExtractedAnswer(respond(['重度糖尿病酮症酸中毒（轻型）']), source);
  assert.equal(rejected.diagnoses.length, 0);
  assert.match(rejected.dropped[0].reason, /不是原件的逐字内容/);
});

test('叙述段（出院情况/查体）不能被当成诊断条目，但会出现在丢弃清单里', () => {
  const result = buildExtractedAnswer(respond(['中枢性尿崩症', '患儿仍有多饮']), {
    diagnosisText: DIABETES_INSIPIDUS_DIAGNOSIS,
    planText: '',
  });
  assert.deepEqual(result.diagnoses.map((item) => [item.sourceQuote, item.sourceLine, item.phase]), [
    ['中枢性尿崩症', 1, 'admission'],
  ]);
  assert.equal(result.dropped.length, 1);
  assert.match(result.dropped[0].reason, /叙述段/);
});

test('处理要点从 plan 原文摘取，允许叙述段（plan 本身就是叙述体）', () => {
  const result = buildExtractedAnswer(respond([], ['抗感染（舒普深、美罗培南）', '降低颅内压（甘露醇）', '止惊（苯巴比妥钠）']), {
    diagnosisText: MENINGITIS_DIAGNOSIS,
    planText: MENINGITIS_PLAN,
  });
  assert.deepEqual(result.management.map((item) => item.sourceQuote), [
    '抗感染（舒普深、美罗培南）',
    '降低颅内压（甘露醇）',
    '止惊（苯巴比妥钠）',
  ]);
  assert.deepEqual(result.management.map((item) => item.sourceLine), [1, 1, 1]);
  assert.deepEqual(result.management.map((item) => item.phase), ['unspecified', 'unspecified', 'unspecified']);
  assert.equal(result.dropped.length, 0);
});

test('整段复制与过短引用都被挡下，超长条目按截断回报', () => {
  const long = '给予抗感染（舒普深、美罗培南）、降低颅内压（甘露醇）、抗炎（地塞米松）、支持治疗（免疫球蛋白）、止惊（苯巴比妥钠）治疗。'.repeat(4);
  const result = buildExtractedAnswer(respond(['肺', long]), {
    diagnosisText: MENINGITIS_DIAGNOSIS,
    planText: MENINGITIS_PLAN,
  });
  assert.equal(result.diagnoses.length, 0);
  assert.match(result.dropped[0].reason, /引用过短/);
  assert.match(result.dropped[1].reason, /引用过长/);
});

test('超出条数上限时截断并说明，不静默丢条目', () => {
  const quotes = Array.from({ length: 15 }, (_, index) => `轻度贫血${index}`);
  const diagnosisText = quotes.join('\n');
  const result = buildExtractedAnswer(respond(quotes), { diagnosisText, planText: '' });
  assert.equal(result.diagnoses.length, 12);
  assert.equal(result.dropped.length, 3);
  assert.match(result.dropped[0].reason, /超出条数上限/);
});

test('跨行引用仍可核对（子串命中），只是定位不到单行', () => {
  const result = buildExtractedAnswer(respond(['大肠埃希杆菌脑膜炎\n革兰阴性杆菌败血症']), {
    diagnosisText: MENINGITIS_DIAGNOSIS,
    planText: '',
  });
  assert.equal(result.diagnoses.length, 1);
  assert.equal(result.diagnoses[0].sourceLine, null);
  assert.equal(result.diagnoses[0].phase, 'unspecified');
});

test('parseExtractionResponse：接受裸 JSON 与代码围栏，拒绝非 JSON', () => {
  assert.deepEqual(parseExtractionResponse('{"diagnoses":["支气管肺炎"],"management":[]}'), {
    diagnoses: ['支气管肺炎'],
    management: [],
  });
  assert.deepEqual(parseExtractionResponse('```json\n{"diagnoses":[],"management":["甘露醇"]}\n```'), {
    diagnoses: [],
    management: ['甘露醇'],
  });
  assert.deepEqual(parseExtractionResponse('好的，结果如下：{"diagnoses":["轻度贫血"]}'), {
    diagnoses: ['轻度贫血'],
    management: [],
  });
  assert.throws(() => parseExtractionResponse('本例诊断为支气管肺炎'), /EXTRACTION_RESPONSE_NOT_JSON/);
  assert.throws(() => parseExtractionResponse('{"diagnoses":"支气管肺炎"}'), /EXTRACTION_RESPONSE_SHAPE_INVALID/);
});

test('提示词写死「只准逐字摘取、原件没有不许编造」并附原件两段', () => {
  const prompt = buildExtractionPrompt({
    age: '6岁',
    sex: '女',
    complaint: '发热伴乏力半天',
    diagnosisText: MENINGITIS_DIAGNOSIS,
    planText: MENINGITIS_PLAN,
  });
  assert.match(prompt, /逐字摘取/);
  assert.match(prompt, /禁止改写、翻译、补全、推断、合并或新增/);
  assert.match(prompt, /不要为了凑数编造/);
  assert.match(prompt, /年龄：6岁/);
  assert.match(prompt, /主诉：发热伴乏力半天/);
  assert.ok(prompt.includes(MENINGITIS_DIAGNOSIS));
  assert.ok(prompt.includes(MENINGITIS_PLAN));
});
