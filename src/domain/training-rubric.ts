import type { AbilityScores, PracticeFocus } from '@/domain/agent';

/**
 * 已审核量表定义域（方案 4.4/4.5）：量表定义保存在此，`src/lib/scoring.ts` 只执行规则。
 * - 总分必须等于所有计分项之和；总满分必须等于适用计分项满分之和；
 * - 评价项状态采用 achieved/partial/missing/incorrect/not_applicable/not_assessable，
 *   不适用项不记零分（maxScore 为 0 仅作展示）；
 * - 权重为待教师审定的产品讨论稿（方案 4.5），不是临床标准。
 */

export type RubricItemStatus =
  | 'achieved'
  | 'partial'
  | 'missing'
  | 'incorrect'
  | 'not_applicable'
  | 'not_assessable';

/** 成绩口径（方案 4.3）：与旧 scoreBasis 有明确迁移映射（clinical→clinical_rubric，process→process_completion）。 */
export type EvaluationBasis =
  | 'clinical_rubric'
  | 'process_completion'
  | 'quiz_accuracy'
  | 'unscored';

export interface RubricItem {
  itemId: string;
  dimension: keyof AbilityScores;
  label: string;
  maxScore: number;
  /** 适用条件（applicability）。 */
  applicability: string;
  /** 证据规则（evidenceRule）：执行器按此规则取证据，规则文本随量表版本审核。 */
  evidenceRule: string;
  /** 部分得分规则（partialCredit）；无可写 null。 */
  partialCredit: string | null;
  /** 未达成时的反馈。 */
  feedback: string;
  /** 评价依据说明（reference）。 */
  reference: string;
}

export interface RubricDefinition {
  id: string;
  version: number;
  name: string;
  scope: 'clinical' | 'focused';
  focus?: PracticeFocus;
  evaluationBasis: EvaluationBasis;
  items: RubricItem[];
}

/** 演示病例完整接诊量表（rubric-clinical-flagship v1）：六维 100 分全量分项化。
 *  保持既有证据码（RUBRIC_SAFETY/RUBRIC_EXAM_RESP/RUBRIC_EXAM_OXYGEN/RUBRIC_HISTORY_DANGER/RUBRIC_COMMUNICATION）
 *  不变，新增分项补齐「总分=计分项之和」口径（原证据分项仅覆盖 70/100）。 */
export const flagshipClinicalRubric: RubricDefinition = {
  id: 'rubric-clinical-flagship',
  version: 1,
  name: '儿童呼吸道病例完整接诊量表',
  scope: 'clinical',
  evaluationBasis: 'clinical_rubric',
  items: [
    { itemId: 'HISTORY_PRESENTING', dimension: 'history', label: '主诉与现病史要点', maxScore: 10, applicability: '演示病例完整接诊', evidenceRule: '问诊获得起病/发热/咳嗽/院前用药四项要点，每项部分计分', partialCredit: '起病 3、发热 3、咳嗽 2、用药 2', feedback: '尚未获得主诉与现病史要点证据。', reference: '儿童肺炎问诊要点' },
    { itemId: 'HISTORY_DANGER', dimension: 'history', label: '呼吸危险信号问诊', maxScore: 8, applicability: '演示病例完整接诊', evidenceRule: '主动询问气促、喘憋或青紫等危险信号', partialCredit: null, feedback: '未形成呼吸困难、青紫等危险信号的有效追问证据。', reference: '儿童呼吸危险信号' },
    { itemId: 'HISTORY_GENERAL', dimension: 'history', label: '一般状态问诊', maxScore: 3, applicability: '演示病例完整接诊', evidenceRule: '询问精神、进食、尿量等一般状态', partialCredit: null, feedback: '未询问一般状态。', reference: '儿科一般状态评估' },
    { itemId: 'HISTORY_EXPOSURE', dimension: 'history', label: '接触史问诊', maxScore: 2, applicability: '演示病例完整接诊', evidenceRule: '询问接触史与诱因', partialCredit: null, feedback: '未询问接触史。', reference: '流行病学接触史' },
    { itemId: 'HISTORY_BACKGROUND', dimension: 'history', label: '预防接种/出生/过敏史问诊', maxScore: 2, applicability: '演示病例完整接诊', evidenceRule: '询问预防接种、出生发育或过敏既往史之一', partialCredit: null, feedback: '未询问相关背景病史。', reference: '儿童背景病史' },
    { itemId: 'EXAM_PREP', dimension: 'examination', label: '查体前准备', maxScore: 4, applicability: '演示病例完整接诊', evidenceRule: '完成手卫生与检查说明', partialCredit: null, feedback: '未完成查体前准备。', reference: '标准预防与查体礼仪' },
    { itemId: 'EXAM_RESP', dimension: 'examination', label: '肺部重点查体', maxScore: 10, applicability: '演示病例完整接诊', evidenceRule: '听诊器×胸部获得肺部听诊证据', partialCredit: null, feedback: '未通过正确器材、部位和准备动作获得肺部听诊证据。', reference: '肺部体格检查规范' },
    { itemId: 'EXAM_OXYGEN', dimension: 'examination', label: '低氧识别', maxScore: 7, applicability: '演示病例完整接诊', evidenceRule: '血氧仪获得静息血氧结果', partialCredit: null, feedback: '未完成血氧监测，低氧判断缺少直接证据。', reference: '脉搏血氧监测' },
    { itemId: 'EXAM_OTHER', dimension: 'examination', label: '其他部位系统检查', maxScore: 4, applicability: '演示病例完整接诊', evidenceRule: '完成体温/口咽/血压等其他部位检查之一', partialCredit: null, feedback: '未完成其他部位系统检查。', reference: '系统体格检查' },
    { itemId: 'REASONING_PRIMARY', dimension: 'reasoning', label: '主要诊断识别', maxScore: 10, applicability: '演示病例完整接诊', evidenceRule: '诊断与摘要包含本病例主要诊断方向（否定表述不计）', partialCredit: null, feedback: '诊断未覆盖本病例主要问题。', reference: '儿童肺炎诊断要点' },
    { itemId: 'REASONING_RISK', dimension: 'reasoning', label: '低氧与危险识别', maxScore: 6, applicability: '演示病例完整接诊', evidenceRule: '识别低氧、呼吸困难等危险信号（否定表述不计）', partialCredit: null, feedback: '未识别低氧等危险信号。', reference: '低氧识别' },
    { itemId: 'REASONING_DIFFERENTIAL', dimension: 'reasoning', label: '鉴别诊断', maxScore: 4, applicability: '演示病例完整接诊', evidenceRule: '鉴别诊断含鉴别方向与理由表述', partialCredit: '仅列举疾病名词 2 分', feedback: '未提供鉴别诊断思路。', reference: '鉴别诊断表达' },
    { itemId: 'SAFETY', dimension: 'safety', label: '患者安全与处置优先级', maxScore: 15, applicability: '演示病例完整接诊', evidenceRule: '首要处置稳定生命体征 8 分；安排进一步评估 4 分；无不安全出院 3 分；出现不安全出院表述计 incorrect', partialCredit: '按构成部分计分', feedback: '处置未同时覆盖生命体征稳定和进一步评估。', reference: '患者安全优先级' },
    { itemId: 'COMMUNICATION', dimension: 'communication', label: '家长沟通', maxScore: 10, applicability: '演示病例完整接诊', evidenceRule: '共情 3 分；解释风险 4 分；明确下一步 3 分', partialCredit: '按构成部分计分', feedback: '沟通中仍缺少共情、风险解释或明确的下一步。', reference: '家长沟通要素' },
    { itemId: 'PROFESSIONALISM', dimension: 'professionalism', label: '职业素养', maxScore: 5, applicability: '演示病例完整接诊', evidenceRule: '完成手卫生 2 分；使用安抚干预 2 分；手卫生先于任何接触性查体 1 分', partialCredit: '按构成部分计分', feedback: '未形成职业素养证据。', reference: '查体顺序与安抚' },
  ],
};

/** 专项量表（方案 4.5 权重结构）：分数只评价本专项，不因未开放环节扣分。 */
export const focusedRubrics: Record<PracticeFocus, RubricDefinition> = {
  history: {
    id: 'rubric-focused-history',
    version: 1,
    name: '儿科病史采集专项量表',
    scope: 'focused',
    focus: 'history',
    evaluationBasis: 'clinical_rubric',
    items: [
      { itemId: 'HX_PRESENTING', dimension: 'history', label: '主诉及现病史', maxScore: 35, applicability: '病史采集专项', evidenceRule: '问诊获得起病 10、发热 10、咳嗽 8、院前用药 7', partialCredit: '按要点部分计分', feedback: '主诉与现病史要点尚未问全。', reference: '儿科病史采集要点' },
      { itemId: 'HX_RED_FLAGS', dimension: 'history', label: '病例重点追问', maxScore: 30, applicability: '病史采集专项', evidenceRule: '追问呼吸危险信号 18、一般状态 12', partialCredit: '按要点部分计分', feedback: '危险信号与一般状态追问不足。', reference: '儿童呼吸危险信号' },
      { itemId: 'HX_BACKGROUND', dimension: 'history', label: '相关背景', maxScore: 20, applicability: '病史采集专项', evidenceRule: '接触史 7、预防接种 5、出生发育 4、过敏既往 4', partialCredit: '按要点部分计分', feedback: '相关背景病史尚未覆盖。', reference: '儿童背景病史' },
      { itemId: 'HX_ORGANIZATION', dimension: 'history', label: '提问组织', maxScore: 15, applicability: '病史采集专项', evidenceRule: '宽泛无效提问占比低（≤20% 达成，≤45% 部分达成）', partialCredit: '有效提问比例分档', feedback: '提问组织性不足，问题偏宽泛。', reference: '问诊组织性' },
    ],
  },
  exam: {
    id: 'rubric-focused-exam',
    version: 1,
    name: '肺部规范查体专项量表',
    scope: 'focused',
    focus: 'exam',
    evaluationBasis: 'clinical_rubric',
    items: [
      { itemId: 'EX_PREPARATION', dimension: 'examination', label: '准备与说明', maxScore: 20, applicability: '规范查体专项', evidenceRule: '完成手卫生与检查说明', partialCredit: null, feedback: '未完成手卫生与检查说明。', reference: '标准预防' },
      { itemId: 'EX_LUNG_AUSCULTATION', dimension: 'examination', label: '肺部听诊', maxScore: 20, applicability: '规范查体专项', evidenceRule: '听诊器×胸部获得肺部听诊证据', partialCredit: null, feedback: '未完成肺部听诊。', reference: '肺部听诊规范' },
      { itemId: 'EX_OXIMETRY', dimension: 'examination', label: '血氧监测', maxScore: 15, applicability: '规范查体专项', evidenceRule: '血氧仪获得静息血氧结果', partialCredit: null, feedback: '未完成血氧监测。', reference: '脉搏血氧监测' },
      { itemId: 'EX_SEQUENCE', dimension: 'examination', label: '顺序与安全', maxScore: 25, applicability: '规范查体专项', evidenceRule: '手卫生先于任何接触性检查 15；未出现未备即查的深层检查 10', partialCredit: '备后补序 12 分', feedback: '查体顺序不合规（未先手卫生或存在未备即查）。', reference: '查体顺序规范' },
      { itemId: 'EX_FINDINGS', dimension: 'examination', label: '结果识别', maxScore: 20, applicability: '规范查体专项', evidenceRule: '额外有效查体组合≥2 项达成、1 项部分', partialCredit: '1 项 12 分', feedback: '有效查体覆盖不足。', reference: '系统查体广度' },
    ],
  },
  safety: {
    id: 'rubric-focused-safety',
    version: 1,
    name: '儿童危重症识别专项量表',
    scope: 'focused',
    focus: 'safety',
    evaluationBasis: 'clinical_rubric',
    items: [
      { itemId: 'SIG_DANGER_RECOGNITION', dimension: 'safety', label: '危险信号识别', maxScore: 30, applicability: '危重识别专项', evidenceRule: '识别气促/呼吸困难/低氧/青紫等特异危险信号 30；仅一般严重度表述 15', partialCredit: '一般严重度 15 分', feedback: '未识别特异危险信号。', reference: '儿童危重筛查' },
      { itemId: 'SIG_CONCLUSION_BASIS', dimension: 'reasoning', label: '识别结论与依据', maxScore: 35, applicability: '危重识别专项', evidenceRule: '提交病情摘要与判断且依据锚定症状体征 35；仅提交无体征锚定 20', partialCredit: '未锚定体征 20 分', feedback: '识别结论缺少症状体征依据。', reference: '病情摘要规范' },
      { itemId: 'SIG_PRIORITY', dimension: 'safety', label: '处置优先级', maxScore: 35, applicability: '危重识别专项', evidenceRule: '首要处置含氧疗/监护稳定 35；仅进一步评估 18；出现不安全出院计 incorrect', partialCredit: '仅评估安排 18 分', feedback: '处置优先级未覆盖稳定生命体征。', reference: '危重处置优先级' },
    ],
  },
  communication: {
    id: 'rubric-focused-communication',
    version: 1,
    name: '家长焦虑沟通专项量表',
    scope: 'focused',
    focus: 'communication',
    evaluationBasis: 'clinical_rubric',
    items: [
      { itemId: 'CM_CONCERN_RESPONSE', dimension: 'communication', label: '回应顾虑', maxScore: 25, applicability: '家长沟通专项（关键词为候选证据，质量待教师复核）', evidenceRule: '沟通中包含共情回应表述', partialCredit: null, feedback: '未回应家长顾虑与情绪。', reference: '共情沟通' },
      { itemId: 'CM_PLAIN_EXPLANATION', dimension: 'communication', label: '通俗解释', maxScore: 25, applicability: '家长沟通专项（关键词为候选证据，质量待教师复核）', evidenceRule: '具体解释呼吸/血氧/危险 25；仅一般病情说明 15', partialCredit: '一般说明 15 分', feedback: '未用通俗语言解释病情与风险。', reference: '风险沟通' },
      { itemId: 'CM_UNDERSTANDING_CHECK', dimension: 'communication', label: '核实理解', maxScore: 20, applicability: '家长沟通专项', evidenceRule: '主动核实家长是否理解（还有什么问题/明白吗等）', partialCredit: null, feedback: '未核实家长理解情况。', reference: 'teach-back 沟通' },
      { itemId: 'CM_NEXT_STEPS', dimension: 'communication', label: '后续安排', maxScore: 20, applicability: '家长沟通专项', evidenceRule: '说明下一步监测/检查/处理安排', partialCredit: null, feedback: '未说明后续安排。', reference: '后续安排告知' },
      { itemId: 'CM_RESPECTFUL_TONE', dimension: 'communication', label: '尊重与表达', maxScore: 10, applicability: '家长沟通专项（关键词为候选证据，质量待教师复核）', evidenceRule: '使用陪伴/安抚性表达', partialCredit: null, feedback: '表达缺少尊重与安抚性语言。', reference: '尊重表达' },
    ],
  },
};

export function rubricStatusForDisplay(status: RubricItemStatus): string {
  return ({ achieved: '达成', partial: '部分达成', missing: '未达成', incorrect: '错误做法', not_applicable: '不适用', not_assessable: '无法评价' } as const)[status];
}
