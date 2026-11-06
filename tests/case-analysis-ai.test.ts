import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateCaseAnswerKey,
  gradeCaseAnalysis,
  type CaseAnalysisCaseInput,
} from '../src/lib/case-analysis-ai';
import type { DiagnosisAnswerKey, DiagnosisAnswerInput } from '../src/domain/diagnosis-answer';

const input: CaseAnalysisCaseInput = {
  caseId: 'teacher-1型糖尿病伴有酮症酸中毒',
  version: 'a'.repeat(16),
  sourceName: '1型糖尿病伴有酮症酸中毒',
  age: '6岁',
  sex: '女',
  complaint: '多饮多尿1周，呕吐伴乏力精神差2天',
  sections: {
    history: '多饮多尿1周，呕吐伴乏力精神差2天，于外院测血糖32.8mmol/L。',
    exam: '精神差，嗜睡，皮肤干燥，深大呼吸，双肺未闻及干湿啰音。',
    tests: '血气分析PH 6.83，HCO3-＜3.0mmol/L，血酮体4.00mmol/L。',
    diagnosis: '入院诊断：重度 糖尿病酮症酸中毒\n出院诊断：1型糖尿病伴有酮症酸中毒\n维生素D缺乏',
    plan: '入院后予胰岛素静脉泵入、补液补钾，每小时测末梢血糖，病情稳定后改为皮下注射。',
  },
};

const generatedJson = JSON.stringify({
  primary: { name: '1型糖尿病伴有酮症酸中毒', sourceQuote: '1型糖尿病伴有酮症酸中毒', sourceSection: 'diagnosis' },
  secondary: [{ name: '维生素D缺乏', sourceQuote: '维生素D缺乏', sourceSection: 'diagnosis' }],
  evidence: [
    { id: 'ev-polyuria', label: '多饮多尿', keywords: ['多饮', '多尿'], sourceQuote: '多饮多尿1周', sourceSection: 'history' },
    { id: 'ev-acidosis', label: '血气pH下降', keywords: ['pH', '酸中毒'], sourceQuote: 'PH 6.83', sourceSection: 'tests' },
    { id: 'ev-kussmaul', label: '深大呼吸', keywords: ['深大呼吸'], sourceQuote: '深大呼吸', sourceSection: 'exam' },
  ],
  differentials: [],
  management: [
    { id: 'mg-fluid', label: '补液', keywords: ['补液'], sourceQuote: '补液', sourceSection: 'plan' },
    { id: 'mg-insulin', label: '胰岛素静脉泵入', keywords: ['胰岛素'], sourceQuote: '胰岛素静脉泵入', sourceSection: 'plan' },
  ],
});

const key: DiagnosisAnswerKey = {
  primary: { name: '1型糖尿病伴有酮症酸中毒', aliases: ['1型糖尿病伴酮症酸中毒'] },
  secondary: [{ name: '维生素D缺乏' }],
  evidence: [
    { id: 'ev-polyuria', label: '多饮多尿', keywords: ['多饮', '多尿'] },
    { id: 'ev-acidosis', label: '血气pH下降', keywords: ['pH', '酸中毒'] },
    { id: 'ev-kussmaul', label: '深大呼吸', keywords: ['深大呼吸'] },
  ],
  differentials: undefined,
  management: [
    { id: 'mg-fluid', label: '补液', keywords: ['补液'] },
    { id: 'mg-insulin', label: '胰岛素静脉泵入', keywords: ['胰岛素'] },
  ],
};

const submission: DiagnosisAnswerInput = {
  primary: '1型糖尿病伴有酮症酸中毒',
  secondary: ['维生素D缺乏'],
  evidence: '多饮多尿1周，血气分析PH 6.83',
  differentials: '',
  management: '予补液、胰岛素静脉泵入',
};

test('生成标答：模型输出经解析、原文回校后进入 auto', async () => {
  const record = await generateCaseAnswerKey(input.caseId, {
    deps: { readCase: () => input, generate: async () => generatedJson },
  });
  assert.equal(record.status, 'auto');
  assert.ok(record.key);
  assert.equal(record.key.primary.name, '1型糖尿病伴有酮症酸中毒');
  assert.equal(record.key.evidence.length, 3);
  assert.equal(record.dropped.length, 0);
  assert.equal(record.version, input.version);
  assert.equal(record.promptVersion, 'case-analysis-v1');
});

test('生成标答：模型失败或输出非法时不硬造，标记 not_assessable', async () => {
  const modelFail = await generateCaseAnswerKey(input.caseId, {
    deps: { readCase: () => input, generate: async () => { throw new Error('network'); } },
  });
  assert.equal(modelFail.status, 'not_assessable');
  assert.equal(modelFail.reason, 'MODEL_UNAVAILABLE');
  const invalidJson = await generateCaseAnswerKey(input.caseId, {
    deps: { readCase: () => input, generate: async () => 'not json' },
  });
  assert.equal(invalidJson.status, 'not_assessable');
  assert.equal(invalidJson.reason, 'MODEL_RESPONSE_INVALID');
});

test('生成标答：AI 塞入原件没有的诊断时整例不可评分', async () => {
  const wrong = JSON.stringify({
    ...JSON.parse(generatedJson),
    primary: { name: '支气管肺炎', sourceQuote: '支气管肺炎', sourceSection: 'diagnosis' },
  });
  const record = await generateCaseAnswerKey(input.caseId, {
    deps: { readCase: () => input, generate: async () => wrong },
  });
  assert.equal(record.status, 'not_assessable');
  assert.equal(record.reason, 'PRIMARY_NOT_GROUNDED');
});

test('AI 逐点判分：命中/部分/未命中进入确定性汇总', async () => {
  const judgements = {
    judgements: [
      { pointId: 'evidence:ev-polyuria', status: 'covered', evidence: '多饮多尿1周' },
      { pointId: 'evidence:ev-acidosis', status: 'partial', evidence: 'PH 6.83' },
      { pointId: 'evidence:ev-kussmaul', status: 'missing' },
      { pointId: 'management:mg-fluid', status: 'covered', evidence: '补液' },
      { pointId: 'management:mg-insulin', status: 'covered', evidence: '胰岛素静脉泵入' },
    ],
  };
  const result = await gradeCaseAnalysis(key, submission, {
    deps: { generate: async () => JSON.stringify(judgements) },
  });
  assert.equal(result.usedFallback, false);
  assert.equal(result.invalidCount, 0);
  assert.equal(result.grade.diagnosis.primaryScore, 30);
  assert.equal(result.grade.diagnosis.secondaryScore, 20);
  assert.equal(result.grade.evidence.score, Math.round(((1 + 0.5 + 0) / 3) * 25));
  assert.equal(result.grade.management.score, 25);
  assert.equal(result.grade.maxScore, 100);
});

test('AI 逐点判分：证据引文不在学生原文时降为未命中并计数', async () => {
  const result = await gradeCaseAnalysis(key, submission, {
    deps: {
      generate: async () => JSON.stringify({
        judgements: [
          { pointId: 'evidence:ev-polyuria', status: 'covered', evidence: '学生没写过的句子' },
          { pointId: 'evidence:ev-acidosis', status: 'missing' },
          { pointId: 'evidence:ev-kussmaul', status: 'missing' },
          { pointId: 'management:mg-fluid', status: 'missing' },
          { pointId: 'management:mg-insulin', status: 'missing' },
        ],
      }),
    },
  });
  assert.equal(result.invalidCount, 1);
  assert.equal(result.grade.evidence.score, 0);
  assert.equal(result.grade.points.find((point) => point.id === 'ev-polyuria')?.status, 'missing');
});

test('有鉴别诊断时原始满分 110，报告百分比折算为 100', async () => {
  const keyWithDifferential: DiagnosisAnswerKey = {
    ...key,
    differentials: [{ name: '急性胃肠炎' }],
  };
  const fullJudgements = {
    'evidence:ev-polyuria': { status: 'covered', evidence: '多饮多尿1周' },
    'evidence:ev-acidosis': { status: 'covered', evidence: 'PH 6.83' },
    'evidence:ev-kussmaul': { status: 'covered', evidence: '深大呼吸' },
    'differential:0': { status: 'covered', evidence: '急性胃肠炎' },
    'management:mg-fluid': { status: 'covered', evidence: '补液' },
    'management:mg-insulin': { status: 'covered', evidence: '胰岛素静脉泵入' },
  } as const;
  const result = await gradeCaseAnalysis(keyWithDifferential, {
    ...submission,
    differentials: '急性胃肠炎',
  }, { judgements: fullJudgements });
  assert.equal(result.grade.maxScore, 110);
  assert.equal(result.grade.totalScore, 110);
  assert.equal(result.percent, 100);
});

test('AI 判分失败时回退关键词匹配，但不回退成“写了就给分”', async () => {
  const result = await gradeCaseAnalysis(key, submission, {
    deps: { generate: async () => { throw new Error('model down'); } },
  });
  assert.equal(result.usedFallback, true);
  assert.ok(result.grade.totalScore > 0);
  assert.ok(result.grade.totalScore < result.grade.maxScore);
});

test('人工改判入口不调用模型', async () => {
  let called = false;
  const result = await gradeCaseAnalysis(key, submission, {
    judgements: {
      'evidence:ev-polyuria': { status: 'covered', evidence: '多饮多尿1周' },
      'evidence:ev-acidosis': { status: 'missing' },
      'evidence:ev-kussmaul': { status: 'missing' },
      'management:mg-fluid': { status: 'covered', evidence: '补液' },
      'management:mg-insulin': { status: 'covered', evidence: '胰岛素静脉泵入' },
    },
    deps: { generate: async () => { called = true; return '{}'; } },
  });
  assert.equal(called, false);
  assert.equal(result.usedFallback, false);
  assert.equal(result.grade.evidence.score, Math.round((1 / 3) * 25));
});