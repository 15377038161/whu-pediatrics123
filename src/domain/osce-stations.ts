import type { AgentEvent, Stage } from '@/domain/agent';

/**
 * OSCE 模拟站契约（方案 15）：产品名统一「OSCE 模拟站」，报告为「模拟参考评分」，
 * 不出现正式考试成绩、教师排考、考试任务、改分和成绩发布流程。
 * - 站点定义是时限、开放动作与量表的唯一来源：页面文案、服务端计时与门控共用本配置，
 *   不把页面固定文案与服务端实际计时写成两个来源；
 * - 服务器保存开始/截止时间（session.startedAt/expiresAt），刷新不能重置计时；
 *   时间到后服务端拒绝新增临床操作（runAgentTurn 按 SESSION_EXPIRED 拒绝，
 *   FINISH_SESSION 仍可用来冻结已确认提交并生成报告）；
 * - 只有标准、资料和技术链都通过的站点才能作为可用站点发布（ready 字段）。
 */

export interface OsceTechnicalInterruptionPolicy {
  /** 平台异常是否暂停计时（站点规则，开始前公布；当前站点为不暂停）。 */
  pausesTimerOnInterruption: boolean;
  /** 时间到后的动作：冻结已确认提交，不代学生补写未确认内容。 */
  expiryAction: 'freeze';
  /** 技术故障记录为过程事件并显示技术影响，不按沉默扣分。 */
  recordsTechnicalInterruptions: boolean;
}

export interface OsceStation {
  stationId: string;
  version: number;
  caseId: string;
  caseVersion: number;
  title: string;
  /** 能力目标（开始前展示）。 */
  capabilityGoals: string[];
  /** 时限（秒）：单一来源，服务端计时与页面倒计时共用。 */
  timeLimitSeconds: number;
  /** 站点开放的动作类型；服务端门控（validateEventStage）与页面按钮共用。 */
  allowedActions: Array<AgentEvent['type']>;
  /** 站点要求的流程阶段（展示用；阶段推进仍由 validateStageNavigation 校验）。 */
  requiredStages: Stage[];
  rubricId: string;
  rubricVersion: number;
  technicalInterruptionPolicy: OsceTechnicalInterruptionPolicy;
  /** 站点发布状态：只有 ready 站点进入可选列表。 */
  ready: boolean;
}

export const OSCE_STATION_CONFIG_VERSION = 1;

/** 教师病例/历史病例的 OSCE 会话未定义专用站点时的默认时限（保持旧 8 分钟行为）。 */
export const DEFAULT_OSCE_TIME_LIMIT_SECONDS = 480;

export const osceStations: OsceStation[] = [
  {
    stationId: 'osce-station-respiratory-fever',
    version: 1,
    caseId: 'peds-respiratory-001',
    caseVersion: 1,
    title: '儿童发热伴气促模拟站',
    capabilityGoals: [
      '自主组织儿科问诊，覆盖危险信号与一般状态',
      '按「器材 × 部位」逻辑完成规范查体',
      '基于证据形成病情摘要与初步判断',
      '确定处置优先级并向家长说明风险与后续安排',
    ],
    timeLimitSeconds: 480,
    allowedActions: [
      'ASK_QUESTION',
      'DOCTOR_INTERVENTION',
      'EXAM_ACTION',
      'ORDER_TEST',
      'SUBMIT_DECISION',
      'SUBMIT_PLAN',
      'SEND_COMMUNICATION',
      'NAVIGATE_STAGE',
      'FINISH_SESSION',
    ],
    requiredStages: ['history', 'exam', 'tests', 'assessment', 'plan', 'communication'],
    rubricId: 'rubric-clinical-flagship',
    rubricVersion: 1,
    technicalInterruptionPolicy: {
      pausesTimerOnInterruption: false,
      expiryAction: 'freeze',
      recordsTechnicalInterruptions: true,
    },
    ready: true,
  },
];

export function getOsceStation(caseId: string): OsceStation | null {
  // 站点定义绑定 caseId；同病例不同版本快照仍属同一站点。
  return osceStations.find((station) => station.caseId === caseId) ?? null;
}

/** 可用站点列表（页面展示用）：只有 ready 站点可作为可用站点发布（方案 15）。 */
export function listReadyStations(): OsceStation[] {
  return osceStations.filter((station) => station.ready);
}

/** 时限展示（mm:ss），页面与服务端共用同一格式。 */
export function formatTimeLimit(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
