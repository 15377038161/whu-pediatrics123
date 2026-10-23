export type AppRole = 'student' | 'teacher';
export type SessionMode = 'guided' | 'practice' | 'osce' | 'immersive';
export type PracticeFocus = 'history' | 'exam' | 'safety' | 'communication';
export type Stage =
  | 'triage'
  | 'history'
  | 'exam'
  | 'tests'
  | 'assessment'
  | 'plan'
  | 'communication'
  | 'report';

/** 业务阶段固定顺序（8 阶段，与 case.stages 一致）：分时点事实释放（availableFromStage）的门控依据。 */
export const STAGE_ORDER: readonly Stage[] = ['triage', 'history', 'exam', 'tests', 'assessment', 'plan', 'communication', 'report'];

/** current 是否已达到 required 阶段（含本阶段）；任一阶段未知时 indexOf 为 -1，按 fail-closed 处理。 */
export function stageReached(current: Stage, required: Stage): boolean {
  const currentIndex = STAGE_ORDER.indexOf(current);
  const requiredIndex = STAGE_ORDER.indexOf(required);
  if (currentIndex === -1 || requiredIndex === -1) return false;
  return currentIndex >= requiredIndex;
}

export type Actor = 'student' | 'child' | 'parent' | 'tutor' | 'system';
export type Emotion = 'nervous' | 'calm' | 'low' | 'resistant' | 'anxious' | 'neutral';
export type ImmersiveScene = 'arrival' | 'history' | 'exam' | 'tests' | 'assessment' | 'plan' | 'communication' | 'debrief';

export type IdentitySource = 'server' | 'user' | 'none';

export interface UserContext {
  id: string;
  role: AppRole;
  displayName: string;
  avatarUrl?: string | null;
  studentNo: string | null;
  provider: 'preview' | 'chaoxing';
  chaoxingUid: string | null;
  /**
   * 服务端 getUser() 返回的账户邮箱（auth schema 字段，非用户可改写资料）。
   * 仅在 /api/auth/me 自视图响应中返回给本人（供账户所有者确认教师白名单绑定的键值），
   * 不进入教师端学生列表/CSV 导出等任何他人可见数据。
   */
  email?: string | null;
  /**
   * 姓名来源标注（教师端识别"谁是谁"的信任依据）：
   * - 'server'：应用自有超星 OAuth 服务端写入（app_metadata.chaoxing.displayName，不可由用户自行改写）
   * - 'user'：user_metadata（含平台代理超星 OAuth 首建落地的 realname/full_name/cxid——用户可自行修改，仅作展示，不作权限依据）
   * - 'none'：无任何来源（默认"用户"）
   */
  nameSource?: IdentitySource;
  /** 头像来源标注：'server'（app_metadata.chaoxing.avatar）；'user'（user_metadata.avatar_url 或按用户提供的超星号构造）；'none'（无头像） */
  avatarSource?: IdentitySource;
}

export interface AgentMessage {
  id: string;
  actor: Actor;
  content: string;
  emotion: Emotion;
  kind: 'dialogue' | 'feedback' | 'safety' | 'navigation';
  createdAt: string;
  /**
   * 语音输入元数据（阶段 D，方案 11 章）：学生语音提问经确认发送后记录；
   * 历史消息无此字段（按文字输入处理）。评分只看确认后的语义内容，
   * 语音速度、口音与 ASR 错误不进入能力评分。
   */
  inputMode?: 'voice';
  /** ASR 原始转写（确认前），用于回看学生真实表述与编辑痕迹。 */
  asrRawText?: string;
  /** 学生是否编辑过转写（确认文本与 ASR 原文不一致时为 true）。 */
  transcriptEdited?: boolean;
}

export interface ClinicalEvent {
  id: string;
  clientEventId: string;
  type: AgentEvent['type'];
  stage: Stage;
  summary: string;
  correct: boolean | null;
  evidenceCodes: string[];
  createdAt: string;
}

export interface VitalSigns {
  temperature: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  spo2: number | null;
}

export interface SessionState {
  id: string;
  userId: string;
  caseId: string;
  caseVersion: number;
  mode: SessionMode;
  practiceFocus: PracticeFocus | null;
  /** 专项训练配置版本（方案 5.2）：会话创建时写入，报告按版本可解释；历史会话无此字段。 */
  scenarioVersion?: number;
  /** 系统直接提供的证据码（provided，方案 5.2）：与学生主动获得的 elicited/observed 区分；
   *  历史会话无此字段时按空数组处理。 */
  providedEvidence?: string[];
  /** 病史采集专项的最终提交（方案 5.1 结束条件）：报告快照保留原始提交文本。 */
  historySummary?: string | null;
  /** 查体专项的观察/解释提交（C-观察与报告-04 / C-关联与验收-05）：服务端按专项归属、
   *  绑定配置版本、本会话原查体事件与解锁结果核验 linkedEvidence 关联定位符后写入
   *  （关联定位符/原事件 id/病例版本/提交原文均为服务端核验产物，客户端不自报得分或解锁事实）；
   *  可重复提交修订（examObservation 保留最终提交原文，事件链保留每次提交的发生与关联项记录，
   *  不含全文），报告快照冻结最终提交（含关联定位符与病例版本）。 */
  examObservation?: { findings: string; interpretation: string | null; linkedEvidence: string[]; linkedEventIds: string[]; caseVersion: number; submittedAt: string } | null;
  stage: Stage;
  /** 回看展示阶段（非 OSCE 专用）：查看已完成阶段/返回会话中心时记录 UI 展示阶段，
   *  不修改业务阶段 stage（DB 防回退触发器语义保持）；前进导航时清除。 */
  viewStage?: Stage;
  status: 'active' | 'completed' | 'report_pending';
  startedAt: string;
  updatedAt: string;
  expiresAt: string | null;
  /** OSCE 站点契约（方案 15）：会话创建时写入站点 ID/版本与时限；历史会话无此字段按默认时限。
   *  服务器保存 startedAt/expiresAt，刷新不能重置计时；时间到后 runAgentTurn 拒绝新增临床操作。 */
  osceStation?: { stationId: string; version: number; timeLimitSeconds: number } | null;
  messages: AgentMessage[];
  events: ClinicalEvent[];
  askedIntents: string[];
  preparationActions: string[];
  unlockedEvidence: string[];
  orderedTests: string[];
  decision: {
    diagnosis: string;
    summary: string;
    /** 诊断依据（任务3 必填）：历史会话可能缺失，读取方需可选访问。 */
    diagnosisBasis?: string;
    differentials: string;
  } | null;
  plan: {
    priority: string;
    detail: string;
  } | null;
  communication: string | null;
  childEmotion: Emotion;
  parentInterruption: 'active' | 'paused' | 'supportive';
  behavior: {
    childResponseStyle: 'age_limited' | 'off_topic' | 'brief' | 'cooperative';
    parentResponseStyle: 'interrupting' | 'verbose' | 'concealing' | 'supportive';
    hiddenExposureRevealed: boolean;
    cooperation: number;
  };
  vitals: VitalSigns;
  reportId: string | null;
  /** 会话创建幂等参数指纹；历史会话无此字段。 */
  creationRequest?: string;
  examPosture?: 'standing' | 'supine';
  /** 病例快照版本绑定：首次加载时固定，之后（含重启后）按此版本恢复病例事实，防止召回漂移换患者。 */
  sourceSnapshotVersion?: string | null;
  caseOptions?: {
    sourceName: string;
    complaint?: string;
    age: string;
    sex: string;
    hasSource: boolean;
    exams: Array<{ toolId: string; bodyPartId: string; label: string }>;
    tests: Array<{ id: string; label: string; indication: string }>;
  };
  immersive?: {
    scene: ImmersiveScene;
    sceneStep: number;
    visitedScenes: ImmersiveScene[];
    patientCooperation: number;
  };
}

/** 学生语音轮元数据（阶段 D）：客户端发送 ASK_QUESTION / SEND_COMMUNICATION 时附带；
 *  只记录真实语音轮（inputMode 固定 'voice'），文字输入不附带此字段。 */
export interface EventSpeechMeta {
  inputMode: 'voice';
  asrRawText: string;
  transcriptEdited: boolean;
}

export type AgentEvent =
  | { type: 'ASK_QUESTION'; data: { text: string; speech?: EventSpeechMeta } }
  | { type: 'DOCTOR_INTERVENTION'; data: { action: 'child_answer' | 'pause_parent' | 'comfort_child' } }
  | { type: 'EXAM_ACTION'; data: { toolId: string; bodyPartId: string; posture?: 'standing' | 'supine' } }
  | { type: 'ORDER_TEST'; data: { testId: string } | { requestedTests: string; reason?: string } }
  | { type: 'SUBMIT_DECISION'; data: { diagnosis: string; summary: string; diagnosisBasis: string; differentials: string } }
  | { type: 'SUBMIT_HISTORY_SUMMARY'; data: { summary: string } }
  | { type: 'SUBMIT_EXAM_OBSERVATION'; data: { findings: string; interpretation?: string; linkedEvidence: string[] } }
  | { type: 'SUBMIT_PLAN'; data: { priority: string; detail: string } }
  | { type: 'SEND_COMMUNICATION'; data: { text: string; speech?: EventSpeechMeta } }
  | { type: 'NAVIGATE_STAGE'; data: { stage: Stage } }
  | { type: 'FINISH_SESSION'; data: Record<string, never> };

export interface AgentTurnRequest {
  sessionId: string;
  clientEventId: string;
  event: AgentEvent;
}

export interface AgentTraceItem {
  skill: '角色调度' | '病例状态' | '查体规则' | '知识检索' | '安全校验' | 'OSCE评分';
  label: string;
  sourceIds: string[];
}

export interface AgentTurnResult {
  session: SessionState;
  newMessages: AgentMessage[];
  feedback: string | null;
  trace: AgentTraceItem[];
  runtime?: AgentRuntimeSummary;
}

export interface AgentRuntimeSummary {
  execution: 'deterministic' | 'model' | 'model_fallback';
  model: string | null;
  durationMs: number;
  attempts?: number;
  errorKind?: string;
}

export interface AbilityScores {
  history: number;
  examination: number;
  reasoning: number;
  safety: number;
  communication: number;
  professionalism: number;
}

export interface ScoreEvidence {
  code: string;
  label: string;
  achieved: boolean;
  score: number;
  maxScore: number;
  detail: string;
  eventIds: string[];
  /** 分项评价状态（方案 4.4）：不再只有达成/未达成；历史报告无此字段时按 achieved 布尔降级。 */
  status?: 'achieved' | 'partial' | 'missing' | 'incorrect' | 'not_applicable' | 'not_assessable';
}

export interface TrainingReport {
  /** 生成时固定的学生最终提交，不追溯重写历史报告。 */
  studentDecision?: SessionState['decision'];
  id: string;
  sessionId: string;
  userId: string;
  caseId: string;
  /** 病例显示标题（完成后释放，防透题任务1c）：教师病例为真实病种名（服务端生成时写入），
   *  演示病例沿用症状标题；进行中训练不返回此字段（公开目录为中性标题）。
   *  历史报告无此字段时客户端降级用公开目录标题。 */
  caseTitle?: string;
  mode: SessionMode;
  totalScore: number;
  abilities: AbilityScores;
  evidence: ScoreEvidence[];
  strengths: string[];
  improvements: string[];
  recommendation: string;
  status: 'ready' | 'pending_review';
  scoreBasis?: 'clinical' | 'process';
  /** 专项训练聚焦能力（方案 4.6 快照字段）：完整接诊报告无此字段。 */
  practiceFocus?: PracticeFocus | null;
  /** 评分量表元数据（方案 4.6 快照字段）：历史报告无此字段时显示「历史记录未保存」。 */
  rubricId?: string;
  rubricVersion?: number;
  /** 成绩口径（方案 4.3）：clinical_rubric/process_completion/quiz_accuracy/unscored，
   *  与旧 scoreBasis 有迁移映射（clinical→clinical_rubric，process→process_completion）。 */
  evaluationBasis?: 'clinical_rubric' | 'process_completion' | 'quiz_accuracy' | 'unscored';
  /** 可评价满分（C-观察与报告-04）：生成时按适用计分项满分之和持久化（与前端展示同源），
   *  无法评价/不适用项不计入；历史报告无此字段时前端按量表快照推导展示。 */
  assessableMaxScore?: number;
  /** 未评分标识（C-观察与报告-04）：全部计分项均无法机器评价（not_assessable/not_applicable）
   *  时为 true——总分 0 不代表能力 0 分，不得进入平均分/最好成绩等趋势统计；
   *  历史报告无此字段时由 isUnscoredReport 按快照 evidence 状态推导（不重算分数）。 */
  unscored?: boolean;
  /** 未评分原因（C-观察与报告-04）：缺少判据的具体说明，随报告快照持久化。 */
  unscoredReason?: string;
  /** 原始提交快照（方案 4.6）：生成时冻结学生的全部最终提交原文，不追溯重写历史报告。 */
  studentSubmissions?: {
    decision: SessionState['decision'];
    plan: SessionState['plan'];
    communication: string | null;
    historySummary: string | null;
    /** 查体专项观察/解释提交（C-观察与报告-04）：历史报告无此字段时显示未提交。 */
    examObservation: SessionState['examObservation'];
  };
  createdAt: string;
}

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
}

export type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: ApiError; requestId: string };

export interface SyncEventV1 {
  schemaVersion: 1;
  eventId: string;
  recordType: 'stage_checkpoint' | 'learning_report';
  student: {
    userId: string;
    studentNo: string | null;
    displayName: string;
  };
  case: {
    caseId: string;
    caseVersion: number;
    sessionId: string;
    mode: SessionMode;
    stage: Stage;
  };
  studentInput: string | null;
  agentFeedback: string | null;
  score: number | null;
  evidenceSummary: string | null;
  finalReport: string | null;
  submittedAt: string;
}
