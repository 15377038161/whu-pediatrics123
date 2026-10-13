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

export type Actor = 'student' | 'child' | 'parent' | 'tutor' | 'system';
export type Emotion = 'nervous' | 'calm' | 'low' | 'resistant' | 'anxious' | 'neutral';
export type ImmersiveScene = 'arrival' | 'history' | 'exam' | 'tests' | 'assessment' | 'plan' | 'communication' | 'debrief';

export interface UserContext {
  id: string;
  role: AppRole;
  displayName: string;
  avatarUrl?: string | null;
  studentNo: string | null;
  provider: 'preview' | 'chaoxing';
  chaoxingUid: string | null;
}

export interface AgentMessage {
  id: string;
  actor: Actor;
  content: string;
  emotion: Emotion;
  kind: 'dialogue' | 'feedback' | 'safety' | 'navigation';
  createdAt: string;
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
  stage: Stage;
  /** 回看展示阶段（非 OSCE 专用）：查看已完成阶段/返回会话中心时记录 UI 展示阶段，
   *  不修改业务阶段 stage（DB 防回退触发器语义保持）；前进导航时清除。 */
  viewStage?: Stage;
  status: 'active' | 'completed' | 'report_pending';
  startedAt: string;
  updatedAt: string;
  expiresAt: string | null;
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

export type AgentEvent =
  | { type: 'ASK_QUESTION'; data: { text: string } }
  | { type: 'DOCTOR_INTERVENTION'; data: { action: 'child_answer' | 'pause_parent' | 'comfort_child' } }
  | { type: 'EXAM_ACTION'; data: { toolId: string; bodyPartId: string } }
  | { type: 'ORDER_TEST'; data: { testId: string } | { requestedTests: string; reason?: string } }
  | { type: 'SUBMIT_DECISION'; data: { diagnosis: string; summary: string; diagnosisBasis: string; differentials: string } }
  | { type: 'SUBMIT_PLAN'; data: { priority: string; detail: string } }
  | { type: 'SEND_COMMUNICATION'; data: { text: string } }
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
