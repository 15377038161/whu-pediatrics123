import type { CaseAnalysisSource, GeneratedCaseAnswerKey } from '../../src/domain/case-analysis';
import type { DiagnosisAnswerInput } from '../../src/domain/diagnosis-answer';

/** DKA 试点用的病例原件摘录：来自 knowledge/teaching-cases/teacher-1型糖尿病伴有酮症酸中毒.json。 */
export const dkaSource: CaseAnalysisSource = {
  history: '多饮多尿1周，呕吐伴乏力精神差2天，于外院测血糖32.8mmol/L。',
  exam: '精神差，嗜睡，皮肤干燥，深大呼吸，双肺未闻及干湿啰音。',
  tests: '血气分析PH 6.83，HCO3-＜3.0mmol/L，血酮体4.00mmol/L。',
  diagnosis: '入院诊断：重度 糖尿病酮症酸中毒\n出院诊断：1型糖尿病伴有酮症酸中毒\n维生素D缺乏',
  plan: '入院后予胰岛素静脉泵入、补液补钾，每小时测末梢血糖，控制补液速度，嘱糖尿病饮食。',
};

/**
 * 模拟 AI 从原件抽取的候选标答。
 * 注意：原件没有明确写鉴别诊断，所以 differentials 为空；不得为了凑 10 分自行补造。
 */
export const dkaGeneratedKey: GeneratedCaseAnswerKey = {
  primary: {
    name: '1型糖尿病伴有酮症酸中毒',
    aliases: ['1型糖尿病伴酮症酸中毒', '糖尿病酮症酸中毒'],
    sourceQuote: '1型糖尿病伴有酮症酸中毒',
    sourceSection: 'diagnosis',
  },
  secondary: [{ name: '维生素D缺乏', sourceQuote: '维生素D缺乏', sourceSection: 'diagnosis' }],
  evidence: [
    { id: 'ev-polyuria', label: '多饮多尿1周', keywords: ['多饮', '多尿'], sourceQuote: '多饮多尿1周', sourceSection: 'history' },
    { id: 'ev-vomit', label: '呕吐伴乏力精神差2天', keywords: ['呕吐', '乏力', '精神差'], sourceQuote: '呕吐伴乏力精神差2天', sourceSection: 'history' },
    { id: 'ev-kussmaul', label: '深大呼吸', keywords: ['深大呼吸'], sourceQuote: '深大呼吸', sourceSection: 'exam' },
    { id: 'ev-glucose', label: '血糖升高', keywords: ['血糖', '32.8'], sourceQuote: '血糖32.8mmol/L', sourceSection: 'history' },
    { id: 'ev-acidosis', label: '血气pH下降、HCO3-降低', keywords: ['PH', 'pH', 'HCO3', '酸中毒'], sourceQuote: 'PH 6.83', sourceSection: 'tests' },
    { id: 'ev-ketone', label: '血酮体升高', keywords: ['血酮体', '酮体', '4.00'], sourceQuote: '血酮体4.00mmol/L', sourceSection: 'tests' },
  ],
  differentials: [],
  management: [
    { id: 'mg-fluid', label: '补液', keywords: ['补液'], sourceQuote: '补液', sourceSection: 'plan' },
    { id: 'mg-insulin', label: '胰岛素静脉泵入', keywords: ['胰岛素'], sourceQuote: '胰岛素静脉泵入', sourceSection: 'plan' },
    { id: 'mg-potassium', label: '补钾', keywords: ['补钾', '钾'], sourceQuote: '补钾', sourceSection: 'plan' },
    { id: 'mg-monitor', label: '监测血糖', keywords: ['监测', '血糖'], sourceQuote: '测末梢血糖', sourceSection: 'plan' },
    { id: 'mg-rate', label: '控制补液速度', keywords: ['补液速度', '速度'], sourceQuote: '控制补液速度', sourceSection: 'plan' },
    { id: 'mg-diet', label: '糖尿病饮食', keywords: ['糖尿病饮食', '饮食'], sourceQuote: '糖尿病饮食', sourceSection: 'plan' },
  ],
};

export const dkaFullSubmission: DiagnosisAnswerInput = {
  primary: '1型糖尿病伴酮症酸中毒',
  secondary: ['维生素D缺乏'],
  evidence: '多饮多尿1周，呕吐伴乏力精神差2天，深大呼吸，血糖32.8mmol/L，血气PH 6.83，HCO3-＜3.0mmol/L，血酮体4.00mmol/L',
  differentials: '',
  management: '补液、胰岛素静脉泵入、补钾、监测血糖、控制补液速度、糖尿病饮食',
};

export const dkaPartialSubmission: DiagnosisAnswerInput = {
  primary: '1型糖尿病伴有酮症酸中毒',
  secondary: [],
  evidence: '多饮多尿1周，深大呼吸',
  differentials: '',
  management: '补液、胰岛素静脉泵入',
};

export const dkaWrongSubmission: DiagnosisAnswerInput = {
  primary: '急性胃肠炎',
  secondary: [],
  evidence: '腹痛腹泻，无脱水',
  differentials: '',
  management: '止泻、口服补液',
};

export const dkaOnlyPrimarySubmission: DiagnosisAnswerInput = {
  primary: '1型糖尿病伴有酮症酸中毒',
  secondary: [],
  evidence: '',
  differentials: '',
  management: '',
};

export const dkaFullJudgements = {
  'evidence:ev-polyuria': { status: 'covered', evidence: '多饮多尿1周' },
  'evidence:ev-vomit': { status: 'covered', evidence: '呕吐伴乏力精神差2天' },
  'evidence:ev-kussmaul': { status: 'covered', evidence: '深大呼吸' },
  'evidence:ev-glucose': { status: 'covered', evidence: '血糖32.8mmol/L' },
  'evidence:ev-acidosis': { status: 'covered', evidence: 'PH 6.83' },
  'evidence:ev-ketone': { status: 'covered', evidence: '血酮体4.00mmol/L' },
  'management:mg-fluid': { status: 'covered', evidence: '补液' },
  'management:mg-insulin': { status: 'covered', evidence: '胰岛素静脉泵入' },
  'management:mg-potassium': { status: 'covered', evidence: '补钾' },
  'management:mg-monitor': { status: 'covered', evidence: '监测血糖' },
  'management:mg-rate': { status: 'covered', evidence: '控制补液速度' },
  'management:mg-diet': { status: 'covered', evidence: '糖尿病饮食' },
} as const;

export const dkaPartialJudgements = {
  'evidence:ev-polyuria': { status: 'covered', evidence: '多饮多尿1周' },
  'evidence:ev-vomit': { status: 'missing' },
  'evidence:ev-kussmaul': { status: 'covered', evidence: '深大呼吸' },
  'evidence:ev-glucose': { status: 'missing' },
  'evidence:ev-acidosis': { status: 'missing' },
  'evidence:ev-ketone': { status: 'missing' },
  'management:mg-fluid': { status: 'covered', evidence: '补液' },
  'management:mg-insulin': { status: 'covered', evidence: '胰岛素静脉泵入' },
  'management:mg-potassium': { status: 'missing' },
  'management:mg-monitor': { status: 'missing' },
  'management:mg-rate': { status: 'missing' },
  'management:mg-diet': { status: 'missing' },
} as const;

export const dkaWrongJudgements = {
  'evidence:ev-polyuria': { status: 'missing' },
  'evidence:ev-vomit': { status: 'missing' },
  'evidence:ev-kussmaul': { status: 'missing' },
  'evidence:ev-glucose': { status: 'missing' },
  'evidence:ev-acidosis': { status: 'missing' },
  'evidence:ev-ketone': { status: 'missing' },
  'management:mg-fluid': { status: 'missing' },
  'management:mg-insulin': { status: 'missing' },
  'management:mg-potassium': { status: 'missing' },
  'management:mg-monitor': { status: 'missing' },
  'management:mg-rate': { status: 'missing' },
  'management:mg-diet': { status: 'missing' },
} as const;

export const dkaOnlyPrimaryJudgements = dkaWrongJudgements;