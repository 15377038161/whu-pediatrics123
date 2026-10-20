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

/** 演示病例完整接诊量表（rubric-clinical-flagship v3）：六维 100 分全量分项化。
 *  保持既有证据码（RUBRIC_SAFETY/RUBRIC_EXAM_RESP/RUBRIC_EXAM_OXYGEN/RUBRIC_HISTORY_DANGER/RUBRIC_COMMUNICATION）
 *  不变，新增分项补齐「总分=计分项之和」口径（原证据分项仅覆盖 70/100）。
 *  v2（C-评分补验-01）：沟通项关键词命中降为候选证据；无可评价内容记无法评价。
 *  v3（C-评分补验-02）：沟通质量与能力分分离——共情/风险解释表述仅记候选证据不计分（待教师复核），
 *  能力分只评价可验证的下一步说明（否定表述不计）。
 *  v4（C-评分补验-03）：沟通项整项按不可评价处理——下一步表述真实性同样无法机器可靠区分
 *  （长距离否定/前后矛盾表述可满分），全部表述仅记过程反馈不计分，整项排除出计分与适用满分，
 *  待教师结合提交原文复核。分项结构与展示满分不变，历史 v1-v3 报告不重算（v3 冻结入 legacyRubrics）。 */
export const flagshipClinicalRubric: RubricDefinition = {
  id: 'rubric-clinical-flagship',
  version: 4,
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
    { itemId: 'COMMUNICATION', dimension: 'communication', label: '家长沟通', maxScore: 10, applicability: '演示病例完整接诊（沟通项整项无法机器可靠评价，记无法评价不计分）', evidenceRule: '沟通表述（下一步安排/共情/风险解释）无法机器可靠评价：表述命中仅记过程反馈（写入说明，原文保留在提交快照），整项记无法评价、排除出计分与适用满分，待教师结合提交原文复核', partialCredit: null, feedback: '沟通表述待教师结合提交原文复核。', reference: '家长沟通要素' },
    { itemId: 'PROFESSIONALISM', dimension: 'professionalism', label: '职业素养', maxScore: 5, applicability: '演示病例完整接诊', evidenceRule: '完成手卫生 2 分；使用安抚干预 2 分；手卫生先于任何接触性查体 1 分', partialCredit: '按构成部分计分', feedback: '未形成职业素养证据。', reference: '查体顺序与安抚' },
  ],
};

/** 专项量表（方案 4.5 权重结构）：分数只评价本专项，不因未开放环节扣分。
 *  适用满分口径（方案 4.4）：总满分=适用计分项满分之和，not_applicable/not_assessable 项
 *  不计入适用满分（报告展示层按证据状态排除），不适用项不记零分（maxScore 为 0 仅作展示）。 */
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
    version: 4,
    name: '肺部规范查体专项量表',
    scope: 'focused',
    focus: 'exam',
    evaluationBasis: 'clinical_rubric',
    items: [
      { itemId: 'EX_PREPARATION', dimension: 'examination', label: '准备与说明', maxScore: 20, applicability: '规范查体专项', evidenceRule: '完成手卫生与检查说明', partialCredit: null, feedback: '未完成手卫生与检查说明。', reference: '标准预防' },
      { itemId: 'EX_LUNG_AUSCULTATION', dimension: 'examination', label: '肺部听诊', maxScore: 20, applicability: '规范查体专项', evidenceRule: '听诊器×胸部获得肺部听诊证据', partialCredit: null, feedback: '未完成肺部听诊。', reference: '肺部听诊规范' },
      { itemId: 'EX_OXIMETRY', dimension: 'examination', label: '血氧监测', maxScore: 15, applicability: '规范查体专项', evidenceRule: '血氧仪获得静息血氧结果', partialCredit: null, feedback: '未完成血氧监测。', reference: '脉搏血氧监测' },
      { itemId: 'EX_SEQUENCE', dimension: 'examination', label: '顺序与安全', maxScore: 25, applicability: '规范查体专项', evidenceRule: '手卫生先于任何接触性检查 15；未出现未备即查的深层检查 10', partialCredit: '备后补序 12 分', feedback: '查体顺序不合规（未先手卫生或存在未备即查）。', reference: '查体顺序规范' },
      { itemId: 'EX_FINDINGS', dimension: 'examination', label: '结果识别', maxScore: 20, applicability: '规范查体专项（查体操作点击仅为过程证据）', evidenceRule: '本专项未开放观察/推理提交入口（服务端事件门控 SUBMIT_DECISION 拒绝），操作点击仅为过程证据，本项恒记无法评价不计分；观察/解释提交通道与可靠核对判据缺失为已知 C 待办，待教师结合查体记录复核', partialCredit: null, feedback: '缺少可评价结果识别的观察/推理提交。', reference: '查体所见识别' },
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
    version: 4,
    name: '家长焦虑沟通专项量表',
    scope: 'focused',
    focus: 'communication',
    evaluationBasis: 'clinical_rubric',
    items: [
      { itemId: 'CM_CONCERN_RESPONSE', dimension: 'communication', label: '回应顾虑', maxScore: 25, applicability: '家长沟通专项（沟通质量项：记候选证据待教师复核，本项不机器计分）', evidenceRule: '回应顾虑属沟通质量项，无法机器可靠评价：命中候选表达（理解/担心等）记候选证据，本项记无法评价，待教师结合提交原文复核', partialCredit: null, feedback: '未回应家长顾虑与情绪。', reference: '共情沟通' },
      { itemId: 'CM_PLAIN_EXPLANATION', dimension: 'communication', label: '通俗解释', maxScore: 25, applicability: '家长沟通专项（沟通质量项：记候选证据待教师复核，本项不机器计分）', evidenceRule: '解释通俗性属沟通质量项，无法机器可靠评价：命中风险相关表述（呼吸/血氧/危险等）记候选证据，本项记无法评价，待教师结合提交原文复核', partialCredit: null, feedback: '未用通俗语言解释病情与风险。', reference: '风险沟通' },
      { itemId: 'CM_UNDERSTANDING_CHECK', dimension: 'communication', label: '核实理解', maxScore: 20, applicability: '家长沟通专项（沟通表述项：命中仅记候选/过程反馈，本项不机器计分）', evidenceRule: '核实理解表述无法机器可靠区分真实核实与模板化/长距离否定/前后矛盾表述：命中表述（还有什么问题/明白吗等）仅记候选/过程反馈，本项记无法评价，待教师结合提交原文复核', partialCredit: null, feedback: '未核实家长理解情况。', reference: 'teach-back 沟通' },
      { itemId: 'CM_NEXT_STEPS', dimension: 'communication', label: '后续安排', maxScore: 20, applicability: '家长沟通专项（沟通表述项：命中仅记候选/过程反馈，本项不机器计分）', evidenceRule: '后续安排表述无法机器可靠区分真实安排与模板化/长距离否定/前后矛盾表述：命中表述（监测/检查/处理等）仅记候选/过程反馈，本项记无法评价，待教师结合提交原文复核', partialCredit: null, feedback: '未说明后续安排。', reference: '后续安排告知' },
      { itemId: 'CM_RESPECTFUL_TONE', dimension: 'communication', label: '尊重与表达', maxScore: 10, applicability: '家长沟通专项（沟通质量项：记候选证据待教师复核，本项不机器计分）', evidenceRule: '语气尊重性属沟通质量项，无法机器可靠评价：命中安抚候选表达记候选证据，本项记无法评价，待教师结合提交原文复核', partialCredit: null, feedback: '表达缺少尊重与安抚性语言。', reference: '尊重表达' },
    ],
  },
};

/** 按报告快照（rubricId+rubricVersion）精确查找量表定义（C-评分补验-02）：
 *  仅在当前版本与历史冻结版本注册表中精确匹配，不回退同 id 的当前量表——
 *  避免把新版本规则说明套用于旧版本历史报告；快照引用的历史版本未存档时返回
 *  undefined（展示层明确缺失，不借新规则解释旧分、不重算旧报告）。 */
export function findRubricForReport(report: { rubricId?: string; rubricVersion?: number }): RubricDefinition | undefined {
  if (!report.rubricId || report.rubricVersion === undefined) return undefined;
  return [...[flagshipClinicalRubric, ...Object.values(focusedRubrics)], ...legacyRubrics].find(
    (rubric) => rubric.id === report.rubricId && rubric.version === report.rubricVersion,
  );
}

export function rubricStatusForDisplay(status: RubricItemStatus): string {
  return ({ achieved: '达成', partial: '部分达成', missing: '未达成', incorrect: '错误做法', not_applicable: '不适用', not_assessable: '无法评价' } as const)[status];
}

/** 历史量表版本冻结注册表（C-评分补验-02/-03）：仅收录已停用版本的冻结副本，
 *  供历史报告展示精确匹配（id+version），不参与新会话评分（scoring 恒用上方当前版本），
 *  不随当前版本规则更新而改写——旧报告的量表名称与规则说明以其生成时版本为准，旧分不重算。
 *  v3 三份（flagship/exam/communication）于 C-评分补验-03 升 v4 时冻结收录。 */
export const legacyRubrics: RubricDefinition[] = [
  {
    // C-评分补验-03 冻结：rubric-clinical-flagship v3（C-评分补验-02 定稿原文），仅供 v3 历史报告展示。
    id: 'rubric-clinical-flagship',
    version: 3,
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
      { itemId: 'COMMUNICATION', dimension: 'communication', label: '家长沟通', maxScore: 10, applicability: '演示病例完整接诊（无可评价病例内容的沟通记无法评价）', evidenceRule: '沟通原文须含病例相关实际内容方可评价：明确下一步安排（否定表述不计）3 分；共情与风险解释表述记候选证据不计分，沟通质量待教师复核', partialCredit: '仅可验证部分计分，质量部分记候选证据待复核', feedback: '沟通中缺少可验证的下一步安排；共情与风险解释质量待教师复核。', reference: '家长沟通要素' },
      { itemId: 'PROFESSIONALISM', dimension: 'professionalism', label: '职业素养', maxScore: 5, applicability: '演示病例完整接诊', evidenceRule: '完成手卫生 2 分；使用安抚干预 2 分；手卫生先于任何接触性查体 1 分', partialCredit: '按构成部分计分', feedback: '未形成职业素养证据。', reference: '查体顺序与安抚' },
    ],
  },
  {
    // C-评分补验-03 冻结：rubric-focused-exam v3（C-评分补验-02 定稿原文），仅供 v3 历史报告展示。
    id: 'rubric-focused-exam',
    version: 3,
    name: '肺部规范查体专项量表',
    scope: 'focused',
    focus: 'exam',
    evaluationBasis: 'clinical_rubric',
    items: [
      { itemId: 'EX_PREPARATION', dimension: 'examination', label: '准备与说明', maxScore: 20, applicability: '规范查体专项', evidenceRule: '完成手卫生与检查说明', partialCredit: null, feedback: '未完成手卫生与检查说明。', reference: '标准预防' },
      { itemId: 'EX_LUNG_AUSCULTATION', dimension: 'examination', label: '肺部听诊', maxScore: 20, applicability: '规范查体专项', evidenceRule: '听诊器×胸部获得肺部听诊证据', partialCredit: null, feedback: '未完成肺部听诊。', reference: '肺部听诊规范' },
      { itemId: 'EX_OXIMETRY', dimension: 'examination', label: '血氧监测', maxScore: 15, applicability: '规范查体专项', evidenceRule: '血氧仪获得静息血氧结果', partialCredit: null, feedback: '未完成血氧监测。', reference: '脉搏血氧监测' },
      { itemId: 'EX_SEQUENCE', dimension: 'examination', label: '顺序与安全', maxScore: 25, applicability: '规范查体专项', evidenceRule: '手卫生先于任何接触性检查 15；未出现未备即查的深层检查 10', partialCredit: '备后补序 12 分', feedback: '查体顺序不合规（未先手卫生或存在未备即查）。', reference: '查体顺序规范' },
      { itemId: 'EX_FINDINGS', dimension: 'examination', label: '结果识别', maxScore: 20, applicability: '规范查体专项（查体操作点击仅为过程证据）', evidenceRule: '本专项未开放观察/推理提交入口，仅有操作点击记无法评价；如存在提交文本（异常路径），须与本会话已解锁病例查体所见可靠核对一致方可评价，否定病例所见计错误做法', partialCredit: null, feedback: '缺少可评价结果识别的观察/推理提交。', reference: '查体所见识别' },
    ],
  },
  {
    // C-评分补验-03 冻结：rubric-focused-communication v3（C-评分补验-02 定稿原文），仅供 v3 历史报告展示。
    id: 'rubric-focused-communication',
    version: 3,
    name: '家长焦虑沟通专项量表',
    scope: 'focused',
    focus: 'communication',
    evaluationBasis: 'clinical_rubric',
    items: [
      { itemId: 'CM_CONCERN_RESPONSE', dimension: 'communication', label: '回应顾虑', maxScore: 25, applicability: '家长沟通专项（沟通质量项：记候选证据待教师复核，本项不机器计分）', evidenceRule: '回应顾虑属沟通质量项，无法机器可靠评价：命中候选表达（理解/担心等）记候选证据，本项记无法评价，待教师结合提交原文复核', partialCredit: null, feedback: '未回应家长顾虑与情绪。', reference: '共情沟通' },
      { itemId: 'CM_PLAIN_EXPLANATION', dimension: 'communication', label: '通俗解释', maxScore: 25, applicability: '家长沟通专项（沟通质量项：记候选证据待教师复核，本项不机器计分）', evidenceRule: '解释通俗性属沟通质量项，无法机器可靠评价：命中风险相关表述（呼吸/血氧/危险等）记候选证据，本项记无法评价，待教师结合提交原文复核', partialCredit: null, feedback: '未用通俗语言解释病情与风险。', reference: '风险沟通' },
      { itemId: 'CM_UNDERSTANDING_CHECK', dimension: 'communication', label: '核实理解', maxScore: 20, applicability: '家长沟通专项（无可评价病例内容的沟通记无法评价）', evidenceRule: '主动核实家长是否理解（还有什么问题/明白吗等，否定表述不计）', partialCredit: null, feedback: '未核实家长理解情况。', reference: 'teach-back 沟通' },
      { itemId: 'CM_NEXT_STEPS', dimension: 'communication', label: '后续安排', maxScore: 20, applicability: '家长沟通专项（无可评价病例内容的沟通记无法评价）', evidenceRule: '说明下一步监测/检查/处理安排（否定表述不计）', partialCredit: null, feedback: '未说明后续安排。', reference: '后续安排告知' },
      { itemId: 'CM_RESPECTFUL_TONE', dimension: 'communication', label: '尊重与表达', maxScore: 10, applicability: '家长沟通专项（沟通质量项：记候选证据待教师复核，本项不机器计分）', evidenceRule: '语气尊重性属沟通质量项，无法机器可靠评价：命中安抚候选表达记候选证据，本项记无法评价，待教师结合提交原文复核', partialCredit: null, feedback: '表达缺少尊重与安抚性语言。', reference: '尊重表达' },
    ],
  },
  {
    id: 'rubric-clinical-flagship',
    version: 2,
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
      { itemId: 'COMMUNICATION', dimension: 'communication', label: '家长沟通', maxScore: 10, applicability: '演示病例完整接诊（无可评价病例内容的沟通记无法评价）', evidenceRule: '沟通原文须含病例相关实际内容方可评价：共情候选词 2 分（待教师复核）；解释呼吸/血氧风险 4 分；明确下一步 3 分', partialCredit: '共情候选词部分计分；无病例相关实际内容记无法评价', feedback: '沟通中仍缺少共情、风险解释或明确的下一步。', reference: '家长沟通要素' },
      { itemId: 'PROFESSIONALISM', dimension: 'professionalism', label: '职业素养', maxScore: 5, applicability: '演示病例完整接诊', evidenceRule: '完成手卫生 2 分；使用安抚干预 2 分；手卫生先于任何接触性查体 1 分', partialCredit: '按构成部分计分', feedback: '未形成职业素养证据。', reference: '查体顺序与安抚' },
    ],
  },
  {
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
  },
  {
    id: 'rubric-focused-exam',
    version: 2,
    name: '肺部规范查体专项量表',
    scope: 'focused',
    focus: 'exam',
    evaluationBasis: 'clinical_rubric',
    items: [
      { itemId: 'EX_PREPARATION', dimension: 'examination', label: '准备与说明', maxScore: 20, applicability: '规范查体专项', evidenceRule: '完成手卫生与检查说明', partialCredit: null, feedback: '未完成手卫生与检查说明。', reference: '标准预防' },
      { itemId: 'EX_LUNG_AUSCULTATION', dimension: 'examination', label: '肺部听诊', maxScore: 20, applicability: '规范查体专项', evidenceRule: '听诊器×胸部获得肺部听诊证据', partialCredit: null, feedback: '未完成肺部听诊。', reference: '肺部听诊规范' },
      { itemId: 'EX_OXIMETRY', dimension: 'examination', label: '血氧监测', maxScore: 15, applicability: '规范查体专项', evidenceRule: '血氧仪获得静息血氧结果', partialCredit: null, feedback: '未完成血氧监测。', reference: '脉搏血氧监测' },
      { itemId: 'EX_SEQUENCE', dimension: 'examination', label: '顺序与安全', maxScore: 25, applicability: '规范查体专项', evidenceRule: '手卫生先于任何接触性检查 15；未出现未备即查的深层检查 10', partialCredit: '备后补序 12 分', feedback: '查体顺序不合规（未先手卫生或存在未备即查）。', reference: '查体顺序规范' },
      { itemId: 'EX_FINDINGS', dimension: 'examination', label: '结果识别', maxScore: 20, applicability: '规范查体专项（查体操作点击仅为过程证据）', evidenceRule: '学生观察/推理提交锚定本病例查体所见≥2 项达成、1 项部分；仅有操作点击记无法评价', partialCredit: '锚定 1 项查体所见 12 分', feedback: '缺少可评价结果识别的观察/推理提交。', reference: '查体所见识别' },
    ],
  },
  {
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
  {
    id: 'rubric-focused-communication',
    version: 2,
    name: '家长焦虑沟通专项量表',
    scope: 'focused',
    focus: 'communication',
    evaluationBasis: 'clinical_rubric',
    items: [
      { itemId: 'CM_CONCERN_RESPONSE', dimension: 'communication', label: '回应顾虑', maxScore: 25, applicability: '家长沟通专项（无可评价病例内容的沟通记无法评价）', evidenceRule: '共情候选表达按过程证据部分计分，最终沟通质量待教师复核', partialCredit: '候选表达 15 分', feedback: '未回应家长顾虑与情绪。', reference: '共情沟通' },
      { itemId: 'CM_PLAIN_EXPLANATION', dimension: 'communication', label: '通俗解释', maxScore: 25, applicability: '家长沟通专项（无可评价病例内容的沟通记无法评价）', evidenceRule: '具体解释呼吸/血氧/危险 25；仅一般病情说明 15', partialCredit: '一般说明 15 分', feedback: '未用通俗语言解释病情与风险。', reference: '风险沟通' },
      { itemId: 'CM_UNDERSTANDING_CHECK', dimension: 'communication', label: '核实理解', maxScore: 20, applicability: '家长沟通专项（无可评价病例内容的沟通记无法评价）', evidenceRule: '主动核实家长是否理解（还有什么问题/明白吗等）', partialCredit: null, feedback: '未核实家长理解情况。', reference: 'teach-back 沟通' },
      { itemId: 'CM_NEXT_STEPS', dimension: 'communication', label: '后续安排', maxScore: 20, applicability: '家长沟通专项（无可评价病例内容的沟通记无法评价）', evidenceRule: '说明下一步监测/检查/处理安排', partialCredit: null, feedback: '未说明后续安排。', reference: '后续安排告知' },
      { itemId: 'CM_RESPECTFUL_TONE', dimension: 'communication', label: '尊重与表达', maxScore: 10, applicability: '家长沟通专项（无可评价病例内容的沟通记无法评价）', evidenceRule: '安抚性候选表达按过程证据部分计分，最终沟通质量待教师复核', partialCredit: '候选表达 6 分', feedback: '表达缺少尊重与安抚性语言。', reference: '尊重表达' },
    ],
  },
  {
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
];
