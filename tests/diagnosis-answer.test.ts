import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIAGNOSIS_DISCLAIMER,
  diagnoseSecondaryOverflow,
  gradeDiagnosisAnswer,
  matchesDiagnosisName,
  normalizeDiagnosisText,
  type DiagnosisAnswerKey,
} from '../src/domain/diagnosis-answer';

const key: DiagnosisAnswerKey = {
  primary: { name: '支气管肺炎', aliases: ['小叶性肺炎'] },
  secondary: [{ name: '中度贫血' }, { name: '营养不良' }],
  evidence: [
    { id: 'ev-fever', label: '发热咳嗽病史', keywords: ['发热', '咳嗽'] },
    { id: 'ev-rales', label: '双肺细湿啰音', keywords: ['湿啰音', '啰音'] },
    { id: 'ev-xray', label: '胸片斑片影', keywords: ['胸片', '斑片'] },
  ],
  differentials: [{ name: '支气管哮喘' }],
  management: [
    { id: 'mg-antibiotic', label: '抗感染治疗', keywords: ['抗感染', '抗生素'] },
    { id: 'mg-oxygen', label: '氧疗与呼吸支持', keywords: ['吸氧', '氧疗'] },
    { id: 'mg-followup', label: '复诊与病情告知', keywords: ['复诊', '随访', '告知'] },
  ],
};

test('完整答案得满分', () => {
  const grade = gradeDiagnosisAnswer(key, {
    primary: '小叶性肺炎',
    secondary: ['中度贫血', '营养不良'],
    evidence: '患儿发热咳嗽 3 天，双肺可闻及细湿啰音，胸片见斑片状阴影',
    differentials: '支气管哮喘',
    management: '抗感染治疗，必要时吸氧，嘱家属复诊并告知病情',
  });
  assert.equal(grade.totalScore, grade.maxScore);
  assert.equal(grade.diagnosis.primaryHit, true);
  assert.deepEqual(grade.diagnosis.secondaryHits, ['中度贫血', '营养不良']);
  assert.equal(grade.differential.applicable, true);
  assert.deepEqual(grade.missingPoints, []);
});

test('同义写法算命中，归一化忽略标点空格', () => {
  assert.equal(normalizeDiagnosisText(' 支气管 肺炎。'), '支气管肺炎');
  assert.equal(matchesDiagnosisName(key.primary, '小叶性肺炎'), true);
  assert.equal(matchesDiagnosisName(key.primary, '大叶性肺炎'), false);
});

test('把并列诊断填在第一诊断位时第一诊断判错', () => {
  const grade = gradeDiagnosisAnswer(key, { primary: '中度贫血', secondary: ['支气管肺炎'] });
  assert.equal(grade.diagnosis.primaryHit, false);
  assert.equal(grade.diagnosis.primaryScore, 0);
  assert.ok(grade.missingPoints.some((item) => item.includes('支气管肺炎')));
});

test('只填第一诊断时其余维度得 0，缺口逐条列出', () => {
  const grade = gradeDiagnosisAnswer(key, { primary: '支气管肺炎' });
  assert.equal(grade.diagnosis.primaryScore, 30);
  assert.equal(grade.diagnosis.secondaryScore, 0);
  assert.equal(grade.evidence.score, 0);
  assert.equal(grade.management.score, 0);
  assert.ok(grade.missingPoints.length >= 6);
});

test('诊断依据与处理原则按覆盖率给分', () => {
  const grade = gradeDiagnosisAnswer(key, {
    primary: '支气管肺炎',
    evidence: '发热咳嗽 3 天',
    management: '抗感染治疗',
  });
  assert.equal(grade.evidence.hits.length, 1);
  assert.equal(grade.evidence.misses.length, 2);
  assert.equal(grade.evidence.score, Math.round(25 / 3));
  assert.equal(grade.management.hits.length, 1);
  assert.equal(grade.management.score, Math.round(25 / 3));
});

test('无鉴别诊断标准答案时该项不占分', () => {
  const noDifferential: DiagnosisAnswerKey = { ...key, differentials: undefined };
  const grade = gradeDiagnosisAnswer(noDifferential, { primary: '支气管肺炎' });
  assert.equal(grade.differential.applicable, false);
  assert.equal(grade.differential.maxScore, 0);
  assert.equal(grade.maxScore, 30 + 20 + 25 + 0 + 25);
});

test('并列诊断标答为空时不白送 20 分，也不占满分', () => {
  const noSecondary: DiagnosisAnswerKey = { ...key, secondary: [] };
  const grade = gradeDiagnosisAnswer(noSecondary, { primary: '支气管肺炎' });
  assert.equal(grade.diagnosis.secondaryScore, 0);
  assert.equal(grade.maxScore, 30 + 0 + 25 + 10 + 25);
  assert.equal(grade.totalScore, 30);
});

test('诊断依据标答为空时该项不计入满分', () => {
  const noEvidence: DiagnosisAnswerKey = { ...key, evidence: [] };
  const grade = gradeDiagnosisAnswer(noEvidence, { primary: '支气管肺炎' });
  assert.equal(grade.evidence.maxScore, 0);
  assert.equal(grade.evidence.score, 0);
  assert.equal(grade.maxScore, 30 + 20 + 0 + 10 + 25);
});

test('处理原则标答为空时该项不计入满分', () => {
  const noManagement: DiagnosisAnswerKey = { ...key, management: [] };
  const grade = gradeDiagnosisAnswer(noManagement, { primary: '支气管肺炎' });
  assert.equal(grade.management.maxScore, 0);
  assert.equal(grade.management.score, 0);
  assert.equal(grade.maxScore, 30 + 20 + 25 + 10 + 0);
});

test('除第一诊断外全部为空时，满分只有 30 分', () => {
  const onlyPrimary: DiagnosisAnswerKey = {
    primary: { name: '支气管肺炎' },
    secondary: [],
    evidence: [],
    differentials: undefined,
    management: [],
  };
  const hit = gradeDiagnosisAnswer(onlyPrimary, { primary: '支气管肺炎' });
  assert.equal(hit.maxScore, 30);
  assert.equal(hit.totalScore, 30);
  const miss = gradeDiagnosisAnswer(onlyPrimary, { primary: '哮喘' });
  assert.equal(miss.totalScore, 0);
});

test('AI 逐点判分：命中/部分/未命中按比例计分，且不超过该段满分', () => {
  const grade = gradeDiagnosisAnswer(
    key,
    {
      primary: '支气管肺炎',
      secondary: ['中度贫血', '营养不良'],
      evidence: '发热咳嗽 3 天，双肺可闻及细湿啰音',
      differentials: '支气管哮喘',
      management: '抗感染治疗，必要时吸氧',
    },
    {
      'evidence:ev-fever': { status: 'covered', evidence: '发热咳嗽 3 天' },
      'evidence:ev-rales': { status: 'partial', evidence: '双肺可闻及细湿啰音' },
      'evidence:ev-xray': { status: 'missing' },
      'management:mg-antibiotic': { status: 'covered', evidence: '抗感染治疗' },
      'management:mg-oxygen': { status: 'partial', evidence: '必要时吸氧' },
      'management:mg-followup': { status: 'missing' },
    },
  );
  assert.equal(grade.evidence.score, Math.round(((1 + 0.5 + 0) / 3) * 25));
  assert.equal(grade.management.score, Math.round(((1 + 0.5 + 0) / 3) * 25));
  assert.ok(grade.evidence.score <= grade.evidence.maxScore);
  assert.ok(grade.management.score <= grade.management.maxScore);
  assert.equal(grade.points.find((p) => p.id === 'ev-rales')?.status, 'partial');
  assert.equal(grade.points.find((p) => p.id === 'mg-followup')?.status, 'missing');
});

test('逐点判分全部命中时该段拿满，全部缺失时该段为 0', () => {
  const allHit = gradeDiagnosisAnswer(key, {
    primary: '支气管肺炎',
    secondary: ['中度贫血', '营养不良'],
    evidence: 'x',
    differentials: '支气管哮喘',
    management: 'x',
  }, {
    'evidence:ev-fever': { status: 'covered' },
    'evidence:ev-rales': { status: 'covered' },
    'evidence:ev-xray': { status: 'covered' },
    'management:mg-antibiotic': { status: 'covered' },
    'management:mg-oxygen': { status: 'covered' },
    'management:mg-followup': { status: 'covered' },
  });
  assert.equal(allHit.evidence.score, 25);
  assert.equal(allHit.management.score, 25);
  const allMiss = gradeDiagnosisAnswer(key, { primary: '支气管肺炎' }, {
    'evidence:ev-fever': { status: 'missing' },
    'evidence:ev-rales': { status: 'missing' },
    'evidence:ev-xray': { status: 'missing' },
    'management:mg-antibiotic': { status: 'missing' },
    'management:mg-oxygen': { status: 'missing' },
    'management:mg-followup': { status: 'missing' },
  });
  assert.equal(allMiss.evidence.score, 0);
  assert.equal(allMiss.management.score, 0);
});

test('空输入与超长输入都不抛错', () => {
  const empty = gradeDiagnosisAnswer(key, {});
  assert.equal(empty.totalScore, 0);
  assert.equal(empty.diagnosis.primaryHit, false);
  const long = gradeDiagnosisAnswer(key, { primary: '支气管肺炎'.repeat(500), evidence: '发热'.repeat(5000), management: '', secondary: [] });
  assert.ok(long.totalScore >= 0 && long.totalScore <= long.maxScore);
});

test('并列诊断超过两项时给出界面提示', () => {
  assert.equal(diagnoseSecondaryOverflow({ secondary: ['中度贫血', '营养不良'] }), false);
  assert.equal(diagnoseSecondaryOverflow({ secondary: ['中度贫血', '营养不良', '佝偻病'] }), true);
});

test('免责声明写明教师提供标答且不计入临床成绩', () => {
  assert.match(DIAGNOSIS_DISCLAIMER, /教师提供/);
  assert.match(DIAGNOSIS_DISCLAIMER, /不计入临床成绩/);
});