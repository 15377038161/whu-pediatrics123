export type AppRole = 'student' | 'teacher';
export type SessionMode = 'guided' | 'practice' | 'osce';
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
  temperature: number;
  heartRate: number;
  respiratoryRate: number;
  spo2: number;
}

export interface SessionState {
  id: string;
  userId: string;
  caseId: string;
  caseVersion: number;
  mode: SessionMode;
  stage: Stage;
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
}

export type AgentEvent =
  | { type: 'ASK_QUESTION'; data: { text: string } }
  | { type: 'DOCTOR_INTERVENTION'; data: { action: 'child_answer' | 'pause_parent' | 'comfort_child' } }
  | { type: 'EXAM_ACTION'; data: { toolId: string; bodyPartId: string } }
  | { type: 'ORDER_TEST'; data: { testId: string } }
  | { type: 'SUBMIT_DECISION'; data: { diagnosis: string; summary: string; differentials: string } }
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
  id: string;
  sessionId: string;
  userId: string;
  caseId: string;
  mode: SessionMode;
  totalScore: number;
  abilities: AbilityScores;
  evidence: ScoreEvidence[];
  strengths: string[];
  improvements: string[];
  recommendation: string;
  status: 'ready' | 'pending_review';
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
