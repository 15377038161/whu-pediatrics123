import type { AgentEvent, PracticeFocus, Stage } from '@/domain/agent';

/**
 * 专项训练配置域（方案 5.1/5.2）：一个 focus 对应一份紧凑配置。
 * - allowedStages/allowedActions 是服务端门控依据（validateEventStage/validateStageNavigation），
 *   学生不能通过直接调 API 获取专项不应开放的阶段或事实；
 * - providedEvidence 标记系统直接提供的事实（provided），与学生主动问诊/操作获得的
 *   elicited/observed 区分，报告与评分共同使用该来源口径；
 * - 会话创建时写入 scenarioVersion 与 providedEvidence，评分按版本可解释。
 */
export type PracticeCompletion =
  | 'history_summary' // 病史采集：结束采集并提交简短病史摘要（不强制答中评分点）
  | 'exam_observation' // 规范查体：完成本项查体操作，不需要写完整诊断
  | 'safety_decision_plan' // 危重识别：提交识别结论与处理优先级
  | 'communication_end'; // 家长沟通：结束会话，保留未覆盖目标的反馈

export interface PracticeScenario {
  focus: PracticeFocus;
  configVersion: number;
  title: string;
  goal: string;
  /** 开始时提供的目标与必要背景（方案 5.1「阅读目标与必要背景」）。 */
  briefing: string[];
  initialStage: Stage;
  /** 允许的展示阶段（含 report）；服务端导航门控与 UI 阶段条共用。 */
  allowedStages: Stage[];
  /** 允许的事件类型；FINISH_SESSION 恒允许（结束不强制答中评分点）。 */
  allowedActions: Array<AgentEvent['type']>;
  /** 系统直接提供的证据码（标 provided，不计入学生 elicited/observed）。 */
  providedEvidence: string[];
  completion: PracticeCompletion;
  completionHint: string;
  rubricId: string;
  rubricVersion: number;
}

export const PRACTICE_SCENARIO_CONFIG_VERSION = 1;

export const practiceScenarios: Record<PracticeFocus, PracticeScenario> = {
  history: {
    focus: 'history',
    configVersion: 1,
    title: '儿科病史采集',
    goal: '围绕中性主诉完成一次结构化的儿科病史采集',
    briefing: [
      '患儿基本信息与来诊情境已在接诊阶段给出。',
      '本轮只需完成问诊与沟通；查体、辅助检查和诊断不在本专项范围。',
      '完成采集后提交简短病史摘要即可结束；不要求答中全部评分点，可继续补充追问后重新提交。',
    ],
    initialStage: 'triage',
    allowedStages: ['triage', 'history', 'report'],
    allowedActions: ['ASK_QUESTION', 'DOCTOR_INTERVENTION', 'SUBMIT_HISTORY_SUMMARY', 'NAVIGATE_STAGE'],
    providedEvidence: [],
    completion: 'history_summary',
    completionHint: '结束采集前提交简短病史摘要（主诉、现病史要点、重要阴性发现）。',
    rubricId: 'rubric-focused-history',
    rubricVersion: 1,
  },
  exam: {
    focus: 'exam',
    configVersion: 1,
    title: '肺部规范查体',
    goal: '按规范流程完成本病例的重点查体',
    briefing: [
      '本病例的必要病史已由系统直接提供（标记为 provided，不计入你的查体得分）。',
      '先完成手卫生与检查说明，再按「器材 × 部位」逻辑逐项检查；腹部检查请切换仰卧位。',
      '完成本项查体操作后结束训练即可，不需要写完整诊断。',
    ],
    initialStage: 'exam',
    allowedStages: ['exam', 'report'],
    allowedActions: ['EXAM_ACTION', 'NAVIGATE_STAGE'],
    providedEvidence: ['HX_PROVIDED'],
    completion: 'exam_observation',
    completionHint: '完成至少一项有效查体操作后可结束训练，系统按操作证据评分。',
    rubricId: 'rubric-focused-exam',
    rubricVersion: 1,
  },
  safety: {
    focus: 'safety',
    configVersion: 1,
    title: '儿童危重症识别',
    goal: '基于已提供的症状与体征识别危险信号并确定处理优先级',
    briefing: [
      '本场景已提供患儿的症状、病程与初筛生命体征（见右侧病例记录，标记为 provided）。',
      '请判断病情危险程度并说明处理优先级；不要求做出最终病因诊断。',
      '提交病情摘要与初步判断、处置优先级后即完成本项训练。',
    ],
    initialStage: 'assessment',
    allowedStages: ['assessment', 'plan', 'report'],
    allowedActions: ['SUBMIT_DECISION', 'SUBMIT_PLAN', 'NAVIGATE_STAGE'],
    providedEvidence: ['HX_PROVIDED', 'EX_PROVIDED'],
    completion: 'safety_decision_plan',
    completionHint: '提交病情摘要与初步判断、处置优先级后即可结束训练。',
    rubricId: 'rubric-focused-safety',
    rubricVersion: 1,
  },
  communication: {
    focus: 'communication',
    configVersion: 1,
    title: '家长焦虑沟通',
    goal: '向焦虑家长解释病情、风险与后续安排',
    briefing: [
      '情境设定：患儿因发热咳嗽伴气促就诊，初步考虑肺部感染伴低氧风险，已开始氧疗与监测。',
      '家长明确表达焦虑，希望了解孩子的病情、风险和接下来要做什么。',
      '请向家长说明目前情况、可能的风险和下一步安排，回应其顾虑并确认理解。',
      '沟通完成后结束会话即可；未覆盖的目标保留为反馈，不影响结束。',
    ],
    initialStage: 'communication',
    allowedStages: ['communication', 'report'],
    allowedActions: ['SEND_COMMUNICATION', 'NAVIGATE_STAGE'],
    providedEvidence: ['DECISION_PROVIDED', 'PLAN_PROVIDED'],
    completion: 'communication_end',
    completionHint: '完成解释与确认后结束会话，生成沟通专项报告。',
    rubricId: 'rubric-focused-communication',
    rubricVersion: 1,
  },
};

export function getPracticeScenario(focus: PracticeFocus | null | undefined): PracticeScenario | null {
  if (!focus) return null;
  return practiceScenarios[focus] ?? null;
}

/** 专项开始时由系统直接提供的病史（exam/safety 专项用）：
 *  演示病例取核心病史事实的家长陈述；教师病例病史意图为空，返回空（由接诊情境与病例记录承载）。 */
export const PROVIDED_HISTORY_INTENT_IDS = ['onset', 'fever', 'cough', 'danger', 'general'];
