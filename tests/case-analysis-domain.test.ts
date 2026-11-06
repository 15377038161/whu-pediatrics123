import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groundCaseAnswerKey,
  parseGeneratedCaseAnswerKey,
  isCaseAnswerKeyRecord,
  type CaseAnalysisSource,
  type GeneratedCaseAnswerKey,
} from '../src/domain/case-analysis';

const source: CaseAnalysisSource = {
  history: '多饮多尿1周，呕吐伴乏力精神差2天，于外院测血糖32.8mmol/L。',
  exam: '精神差，嗜睡，皮肤干燥，深大呼吸，双肺未闻及干湿啰音。',
  tests: '血气分析PH 6.83，HCO3-＜3.0mmol/L，血酮体4.00mmol/L。',
  diagnosis: '入院诊断：重度 糖尿病酮症酸中毒\n出院诊断：1型糖尿病伴有酮症酸中毒\n维生素D缺乏',
  plan: '入院后予胰岛素静脉泵入、补液补钾，每小时测末梢血糖，病情稳定后改为皮下注射。',
};

const generated: GeneratedCaseAnswerKey = {
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
};

test('解析模型输出：允许代码围栏与前后解释文字', () => {
  const parsed = parseGeneratedCaseAnswerKey(`这里是结果：\n\`\`\`json\n${JSON.stringify(generated)}\n\`\`\``);
  assert.equal(parsed.primary.name, '1型糖尿病伴有酮症酸中毒');
  assert.equal(parsed.evidence.length, 3);
});

test('解析模型输出：缺段/多字段/非法 JSON 一律拒绝', () => {
  assert.throws(() => parseGeneratedCaseAnswerKey('not json'), /CASE_ANALYSIS_KEY_INVALID/);
  assert.throws(() => parseGeneratedCaseAnswerKey(JSON.stringify({ ...generated, extra: true })), /CASE_ANALYSIS_KEY_INVALID/);
  assert.throws(() => parseGeneratedCaseAnswerKey(JSON.stringify({ ...generated, evidence: [] })), /CASE_ANALYSIS_KEY_INVALID/);
});

test('原文回校：每条候选必须能在原件对应段找到，空白差异可容忍', () => {
  const withSpaces: GeneratedCaseAnswerKey = {
    ...generated,
    evidence: generated.evidence.map((point) => point.id === 'ev-polyuria'
      ? { ...point, sourceQuote: '多饮 多尿 1周' }
      : point),
  };
  const grounded = groundCaseAnswerKey(withSpaces, source);
  assert.ok('key' in grounded);
  assert.equal(grounded.key.primary.sourceSection, 'diagnosis');
  assert.equal(grounded.key.evidence.length, 3);
  assert.equal(grounded.key.management.length, 2);
  assert.equal(grounded.dropped.length, 0);
});

test('原文回校：原件没有的得分点被丢弃并回报原因', () => {
  const withFake: GeneratedCaseAnswerKey = {
    ...generated,
    evidence: [
      ...generated.evidence,
      { id: 'ev-xray', label: '胸片斑片影', keywords: ['胸片', '斑片'], sourceQuote: '胸片见斑片状阴影', sourceSection: 'tests' },
    ],
  };
  const grounded = groundCaseAnswerKey(withFake, source);
  assert.ok('key' in grounded);
  assert.equal(grounded.key.evidence.length, 3);
  assert.ok(grounded.dropped.some((item) => item.label === '胸片斑片影'));
});

test('原文回校：诊断名不在诊断段时整例不可评分，不硬造', () => {
  const wrongPrimary: GeneratedCaseAnswerKey = {
    ...generated,
    primary: { name: '支气管肺炎', sourceQuote: '支气管肺炎', sourceSection: 'diagnosis' },
  };
  const grounded = groundCaseAnswerKey(wrongPrimary, source);
  assert.ok('notAssessableReason' in grounded);
  assert.equal(grounded.notAssessableReason, 'PRIMARY_NOT_GROUNDED');
});

test('原文回校：证据全部被丢弃时整例不可评分', () => {
  const wrongEvidence: GeneratedCaseAnswerKey = {
    ...generated,
    evidence: [
      { id: 'ev-xray', label: '胸片斑片影', keywords: ['胸片'], sourceQuote: '胸片见斑片状阴影', sourceSection: 'tests' },
    ],
  };
  const grounded = groundCaseAnswerKey(wrongEvidence, source);
  assert.ok('notAssessableReason' in grounded);
  assert.equal(grounded.notAssessableReason, 'NO_GROUNDED_EVIDENCE');
});

test('原文回校：原件没有鉴别诊断时不硬造，该段标记不适用', () => {
  const withDifferential: GeneratedCaseAnswerKey = {
    ...generated,
    differentials: [{ id: 'diff-gastro', name: '急性胃肠炎', sourceSection: 'diagnosis' }],
  };
  const grounded = groundCaseAnswerKey(withDifferential, source);
  assert.ok('key' in grounded);
  assert.equal(grounded.key.differentials, undefined);
  assert.ok(grounded.dropped.some((item) => item.label === '急性胃肠炎'));
});

test('原文回校：重复得分点去重，重复 id 自动改名', () => {
  const duplicated: GeneratedCaseAnswerKey = {
    ...generated,
    evidence: [
      ...generated.evidence,
      { id: 'ev-polyuria', label: '多饮多尿', keywords: ['多饮'], sourceQuote: '多饮多尿1周', sourceSection: 'history' },
    ],
  };
  const grounded = groundCaseAnswerKey(duplicated, source);
  assert.ok('key' in grounded);
  assert.equal(grounded.key.evidence.length, 3);
});

test('标答记录形状校验', () => {
  assert.equal(isCaseAnswerKeyRecord({
    caseId: 'teacher-x',
    version: 'a'.repeat(16),
    status: 'auto',
    key: generated,
    model: 'm',
    promptVersion: 'p',
    sourceFingerprint: 'a'.repeat(16),
    generatedAt: new Date().toISOString(),
    dropped: [],
  }), true);
  assert.equal(isCaseAnswerKeyRecord({ status: 'auto' }), false);
});