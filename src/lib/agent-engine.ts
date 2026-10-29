import {SOURCE_HISTORY_TOPICS, sourceHistorySentences} from '@/domain/source-history';
import {getPublicCase,isTrainableCase} from '@/lib/case-identity';
import { verifiedComplaint } from '@/lib/admission-complaint';
import { isExamResultEvidence } from '@/domain/exam-evidence';
import {diagnosticEvidenceEvents} from '@/domain/clinical-evidence';
import { postureAllows, type ExamPosture } from '@/domain/exam-methods';
import { stageReached } from '@/domain/agent';
import type {
  AgentEvent,
  AgentMessage,
  AgentTraceItem,
  AgentTurnResult,
  CaseMedia,
  ClinicalEvent,
  EventSpeechMeta,
  PracticeFocus,
  SessionMode,
  SessionState,
  Stage,
} from '@/domain/agent';
import { FLAGSHIP_CASE, findExamRule, findTest, getCase, identifyHistoryIntents, type AuxiliaryTest } from '@/domain/case';
import { retrieveKnowledge } from '@/domain/knowledge';
import { getCaseTestResult, recordCaseTestOrder, refreshProjectedFacts } from '@/lib/case-snapshot';
import { matchRequestedTest, splitRequestedTests } from '@/lib/test-name-matcher';
import { canChildSpeak } from '@/domain/communication-profile';
import { resolveAuditedCommunicationProfile } from '@/lib/communication-profile-overrides';
import { getPracticeScenario, PROVIDED_HISTORY_INTENT_IDS } from '@/domain/practice-scenarios';
import { DEFAULT_OSCE_TIME_LIMIT_SECONDS, getOsceStation } from '@/domain/osce-stations';
import { renderRoleReply } from '@/lib/role-agent';

/** 开单 RPC 注入缝：生产默认指向 case-snapshot 封装；仅测试注入 503/守卫拒绝失败路径，
 *  不改变业务判定与守卫逻辑（不绕过归属/版本/已下单校验）。 */
const testOrderRpc = {
  record: recordCaseTestOrder,
  getResult: getCaseTestResult,
};
export function __setTestOrderRpcForTests(overrides: Partial<typeof testOrderRpc> | null): void {
  if (overrides) Object.assign(testOrderRpc, overrides);
  else {
    testOrderRpc.record = recordCaseTestOrder;
    testOrderRpc.getResult = getCaseTestResult;
  }
}

function now(): string {
  return new Date().toISOString();
}

function message(actor: AgentMessage['actor'], content: string, options?: Partial<Pick<AgentMessage, 'emotion' | 'kind' | 'inputMode' | 'asrRawText' | 'transcriptEdited'>>): AgentMessage {
  return {
    id: crypto.randomUUID(),
    actor,
    content,
    emotion: options?.emotion ?? 'neutral',
    kind: options?.kind ?? 'dialogue',
    createdAt: now(),
    ...(options?.inputMode === 'voice'
      ? { inputMode: 'voice', asrRawText: options.asrRawText, transcriptEdited: options.transcriptEdited }
      : {}),
  };
}

/** 语音轮元数据 → 学生消息字段（阶段 D）：仅语音输入附带；文字输入不产生字段。 */
function speechOptions(speech?: EventSpeechMeta): Partial<Pick<AgentMessage, 'inputMode' | 'asrRawText' | 'transcriptEdited'>> | undefined {
  if (!speech) return undefined;
  return { inputMode: speech.inputMode, asrRawText: speech.asrRawText, transcriptEdited: speech.transcriptEdited };
}

function clinicalEvent(
  clientEventId: string,
  type: AgentEvent['type'],
  stage: Stage,
  summary: string,
  correct: boolean | null,
  evidenceCodes: string[],
  media?: CaseMedia[],
): ClinicalEvent {
  return { id: crypto.randomUUID(), clientEventId, type, stage, summary, correct, evidenceCodes, ...(media && media.length > 0 ? { media } : {}), createdAt: now() };
}

export function createInitialSession(userId: string, mode: SessionMode, caseId = FLAGSHIP_CASE.id, practiceFocus?: PracticeFocus, sourceSnapshotVersion?: string | null, sessionId?: string | null): SessionState {
  getPublicCase(caseId);
  const pediatricCase = getCase(caseId, sourceSnapshotVersion, sessionId);
  const startedAt = now();
  // OSCE 时限单一来源（方案 15）：按站点契约配置设定；教师病例/历史路径未定义站点时保持默认时限。
  const osceStation = mode === 'osce' ? getOsceStation(pediatricCase.id) : null;
  const expiresAt = mode === 'osce' ? new Date(Date.now() + (osceStation?.timeLimitSeconds ?? DEFAULT_OSCE_TIME_LIMIT_SECONDS) * 1000).toISOString() : null;
  // 专项训练任务化（方案 5.2）：practice 模式按 focus 配置设定初始阶段、目标简报与 provided 事实；
  // 配置版本与 providedEvidence 写入会话，评分按 provided/elicited 区分来源。
  const scenario = mode === 'practice' ? getPracticeScenario(practiceFocus ?? 'history') : null;
  const openingMessages: AgentMessage[] = [
    message('system', pediatricCase.triage, { kind: 'navigation' }),
    message('parent', pediatricCase.openingParent, { emotion: 'anxious' }),
  ];
  if (scenario) {
    openingMessages.push(message('system', `【${scenario.title}】目标：${scenario.goal} ${scenario.briefing.join(' ')} ${scenario.completionHint}`, { kind: 'navigation' }));
    if (scenario.providedEvidence.includes('HX_PROVIDED')) {
      const providedHistory = pediatricCase.history.filter((intent) => PROVIDED_HISTORY_INTENT_IDS.includes(intent.id)).map((intent) => `${intent.label}：${intent.parentAnswer}`);
      if (providedHistory.length > 0) openingMessages.push(message('system', `已提供必要病史（provided，不计入你的问诊证据）：${providedHistory.join('；')}。`, { kind: 'navigation' }));
    }
  }
  return {
    id: crypto.randomUUID(),
    userId,
    caseId: pediatricCase.id,
    caseVersion: pediatricCase.version,
    sourceSnapshotVersion: sourceSnapshotVersion ?? null,
    mode,
    practiceFocus: mode === 'practice' ? practiceFocus ?? 'history' : null,
    scenarioVersion: scenario?.configVersion,
    providedEvidence: scenario?.providedEvidence ?? [],
    stage: scenario ? scenario.initialStage : 'triage',
    status: 'active',
    startedAt,
    updatedAt: startedAt,
    expiresAt,
    osceStation: osceStation ? { stationId: osceStation.stationId, version: osceStation.version, timeLimitSeconds: osceStation.timeLimitSeconds } : null,
    messages: openingMessages,
    events: [],
    askedIntents: [],
    preparationActions: [],
    unlockedEvidence: [],
    orderedTests: [],
    decision: null,
    plan: null,
    communication: null,
    childEmotion: pediatricCase.initialEmotion,
    parentInterruption: 'active',
    behavior: {
      childResponseStyle: 'age_limited',
      parentResponseStyle: 'interrupting',
      hiddenExposureRevealed: false,
      cooperation: 35,
    },
    vitals: { ...pediatricCase.initialVitals },
    reportId: null,
    ...(pediatricCase.sourceFacts !== undefined ? { caseOptions: {
      sourceName: pediatricCase.sourceFacts?.teachingSimulation ? 'AI教学模拟病例' : '教师教学病例',
      complaint: pediatricCase.sourceFacts ? verifiedComplaint(pediatricCase.sourceFacts) ?? undefined : undefined,
      age: pediatricCase.age, sex: pediatricCase.sex, hasSource: Boolean(pediatricCase.sourceFacts),
      ...(pediatricCase.sourceFacts?.teachingSimulation ? {teachingSimulation: true as const} : {}),
      exams: pediatricCase.exams.map(({ toolId, bodyPartId, label }) => ({ toolId, bodyPartId, label })),
      tests: pediatricCase.tests.map(({ id, label, indication }) => ({ id, label, indication })),
    } } : {}),
    immersive: mode === 'immersive' ? { scene: 'arrival', sceneStep: 0, visitedScenes: ['arrival'], patientCooperation: 35 } : undefined,
  };
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function trace(skill: AgentTraceItem['skill'], label: string, sourceIds: string[] = []): AgentTraceItem {
  return { skill, label, sourceIds };
}

function feedbackFor(session: SessionState, text: string): string | null {
  return session.mode === 'osce' ? null : text;
}

/** 问诊/干预推进：stage 仅前进不回退。guided 模式下诊断/处置提交后继续问诊（单聊天框
 *  语义推导仍返回 history）不得把 stage 拉回 'history'——DB 防回退触发器会以
 *  SESSION_STAGE_REGRESSION 拒绝（真实平台回归实测定位，与 handleCommunication 的修复同规则：
 *  问诊/沟通在任意阶段合法，保持当前 stage）。 */
function advanceToHistoryStage(session: SessionState): void {
  const order = getCase(session.caseId, session.sourceSnapshotVersion, session.id).stages.map((stage) => stage.id);
  if (order.indexOf(session.stage) <= order.indexOf('history')) session.stage = 'history';
}

/** 处理器推进业务阶段：只前进不回退（任务4 返回修改）——普通训练经 viewStage 回看
 *  补问/补查/修改时，业务阶段保持已推进位置：直接把 stage 写回更早阶段会被 DB
 *  防回退触发器以 SESSION_STAGE_REGRESSION 拒绝整回合（与 advanceToHistoryStage 同规则）。 */
function advanceStageTo(session: SessionState, target: Stage): void {
  const order = getCase(session.caseId, session.sourceSnapshotVersion, session.id).stages.map((stage) => stage.id);
  if (order.indexOf(target) > order.indexOf(session.stage)) session.stage = target;
}

export function refreshSourceSession(session: SessionState): SessionState {
  if (!session.caseId.startsWith('teacher-')) return session;
  if (session.caseVersion >= 2 && session.caseOptions) {
    // 非破坏性 caseOptions 刷新：查体/检查证据解锁后投影扩展（迁移 20261010120000），
    // UI 的可选查体/检查列表须跟随本人会话当前投影，否则列表停留在建会话时的剥离态、
    // 查体在 UI 层永远为空。仅刷新目录字段（toolId/bodyPartId/label/indication，不含结果文本）；
    // 不重建 messages/events/vitals——避免破坏进行中会话，也避免未经查体动作泄露体征数值
    // （vitals 由查体事实提取，仅在真实执行查体动作后经 handleExam 路径生效）。
    const fresh = createInitialSession(session.userId, session.mode, session.caseId, session.practiceFocus ?? undefined, session.sourceSnapshotVersion, session.id);
    if (fresh.caseOptions) session.caseOptions = fresh.caseOptions;
    return session;
  }
  // 旧会话（caseVersion<2 或无 caseOptions）整体重建（遗留迁移路径，重建后进入上方非破坏性分支）
  // 刷新时按会话绑定的快照版本取教学事实（version 未绑定时取裸键最新版），防并发/漂移换患者；
  // 学生会话同步传 sessionId，命中会话作用域投影事实（不读共享键完整事实）
  const fresh = createInitialSession(session.userId, session.mode, session.caseId, session.practiceFocus ?? undefined, session.sourceSnapshotVersion, session.id);
  session.caseVersion = fresh.caseVersion;
  session.caseOptions = fresh.caseOptions;
  session.vitals = fresh.vitals;
  session.messages = [...fresh.messages, ...session.messages.filter((item) => item.actor === 'student')];
  session.events = session.events.filter((event) => ['SUBMIT_DECISION', 'SUBMIT_PLAN', 'SEND_COMMUNICATION', 'DOCTOR_INTERVENTION', 'NAVIGATE_STAGE', 'FINISH_SESSION'].includes(event.type)).map((event) => ({ ...event, correct: null }));
  session.askedIntents = [];
  session.unlockedEvidence = session.unlockedEvidence.filter((code) => ['DECISION', 'PLAN', 'COMMUNICATION'].includes(code));
  session.orderedTests = [];
  session.preparationActions = [];
  return session;
}

/** OSCE 阶段锁定为代码内固定规则（任务4）：不再依赖 LOCK_STAGES 环境开关——
 *  考核模式下禁止回退（stage 列单向），普通训练（guided/practice/immersive）不受限，
 *  回看走 viewStage 展示态（业务阶段不变，见 NAVIGATE_STAGE 分支）。 */
function validateStageNavigation(session: SessionState, target: Stage): boolean {
  if (session.mode === 'practice') {
    // 专项训练阶段门控（方案 5.2）：只允许进入本专项配置允许的阶段，服务端校验不依赖前端隐藏。
    const scenario = getPracticeScenario(session.practiceFocus);
    return scenario ? scenario.allowedStages.includes(target) : true;
  }
  if (session.mode !== 'osce') return true;
  const order = getCase(session.caseId, session.sourceSnapshotVersion, session.id).stages.map((stage) => stage.id);
  return order.indexOf(target) >= order.indexOf(session.stage);
}

/**
 * OSCE 事件-阶段门控：学生不得在问诊阶段经 API 直发查体/检查/诊断/处置/沟通事件，
 * 提前获取该病例真实查体结果、检查结果或推进评分阶段（服务端校验，不依赖前端隐藏）。
 * 沉浸式教学保持自由探索：可跨阶段尝试，反馈与 OSCE 分离（feedbackFor 已区分两种模式）。
 */
function validateEventStage(session: SessionState, event: AgentEvent): boolean {
  if (session.mode === 'practice') {
    // 专项训练事件门控（方案 5.2）：按配置限制事件类型——学生不能经 API 获取
    // 本专项不应开放的查体/检查/诊断/处置/沟通事实；结束不强制答中评分点。
    const scenario = getPracticeScenario(session.practiceFocus);
    if (!scenario) return true;
    if (event.type === 'FINISH_SESSION') return true;
    return scenario.allowedActions.includes(event.type);
  }
  if (session.mode !== 'osce') return true;
  // OSCE 站点契约（方案 15）：按站点定义的 allowedActions 白名单门控；
  // 教师病例/历史路径未定义站点时走下方阶段门控（保持旧行为）。
  const station = getOsceStation(session.caseId);
  if (station && !station.allowedActions.includes(event.type)) return false;
  const order = getCase(session.caseId, session.sourceSnapshotVersion, session.id).stages.map((stage) => stage.id);
  const currentIndex = order.indexOf(session.stage);
  switch (event.type) {
    case 'ASK_QUESTION':
    case 'DOCTOR_INTERVENTION':
    case 'SEND_COMMUNICATION':
      return true; // 问诊/沟通干预/家长沟通在任意阶段均合法（回复为通用话术，不泄露病例事实）
    case 'EXAM_ACTION':
      return currentIndex >= order.indexOf('exam');
    case 'ORDER_TEST':
      return currentIndex >= order.indexOf('tests');
    case 'SUBMIT_DECISION':
      return currentIndex >= order.indexOf('assessment');
    case 'SUBMIT_PLAN':
      return currentIndex >= order.indexOf('plan');
    case 'SUBMIT_HISTORY_SUMMARY':
      return false; // 病史采集专项专用事件：OSCE 模拟站不开放，服务端拒绝
    case 'SUBMIT_EXAM_OBSERVATION':
      return false; // 查体专项专用事件：OSCE 模拟站不开放，服务端拒绝
    case 'NAVIGATE_STAGE':
    case 'FINISH_SESSION':
      return true; // NAVIGATE_STAGE 由 validateStageNavigation 单独校验；FINISH 走完成门控
  }
}

function detectSpokenIntervention(text: string): Extract<AgentEvent, { type: 'DOCTOR_INTERVENTION' }>['data']['action'] | null {
  if (/家长.{0,8}(先别|先不要|稍后|等会|暂时).{0,6}(说|回答|补充)|让.{0,4}(孩子|患儿).{0,6}(先说|先回答)|我想先听.{0,6}(孩子|患儿)/.test(text)) return 'pause_parent';
  if (/(别紧张|不要紧张|不用怕|别害怕|不要害怕|慢慢说|我会陪你|不会疼)/.test(text)) return 'comfort_child';
  if (/(孩子|患儿|小朋友|你).{0,8}(自己说|自己回答|告诉我)|请.{0,6}(孩子|患儿|小朋友|你).{0,8}(回答|说|告诉我)/.test(text)) return 'child_answer';
  return null;
}

function applyInterventionState(session: SessionState, action: Extract<AgentEvent, { type: 'DOCTOR_INTERVENTION' }>['data']['action']): void {
  if (action === 'pause_parent') {
    session.parentInterruption = 'paused';
  } else if (action === 'comfort_child') {
    session.childEmotion = 'calm';
    session.parentInterruption = 'supportive';
    session.behavior.cooperation = Math.min(100, session.behavior.cooperation + 35);
  } else {
    session.behavior.childResponseStyle = 'cooperative';
  }
}

/** 来源病例问诊的确定性兜底口语化（模型不可用/解析失败时）：
 *  仅做同义口语转换与自然语气包裹，不新增、不修改任何事实（数值、部位、时间、阴性/阳性表述保持原文）；
 *  未匹配术语保留原文（宁可不顺口也不虚构）。开头按消息数轮换，避免每轮同一句式。 */
function casualParentReply(fact: string, turnIndex: number): string {
  const openers = ['嗯，是这样的，', '是这样的医生，', '唉，', ''];
  const opener = openers[turnIndex % openers.length];
  const spoken = fact
    .replaceAll('患儿', '孩子')
    .replace(/精神反应可/g, '精神还行')
    .replace(/神志清楚/g, '人是清醒的')
    .replace(/发热/g, '发烧')
    .replace(/纳差|食欲不振/g, '吃得少')
    .replace(/腹泻/g, '拉肚子')
    .replace(/呕吐/g, '吐')
    .replace(/气促/g, '呼吸有点快')
    .replace(/咳嗽剧烈/g, '咳得厉害')
    .replace(/无抽搐/g, '没有抽过')
    .replace(/四肢冰凉/g, '手脚冰凉');
  return `${opener}${spoken}。`;
}

async function handleQuestion(session: SessionState, text: string, clientEventId: string, forwardHeaders?: Record<string, string>, speech?: EventSpeechMeta): Promise<AgentTurnResult> {
  const spokenIntervention = detectSpokenIntervention(text);
  const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
  if (pediatricCase.sourceFacts !== undefined) {
    if (spokenIntervention) applyInterventionState(session, spokenIntervention);
    return handleSourceQuestion(session, text, clientEventId, forwardHeaders, speech);
  }
  const intents = identifyHistoryIntents(session.caseId, text, session.sourceSnapshotVersion, session.id);
  // 分时点事实释放（补充单 §5）：命中但事实设定了更晚的释放阶段时，该事实现阶段不可告知——
  // 不泄露内容、不解锁证据、不计入已问意图（区分于「资料未提供」与「问题宽泛」）。
  const releasable = intents.filter((intent) => !intent.availableFromStage || stageReached(session.stage, intent.availableFromStage));
  if (spokenIntervention && intents.length === 0) return handleIntervention(session, spokenIntervention, clientEventId, text, speech);
  if (spokenIntervention) applyInterventionState(session, spokenIntervention);
  const studentMessage = message('student', text, speechOptions(speech));
  const newMessages: AgentMessage[] = [studentMessage];
  const traces = [trace('角色调度', '按患儿年龄、问题意图和家长插话状态选择回答者')];
  if (spokenIntervention) traces.push(trace('病例状态', '从学生原话识别沟通干预并更新应答状态'));
  // 发言计划（方案 8.2）：角色能力决定患儿能否输出语义台词；不能言语一律家长代答。
  const profile = resolveAuditedCommunicationProfile(session.caseId, pediatricCase.age);
  const childCapable = canChildSpeak(profile);

  if (intents.length === 0) {
    newMessages.push(
      ...(childCapable ? [message('child', '我不知道怎么说……妈妈知道。', { emotion: session.childEmotion })] : []),
      message('parent', '医生，您可以问得再具体一点吗？', { emotion: 'anxious' }),
    );
    session.behavior.childResponseStyle = 'off_topic';
    session.events.push(clinicalEvent(clientEventId, 'ASK_QUESTION', 'history', '问题过于宽泛，未获得新的病例事实', false, []));
    session.messages.push(...newMessages);
    advanceToHistoryStage(session);
    session.updatedAt = now();
    return { session, newMessages, feedback: feedbackFor(session, '问题较宽泛，可围绕起病时间、危险症状或一般状态进一步追问。'), trace: traces };
  }

  if (releasable.length === 0) {
    // 分时点释放门控：问题命中了尚未到释放时点的事实——现阶段回应「说不好」，不泄露事实内容。
    newMessages.push(
      ...(childCapable ? [message('child', '我不知道……', { emotion: session.childEmotion })] : []),
      message('parent', '这个现在还说不好，得等检查了才知道。', { emotion: 'anxious' }),
    );
    session.events.push(clinicalEvent(clientEventId, 'ASK_QUESTION', 'history', '所问病史事实尚未到可告知时点，未解锁', null, []));
    session.messages.push(...newMessages);
    advanceToHistoryStage(session);
    session.updatedAt = now();
    return { session, newMessages, feedback: feedbackFor(session, '该情况需在后续阶段结合检查进一步明确。'), trace: traces };
  }

  const preferredActor = releasable.every((intent) => intent.preferredActor === 'parent')
    ? 'parent'
    : releasable.every((intent) => intent.preferredActor === 'child') ? 'child' : 'mixed';
  const childFact = releasable.map((intent) => intent.childAnswer).join(' ');
  const parentFact = releasable.map((intent) => intent.parentAnswer).join(' ');
  const roleResult = await renderRoleReply({
    childAge: pediatricCase.age,
    childSex: pediatricCase.sex,
    question: text,
    childFact,
    parentFact,
    preferredActor,
    parentPaused: session.parentInterruption === 'paused',
    childComforted: session.childEmotion === 'calm',
    scene: session.mode === 'immersive' ? `沉浸式${session.stage}场景` : session.stage,
    recentMessages: session.messages.slice(-6).map((item) => ({ actor: item.actor, content: item.content })),
    cooperation: session.behavior.cooperation,
    disclosedFacts: session.askedIntents,
    communicationProfile: profile,
  }, forwardHeaders);
  const modelReply = roleResult.reply;
  const childAnswer = modelReply?.child ?? childFact;
  const parentAnswer = modelReply?.parent ?? parentFact;
  const parentPaused = session.parentInterruption === 'paused';

  // 发言计划（方案 8.2）：不能言语患儿不输出语义台词，一律家长代答，仅保留非言语括注。
  if (!childCapable) {
    const prefix = session.parentInterruption === 'active' ? '我补充一下：' : '';
    newMessages.push(message('parent', `${prefix}${parentAnswer}`, { emotion: 'anxious' }));
    if (modelReply?.nonverbal) newMessages.push(message('child', `（${modelReply.nonverbal}）`, { emotion: session.childEmotion }));
  } else if (preferredActor === 'parent' && !parentPaused) {
    newMessages.push(message('parent', parentAnswer, { emotion: 'anxious' }));
  } else if (preferredActor === 'child' || parentPaused) {
    newMessages.push(message('child', childAnswer, { emotion: modelReply?.childEmotion ?? session.childEmotion }));
  } else {
    newMessages.push(message('child', childAnswer, { emotion: modelReply?.childEmotion ?? session.childEmotion }));
    if (session.parentInterruption !== 'paused') {
      const prefix = session.parentInterruption === 'active' ? '我补充一下：' : '';
      newMessages.push(message('parent', `${prefix}${parentAnswer}`, { emotion: 'anxious' }));
    }
  }

  session.askedIntents = uniq([...session.askedIntents, ...releasable.map((intent) => intent.id)]);
  session.unlockedEvidence = uniq([...session.unlockedEvidence, ...releasable.map((intent) => intent.evidenceCode)]);
  if (releasable.some((intent) => intent.id === 'exposure')) session.behavior.hiddenExposureRevealed = true;
  session.behavior.childResponseStyle = session.childEmotion === 'calm' ? 'cooperative' : 'brief';
  const labels = releasable.map((intent) => intent.label).join('、');
  const evidenceCodes = releasable.map((intent) => intent.evidenceCode);
  if (spokenIntervention) evidenceCodes.push('COMM_INTERVENTION');
  session.events.push(clinicalEvent(clientEventId, 'ASK_QUESTION', 'history', `完成${labels}问诊${spokenIntervention ? '并完成沟通干预' : ''}`, true, evidenceCodes));
  session.messages.push(...newMessages);
  advanceToHistoryStage(session);
  session.updatedAt = now();
  const sources = retrieveKnowledge(`${labels} 呼吸 肺炎`).map((source) => source.id);
  traces.push(trace('病例状态', `仅解锁“${labels}”对应的预置病史事实`));
  traces.push(trace('知识检索', '检索问诊结构与儿童危险信号公开测试资料', sources));
  return { session, newMessages, feedback: feedbackFor(session, `已形成“${labels}”的过程证据。`), trace: traces, runtime: roleResult.runtime };
}

async function handleSourceQuestion(session: SessionState, text: string, clientEventId: string, forwardHeaders?: Record<string, string>, speech?: EventSpeechMeta): Promise<AgentTurnResult> {
  const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
  const source = pediatricCase.sourceFacts;
  const history = source?.sections.history ?? '';
  const sentences = sourceHistorySentences(history);
  const topics = SOURCE_HISTORY_TOPICS;
  let matches: Array<{ fact: string; index: number }> = [];
  if (/多大|几岁|年龄|男孩|女孩|性别/.test(text) && source) {
    matches = [{ fact: `孩子${source.age}，${source.sex}。`, index: -1 }];
  } else {
    const selected = topics.filter((topic) => topic.question.test(text));
    const terms = text.match(/[\u4e00-\u9fff]{2,}/g)?.flatMap((word) => Array.from({ length: Math.max(0, word.length - 1) }, (_, index) => word.slice(index, index + 2))) ?? [];
    const relevantTerms = [...new Set(terms)].filter((term) => !['孩子', '医生', '小朋', '朋友', '可以', '告诉', '知道', '什么', '情况', '有没', '没有', '多久', '开始', '么时', '时候'].includes(term));
    matches = sentences.map((fact, index) => ({ fact: fact.trim().replace(/^[一二三四五六七八九十\d]+[、.．]\s*(?=[\u4e00-\u9fff])/, ''), index,
      relevance: relevantTerms.filter((term) => fact.includes(term)).length * 3 + selected.filter((topic) => topic.source.test(fact)).length }))
      .filter((item) => item.relevance > 0).sort((a, b) => b.relevance - a.relevance).slice(0, 3);
    if (/哪里不舒服|怎么了|主诉|为什么来|什么不舒服|主要症状|主要问题/.test(text) && source) matches = [{ fact: verifiedComplaint(source) ?? '主诉尚需补充核实', index: -2 }];
  }
  const fact = matches.map((item) => item.fact).join('。');
  // 发言计划（方案 8.2/8.4）：先按病例角色能力决定说话者，再渲染角色回复。
  const profile = resolveAuditedCommunicationProfile(session.caseId, pediatricCase.age);
  const childCapable = canChildSpeak(profile);
  const parentPaused = session.parentInterruption === 'paused';
  const roleResult = fact ? await renderRoleReply({ childAge: pediatricCase.age, childSex: pediatricCase.sex,
    question: text, childFact: '', parentFact: fact, preferredActor: 'parent', parentPaused,
    childComforted: session.childEmotion === 'calm', recentMessages: session.messages.slice(-6),
    communicationProfile: profile,
  }, forwardHeaders) : null;
  const reply = fact ? roleResult?.reply?.parent ?? casualParentReply(fact, session.messages.length) : '这部分我说不清楚，需要再核实一下。';
  const nonverbalNote = roleResult?.reply?.nonverbal;
  const responder: AgentMessage = !parentPaused
    ? message('parent', reply, { emotion: session.childEmotion })
    : childCapable
      // 暂停家长后由患儿先答：仅适用于能语言表达的患儿，答不上时自然请家长补充。
      ? message('child', '这个我说不清楚，可以请家长补充吗？', { emotion: session.childEmotion })
      // 不能言语患儿 + 暂停家长：不机械产出患儿台词（方案 8.2）；家长给出合理场景回应并继续训练。
      : message('parent', '好的医生，不过孩子还不会说话，这些还是我来回答吧。', { emotion: session.childEmotion });
  const newMessages = [message('student', text, speechOptions(speech)), responder];
  // 非言语反馈独立展示（括注舞台提示，非语义台词）；不把旁白混进患儿语音（方案 8.4）。
  if (nonverbalNote && !childCapable) newMessages.push(message('child', `（${nonverbalNote}）`, { emotion: session.childEmotion }));
  // 家长代答时证据照常解锁；仅"患儿先答但答不上"（能表达且被暂停）不解锁。
  const codes = parentPaused && childCapable ? [] : matches.map((item) => `SOURCE_HX_${item.index}`);
  session.askedIntents = uniq([...session.askedIntents, ...codes]);
  session.unlockedEvidence = uniq([...session.unlockedEvidence, ...codes]);
  session.messages.push(...newMessages);
  session.events.push(clinicalEvent(clientEventId, 'ASK_QUESTION', 'history', codes.length ? `依据病例正文回答：${text}` : `问诊记录：${text}；该信息尚未获得`, null, codes));
  advanceToHistoryStage(session); session.updatedAt = now();
  return { session, newMessages, feedback: feedbackFor(session, codes.length ? '回答依据该病例的原始病史，已记录来源证据。' : '请记录需要补充核实的信息，继续采集其他病史。'),
    trace: [trace('知识检索', '按本病例病史检索已提供事实', source ? [source.caseId] : []), trace('病例状态', '保留未知信息，不补写病史')], runtime: roleResult?.runtime };
}

function handleIntervention(session: SessionState, action: Extract<AgentEvent, { type: 'DOCTOR_INTERVENTION' }>['data']['action'], clientEventId: string, spokenText?: string, speech?: EventSpeechMeta): AgentTurnResult {
  const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
  const patientName = pediatricCase.patientName;
  const copy = {
    child_answer: `${patientName}，接下来请你自己告诉我哪里不舒服，可以慢慢说。`,
    pause_parent: '我想先听孩子本人回答，家长稍后再补充，可以吗？',
    comfort_child: `${patientName}别紧张，我会一步一步告诉你要做什么，不舒服可以随时说。`,
  }[action];
  const studentMessage = message('student', spokenText ?? copy, speechOptions(speech));
  let response: AgentMessage;
  applyInterventionState(session, action);
  // 发言计划（方案 8.2）：不能言语患儿的干预不机械执行固定台词；
  // 安抚只影响情绪与配合，不改变语言能力；"让孩子自己说"按能力给出合理场景回应。
  const childCapable = canChildSpeak(resolveAuditedCommunicationProfile(session.caseId, pediatricCase.age));
  if (action === 'pause_parent') {
    response = childCapable
      ? message('parent', '好的，我等孩子说完再补充。', { emotion: 'neutral' })
      : message('parent', '好的医生……不过孩子还不会说话，想了解什么还是我来回答吧。', { emotion: 'neutral' });
  } else if (action === 'comfort_child') {
    response = childCapable
      ? message('child', '好……我会慢慢说。', { emotion: 'calm' })
      : message('parent', '医生，您这么一安抚，孩子好像安静了一些。', { emotion: 'neutral' });
  } else {
    response = childCapable
      ? message('child', '嗯，我自己说。', { emotion: session.childEmotion })
      : message('parent', '医生，孩子现在还说不上话，有什么想了解的我来回答。', { emotion: 'neutral' });
  }
  const newMessages = [studentMessage, response];
  session.messages.push(...newMessages);
  session.events.push(clinicalEvent(clientEventId, 'DOCTOR_INTERVENTION', 'history', action === 'comfort_child' ? '完成患儿情绪安抚' : '调整患儿与家长应答秩序', true, ['COMM_INTERVENTION']));
  advanceToHistoryStage(session);
  session.updatedAt = now();
  return {
    session,
    newMessages,
    feedback: feedbackFor(session, '已识别你的沟通表达，将影响后续回答顺序与患儿配合度。'),
    trace: [trace('角色调度', '更新患儿情绪、家长插话和配合度状态'), trace('病例状态', '记录医生干预证据')],
  };
}

function handleExam(session: SessionState, toolId: string, bodyPartId: string, clientEventId: string, posture?: ExamPosture): AgentTurnResult {
  if (posture) session.examPosture = posture;
  if (!postureAllows(bodyPartId, posture)) {
    session.events.push(clinicalEvent(clientEventId, 'EXAM_ACTION', 'exam', '腹部检查需要切换为仰卧姿势', false, []));
    return { session, newMessages: [], feedback: feedbackFor(session, '请先切换为仰卧姿势，再进行腹部检查。'), trace: [trace('查体规则', '检查姿势与部位匹配')] };
  }
  const rule = findExamRule(session.caseId, toolId, bodyPartId, session.sourceSnapshotVersion, session.id);
  const traceItems = [trace('查体规则', '校验准备动作、器材、部位与检查顺序')];
  if (!rule) {
    // 来源病例：无来源体征明确「资料未提供」，不补正常结果、不虚构患者事实、不关闭整个查体
    // （学生可换用其他器材/部位组合继续）；未完成手卫生时优先引导准备动作。
    // 演示病例保持原有「器材与部位不匹配」口径。
    const isSourceCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id).sourceFacts !== undefined;
    const prepared = session.unlockedEvidence.includes('EX_PREP');
    const summary = isSourceCase
      ? (prepared ? `${toolId}×${bodyPartId}：本病例资料未提供该检查的体征记录` : `${toolId}×${bodyPartId}：尚未完成手卫生与检查说明`)
      : `器材${toolId}与部位${bodyPartId}不匹配`;
    const feedbackText = isSourceCase
      ? (prepared ? '本病例资料未提供该部位与器材组合的体征记录，请换用其他检查组合或记录需补充的检查。' : '尚未完成必要准备。请先进行手卫生并向患儿说明检查。')
      : '器材与部位不匹配，未解锁任何深层体征。';
    session.events.push(clinicalEvent(clientEventId, 'EXAM_ACTION', 'exam', summary, false, []));
    advanceStageTo(session, 'exam');
    session.updatedAt = now();
    return { session, newMessages: [], feedback: feedbackFor(session, feedbackText), trace: traceItems };
  }
  // 分时点事实释放（补充单 §5）：查体项目设定了更晚的可执行阶段时阻止执行，不解锁体征证据。
  if (rule.availableFromStage && !stageReached(session.stage, rule.availableFromStage)) {
    session.events.push(clinicalEvent(clientEventId, 'EXAM_ACTION', 'exam', `${rule.label}：当前阶段暂不可执行，未解锁`, false, []));
    advanceStageTo(session, 'exam');
    session.updatedAt = now();
    return { session, newMessages: [], feedback: feedbackFor(session, `${rule.label}需在后续阶段进行，当前阶段暂不可执行。`), trace: traceItems };
  }
  const missing = rule.requires.filter((code) => !session.unlockedEvidence.includes(code));
  if (missing.length > 0) {
    session.events.push(clinicalEvent(clientEventId, 'EXAM_ACTION', 'exam', `${rule.label}缺少必要准备动作`, false, []));
    advanceStageTo(session, 'exam');
    session.updatedAt = now();
    return { session, newMessages: [], feedback: feedbackFor(session, '尚未完成必要准备。请先进行手卫生并向患儿说明检查。'), trace: [...traceItems, trace('安全校验', '阻止未完成准备的深层检查')] };
  }
  session.unlockedEvidence = uniq([...session.unlockedEvidence, rule.evidenceCode]);
  if (rule.id === 'prep-hygiene') session.preparationActions = uniq([...session.preparationActions, rule.id]);
  if (rule.evidenceCode === 'EX_SPO2' && getCase(session.caseId, session.sourceSnapshotVersion, session.id).sourceFacts === undefined) session.vitals.spo2 = 92;
  // 结果释放：随事件挂载该查体项绑定的病例媒体（如有；仅图核通过媒体可登记进病例配置）
  session.events.push(clinicalEvent(clientEventId, 'EXAM_ACTION', 'exam', `${rule.label}：${rule.result}`, true, [rule.evidenceCode], rule.media));
  advanceStageTo(session, 'exam');
  session.updatedAt = now();
  const resultMessage = message('system', rule.result, { kind: 'navigation' });  session.messages.push(resultMessage);
  return {
    session,
    newMessages: [resultMessage],
    feedback: feedbackFor(session, `${rule.label}已完成，结果已写入病例证据链。`),
    trace: [...traceItems, trace('病例状态', `解锁${rule.evidenceCode}体征证据`)],
  };
}

/** ORDER_TEST 事件数据（双契约：旧 testId 点选 / 新 requestedTests 文本申请）。 */
type OrderTestData = Extract<AgentEvent, { type: 'ORDER_TEST' }>['data'];

async function handleTest(session: SessionState, data: OrderTestData, clientEventId: string, accessToken?: string | null): Promise<AgentTurnResult> {
  const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
  // 申请解析：旧 testId 点选直取目录项（不存在即 TEST_NOT_FOUND，语义不变）；
  // 新文本申请按服务端确定性别名匹配解析（同义词组+单向前缀，见 test-name-matcher），
  // 未匹配项保留学生原文回显并明确「资料未提供」——不猜测扩展、不编造结果、不下发候选列表。
  const requests: Array<{ requested: string; test: AuxiliaryTest | null; status?: string }> = [];
  if ('testId' in data) {
    const test = findTest(session.caseId, data.testId, session.sourceSnapshotVersion, session.id);
    if (!test) throw new Error('TEST_NOT_FOUND');
    requests.push({ requested: test.label, test });
  } else {
    for (const part of splitRequestedTests(data.requestedTests)) {
      requests.push(matchRequestedTest(part, pediatricCase.tests));
    }
  }
  if (requests.length === 0) throw new Error('TEST_REQUEST_EMPTY');

  const reason = 'testId' in data ? null : (data.reason?.trim() || null);
  const newMessages: AgentMessage[] = [];
  const feedbackParts: string[] = [];
  const traceItems: AgentTraceItem[] = [trace('病例状态', 'testId' in data ? '点选检查申请' : '文本申请经服务端确定性别名匹配（未下发候选列表）')];
  if (reason) traceItems.push(trace('安全校验', `已记录申请理由：${reason}`));

  // 同批重复申请同一项目只处理一次（record 幂等，重复申请不重复反馈）
  const processedIds = new Set<string>();
  for (const request of requests) {
    // 未匹配：记录申请与「资料未提供」，不记下单、不解锁证据（fail-closed，不编造）
    if (!request.test) {
      const detail = request.status === 'ambiguous' ? '请说明检查部位或具体项目，当前申请尚未匹配。' : '尚未识别到本病例对应的检查记录；这不代表该申请医学上错误。';
      session.events.push(clinicalEvent(clientEventId, 'ORDER_TEST', 'tests', `「${request.requested}」：${detail}`, null, []));
      const unmatchedMessage = message('system', `「${request.requested}」：${detail}`, { kind: 'navigation' });
      session.messages.push(unmatchedMessage);
      newMessages.push(unmatchedMessage);
      feedbackParts.push(`「${request.requested}」：${detail}`);
      continue;
    }
    const test = request.test;
    if (processedIds.has(test.id)) continue;
    processedIds.add(test.id);
    if (session.orderedTests.includes(test.id) && session.unlockedEvidence.includes(test.evidenceCode)) {
      feedbackParts.push(`${test.label}已申请，结果保留在本次记录中。`);
      continue;
    }
    // 分时点事实释放（补充单 §5）：检查设定了更晚的回报阶段——记录开单（教师目录项经 RPC 幂等持久化），
    // 但不取结果、不解锁证据；到达回报阶段后再次开单即可得真实结果（外送/分时段回报场景，如 NK 细胞活性次日回报）。
    if (test.availableFromStage && !stageReached(session.stage, test.availableFromStage)) {
      if (!test.result && accessToken && session.sourceSnapshotVersion) {
        const recorded = await testOrderRpc.record(session.caseId, session.sourceSnapshotVersion, session.id, accessToken, test.id);
        if (recorded === null) throw new Error('TEST_ORDER_REJECTED');
      }
      session.orderedTests = uniq([...session.orderedTests, test.id]);
      const note = test.resultDelayNote ?? '标本已送检，结果待回报。';
      session.events.push(clinicalEvent(clientEventId, 'ORDER_TEST', 'tests', `${test.label}：已开单送检，结果待回报`, null, []));
      const pendingMessage = message('system', `${test.label}已开出。${note}`, { kind: 'navigation' });
      session.messages.push(pendingMessage);
      newMessages.push(pendingMessage);
      feedbackParts.push(`${test.label}已开单送检，结果待回报。`);
      traceItems.push(trace('病例状态', '分时点释放：结果待回报，暂不解锁证据'));
      continue;
    }
    // 目录项（恢复态投影剥离，result 为空）：先经 record_test_order 幂等持久化下单（DB 先落
    // orderedTests），再按 testId 行级读取本人病例单行结果（get_test 验证已下单）——先记单后取
    // 结果，既保证已下单验证不产生死锁，也不以一次下单暴露全部 tests 全文（目录/结果分离）。
    if (!test.result && accessToken && session.sourceSnapshotVersion) {
      const recorded = await testOrderRpc.record(session.caseId, session.sourceSnapshotVersion, session.id, accessToken, test.id);
      // 守卫拒绝（完成态竞态/项目越界等）：回合失败，不伪记下单与证据
      if (recorded === null) throw new Error('TEST_ORDER_REJECTED');
      // 网络/权限失败在此抛出（TEST_ORDER_RPC_FAILED / TEST_RESULT_RPC_FAILED），不伪记成功下单或资料未提供
      const fetched = await testOrderRpc.getResult(session.caseId, session.sourceSnapshotVersion, session.id, accessToken, test.id);
      if (fetched?.pending) {
        session.orderedTests = uniq([...session.orderedTests, test.id]);
        const note = fetched.resultDelayNote ?? '标本已送检，结果待回报。';
        session.events.push(clinicalEvent(clientEventId, 'ORDER_TEST', 'tests', `${test.label}：已开单送检，结果待回报`, null, []));
        const pendingMessage = message('system', `${test.label}已开出。${note}`, {kind:'navigation'});
        session.messages.push(pendingMessage); newMessages.push(pendingMessage);
        feedbackParts.push(`${test.label}已开单送检，结果待回报。`);
        traceItems.push(trace('病例状态', '绑定版本的数据库释放规则：暂不解锁结果或媒体'));
        continue;
      }
      if (fetched?.result) {
        test.result = fetched.result;
        if (fetched.label) test.label = fetched.label;
        if (fetched.media?.length) test.media = fetched.media;
      } else {
        // record 已成功但行级读取返回 null：守卫竞态/数据异常（record 已验证项目在目录内且已下单，
        // get_test 同规则解析不应无行）——不落入「资料未提供」：不记资料缺失、不解锁证据；
        // 回合失败可重试（record 幂等，重试不重复下单）
        throw new Error('TEST_RESULT_UNAVAILABLE');
      }
    }
    // fail-closed：下单记录保留，行级结果不可得时明确「资料未提供」，不编造检查结果
    if (!test.result) {
      session.orderedTests = uniq([...session.orderedTests, test.id]);
      session.events.push(clinicalEvent(clientEventId, 'ORDER_TEST', 'tests', `${test.label}：检查已开出，本病例资料未提供该项结果`, null, []));
      const pendingMessage = message('system', `${test.label}已开出，本病例资料未提供该项结果。`, { kind: 'navigation' });
      session.messages.push(pendingMessage);
      newMessages.push(pendingMessage);
      feedbackParts.push(`${test.label}检查已开出，本病例资料未提供该项结果。`);
      traceItems.push(trace('病例状态', '记录检查选择；资料未提供的结果不编造'));
      continue;
    }
    session.orderedTests = uniq([...session.orderedTests, test.id]);
    session.unlockedEvidence = uniq([...session.unlockedEvidence, test.evidenceCode]);
    // 结果释放：随事件挂载该检查绑定的病例媒体（如有；仅图核通过媒体可登记进病例配置）
    session.events.push(clinicalEvent(clientEventId, 'ORDER_TEST', 'tests', `${test.label}：${test.result}`, test.appropriate, [test.evidenceCode], test.media));
    const resultMessage = message('system', test.result, { kind: 'navigation' });
    session.messages.push(resultMessage);
    newMessages.push(resultMessage);
    feedbackParts.push(test.appropriate === null ? `已打开${test.label}检查记录。` : test.appropriate ? `${test.label}与当前证据相符。` : `当前证据不支持常规选择${test.label}，已记录低价值检查。`);
    traceItems.push(trace('病例状态', '记录检查选择并解锁预置结果'), trace('安全校验', '判断检查适宜性'));
  }
  advanceStageTo(session, 'tests');
  session.updatedAt = now();
  return {
    session,
    newMessages,
    feedback: feedbackFor(session, feedbackParts.join(' ')),
    trace: traceItems,
  };
}

function handleDecision(session: SessionState, data: Extract<AgentEvent, { type: 'SUBMIT_DECISION' }>['data'], clientEventId: string): AgentTurnResult {
  // 任务3：诊断依据必填——引擎级守卫（Zod 之外的第二道防线，直调引擎的调用方同样受约束）；
  // 学生必须写明诊断依据，防止只猜诊断名词不做证据推理
  if (!data.diagnosisBasis || data.diagnosisBasis.trim().length < 10) throw new Error('DIAGNOSIS_BASIS_REQUIRED');
  let linkedEventIds:string[]|undefined;
  if(data.linkedEventIds!==undefined){
    if(!Array.isArray(data.linkedEventIds)||data.linkedEventIds.length>128||data.linkedEventIds.some(id=>typeof id!=='string'||!id||id.length>80))throw new Error('DECISION_EVIDENCE_INVALID');
    linkedEventIds=uniq(data.linkedEventIds);
    const obtained=new Set(diagnosticEvidenceEvents(session).map(event=>event.id));
    if(linkedEventIds.some(id=>!obtained.has(id)))throw new Error('DECISION_EVIDENCE_NOT_OBTAINED');
  }
  session.decision = {...data,...(linkedEventIds!==undefined?{linkedEventIds}:{})};
  session.events.push(clinicalEvent(clientEventId, 'SUBMIT_DECISION', 'assessment', `提交初步诊断：${data.diagnosis}`, null, ['DECISION']));
  advanceStageTo(session, 'assessment');
  session.updatedAt = now();
  const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
  const sources = pediatricCase.sourceFacts !== undefined ? pediatricCase.sourceFacts ? [pediatricCase.sourceFacts.caseId] : [] : retrieveKnowledge(`${data.diagnosis} 低氧 呼吸`).map((source) => source.id);
  return {
    session,
    newMessages: [],
    feedback: feedbackFor(session, '诊断与依据已保存，关联记录将随报告保留。证据解释与诊断的合理性仍需结合具体内容复核。'),
    trace: [trace('病例状态', '保存病情摘要、诊断依据与鉴别诊断'), trace('知识检索', '检索诊断与危险信号依据', sources)],
  };
}

/** 病史采集专项结束条件（方案 5.1）：提交简短病史摘要；可重复提交（继续补充追问后重新提交），
 *  报告快照保留最终提交原文（原始提交不重写）。 */
function handleHistorySummary(session: SessionState, summary: string, clientEventId: string): AgentTurnResult {
  session.historySummary = summary;
  session.events.push(clinicalEvent(clientEventId, 'SUBMIT_HISTORY_SUMMARY', 'history', '提交病史采集小结', null, ['HX_SUMMARY']));
  session.updatedAt = now();
  return {
    session,
    newMessages: [],
    feedback: feedbackFor(session, '病史小结已保存。可生成专项报告，也可继续补充追问后重新提交。'),
    trace: [trace('病例状态', '保存病史采集小结（专项结束条件）')],
  };
}

/** 查体专项观察/解释提交（C-观察与报告-04 / C-关联与验收-05）：服务端按专项归属、绑定配置
 *  版本、本会话原查体事件与解锁结果核验 linkedEvidence 关联定位符后保存真实提交——客户端不自
 *  报得分或解锁事实；无专业审核判据时不做结果识别评分，仅保存原文并记过程反馈（EX_FINDINGS 恒
 *  无法评价，待教师结合查体记录复核）。可重复提交修订（每次新幂等键覆盖 examObservation；事件链
 *  保留每次提交的发生与关联项记录但不存全文，最终提交原文冻结在快照供恢复与报告回放）。 */
function handleExamObservation(session: SessionState, data: Extract<AgentEvent, { type: 'SUBMIT_EXAM_OBSERVATION' }>['data'], clientEventId: string): AgentTurnResult {
  // 归属门控（纵深防御）：仅查体专项 practice 会话可提交；跨专项/OSCE 已在 validateEventStage
  // 按 allowedActions 白名单拒绝，此处再核一次防直调引擎绕过门控。
  if (session.mode !== 'practice' || session.practiceFocus !== 'exam') throw new Error('EXAM_OBSERVATION_FORBIDDEN');
  const scenario = getPracticeScenario('exam');
  if (!scenario) throw new Error('EXAM_OBSERVATION_FORBIDDEN');
  // 配置版本核对（C-关联与验收-05 收紧）：会话创建时冻结的 scenarioVersion 缺失（早于版本化
  // 的历史会话）或与当前配置不一致（旧配置会话）时一律明确拒绝——本提交链含关联定位符核验，
  // 旧配置未定义该契约，不借新配置解释/静默升级旧会话。
  if (session.scenarioVersion === undefined || session.scenarioVersion !== scenario.configVersion) throw new Error('SCENARIO_VERSION_MISMATCH');
  // 关联定位符必填（引擎级第二道防线，schema 之外直调引擎同样受约束）：学生必须声明本次观察
  // 关联哪些查体项，不接受无关联的泛化提交。
  const linkedEvidence = [...new Set(data.linkedEvidence ?? [])];
  if (linkedEvidence.length === 0) throw new Error('EXAM_OBSERVATION_LINK_REQUIRED');
  // 本会话已实际获得结果的查体项定位：以真实 EXAM_ACTION 成功事件为准（correct 非 false 且
  // 携带结果项证据码；EX_PREP 属准备动作、EX_PROVIDED 属系统提供，均非学生获得的临床所见，
  // 不计入可关联集合——防止把准备操作当临床所见锚定观察）。
  const obtainedExamResults = new Map<string, string[]>();
  for (const event of session.events) {
    if (event.type !== 'EXAM_ACTION' || event.correct === false) continue;
    for (const code of event.evidenceCodes) {
      if (!isExamResultEvidence(code)) continue;
      obtainedExamResults.set(code, uniq([...(obtainedExamResults.get(code) ?? []), event.id]));
    }
  }
  if (obtainedExamResults.size === 0) throw new Error('EXAM_EVIDENCE_REQUIRED');
  // 关联定位符逐项核验（服务端按归属/原查体事件/解锁结果核验，不信任客户端自报）：每个关联码
  // 必须同时满足——在本会话 unlockedEvidence 中（解锁事实）且由本会话真实成功查体事件获得
  // （原事件锚定）。伪造码/未解锁码/准备或提供项/其他会话或来源码一律拒绝，不静默过滤。
  for (const code of linkedEvidence) {
    if (!session.unlockedEvidence.includes(code) || !obtainedExamResults.has(code)) {
      throw new Error('EXAM_EVIDENCE_NOT_OBTAINED');
    }
  }
  const linkedEventIds = uniq(linkedEvidence.flatMap((code) => obtainedExamResults.get(code) ?? []));
  // 关联定位符/原事件 id/病例版本/提交原文均为服务端核验产物（caseVersion 取会话绑定版本，
  // 不取客户端字段），随 examObservation 序列化保存（恢复与报告快照同源）。
  session.examObservation = {
    findings: data.findings,
    interpretation: data.interpretation?.trim() ? data.interpretation.trim() : null,
    linkedEvidence,
    linkedEventIds,
    caseVersion: session.caseVersion,
    submittedAt: now(),
  };
  session.events.push(clinicalEvent(clientEventId, 'SUBMIT_EXAM_OBSERVATION', 'exam', `提交查体观察与解释（关联 ${linkedEvidence.join('、')}）`, null, ['EX_OBSERVATION']));
  session.updatedAt = now();
  return {
    session,
    newMessages: [],
    feedback: feedbackFor(session, '观察与解释已保存（已关联本会话获得的查体结果），可修订重交。结果识别不做机器计分，最终提交原文将保留在报告快照，待教师结合查体记录复核。'),
    trace: [trace('病例状态', `保存查体观察/解释提交（关联 ${linkedEvidence.length} 项已获得结果，病例版本 ${session.caseVersion}；专项过程证据，不做机器计分）`)],
  };
}

function handlePlan(session: SessionState, data: Extract<AgentEvent, { type: 'SUBMIT_PLAN' }>['data'], clientEventId: string): AgentTurnResult {
  session.plan = data;
  if (getCase(session.caseId, session.sourceSnapshotVersion, session.id).sourceFacts !== undefined) {
    session.events.push(clinicalEvent(clientEventId, 'SUBMIT_PLAN', 'plan', `提交处置计划：${data.priority}`, null, ['PLAN']));
    advanceStageTo(session, 'plan'); session.updatedAt = now();
    return { session, newMessages: [], feedback: feedbackFor(session, '计划已记录。完成后可对照病例诊疗经过复盘。'), trace: [trace('病例状态', '保存处置思路，生命体征保持原始记录')] };
  }
  const safe = /吸氧|氧疗|监测/.test(`${data.priority} ${data.detail}`);
  if (safe) {
    session.vitals.spo2 = 97;
    session.vitals.respiratoryRate = 36;
  }
  session.events.push(clinicalEvent(clientEventId, 'SUBMIT_PLAN', 'plan', `提交处置计划：${data.priority}`, safe, ['PLAN']));
  advanceStageTo(session, 'plan');
  session.updatedAt = now();
  return {
    session,
    newMessages: [],
    feedback: feedbackFor(session, safe ? '安全校验通过：已优先处理低氧与生命体征风险。' : '当前存在低氧风险，请重新核对首要处置顺序。'),
    trace: [trace('安全校验', '校验是否优先稳定生命体征'), trace('病例状态', safe ? '处置后生命体征改善' : '保留处置前生命体征')],
  };
}

function handleCommunication(session: SessionState, text: string, clientEventId: string, speech?: EventSpeechMeta): AgentTurnResult {
  session.communication = text;
  session.unlockedEvidence = uniq([...session.unlockedEvidence, 'COMMUNICATION']);
  const studentMessage = message('student', text, speechOptions(speech));
  const hasEmpathy = /理解|担心|别紧张|一起|我会/.test(text);
  const isSourceCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id).sourceFacts !== undefined;
  const explainsRisk = (isSourceCase ? /危险|风险|注意|症状|病情|可能|观察/ : /呼吸|血氧|危险|风险/).test(text);
  const nextStep = /下一步|先|监测|检查|处理/.test(text);
  const good = hasEmpathy && explainsRisk && nextStep;
  const parentReply = good
    ? isSourceCase ? '谢谢医生，您这样解释我明白一些了，接下来我会配合检查和观察。' : '谢谢医生，我明白您会先处理呼吸和血氧问题，再一步一步告诉我检查结果。'
    : '医生，我还是有些担心。现在到底有什么风险，接下来要做什么呢？';
  const parentMessage = message('parent', parentReply, { emotion: good ? 'calm' : 'anxious' });
  session.messages.push(studentMessage, parentMessage);
  session.events.push(clinicalEvent(clientEventId, 'SEND_COMMUNICATION', 'communication', '完成家长沟通', good, ['COMMUNICATION']));
  // stage 不回退：guided 模式此前设回 'history'，若已推进至查体/检查/诊断/处置阶段，
  // 会被 DB 防跳级触发器以 SESSION_STAGE_REGRESSION 拒绝（真实平台回归实测定位）。
  // guided 保持当前 stage（沟通在任意阶段合法）；osce 维持推进至 communication 阶段。
  if (session.mode === 'osce') advanceStageTo(session, 'communication');
  session.updatedAt = now();
  return {
    session,
    newMessages: [studentMessage, parentMessage],
    feedback: feedbackFor(session, good ? '沟通覆盖共情、风险解释和下一步安排。' : '家长仍未获得完整的风险解释或下一步安排。'),
    trace: [trace('角色调度', '根据沟通内容更新家长情绪'), trace('OSCE评分', '记录共情、通俗解释与行动建议证据')],
  };
}

export interface AgentTurnOptions {
  forwardHeaders?: Record<string, string>;
  /** 学生会话 JWT：证据驱动的恢复态投影刷新（refreshProjectedFacts）需要以本人身份走受控 RPC。 */
  accessToken?: string | null;
}

export async function runAgentTurn(session: SessionState, event: AgentEvent, clientEventId: string, options?: AgentTurnOptions): Promise<AgentTurnResult> {
  if(!isTrainableCase(session.caseId))throw new Error('CASE_RETIRED');
  // 证据驱动的投影刷新（教师病例恢复态缓存）：学生真实执行查体/开单后 RPC 门控已按证据放行，
  // 会话作用域缓存仍为剥离态时重新恢复——避免引擎规则匹配读到剥离态造成假阴性
  // （病例实际有记录却判「资料未提供/检查不存在」）。失败不阻断回合（保持原有剥离态语义）。
  if (session.caseId.startsWith('teacher-') && session.sourceSnapshotVersion && options?.accessToken) {
    await refreshProjectedFacts(session.caseId, session.sourceSnapshotVersion, session.id, options.accessToken, {
      hasExam: session.unlockedEvidence.some((code) => code.startsWith('EX_') || code.startsWith('SOURCE_EX_')),
      hasTests: session.orderedTests.length > 0,
    });
  }
  refreshSourceSession(session);
  getCase(session.caseId, session.sourceSnapshotVersion, session.id);
  if (session.status !== 'active') throw new Error('SESSION_COMPLETED');
  if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now() && event.type !== 'FINISH_SESSION') {
    throw new Error('SESSION_EXPIRED');
  }
  if (session.events.some((item) => item.clientEventId === clientEventId)) {
    return { session, newMessages: [], feedback: null, trace: [trace('病例状态', '重复事件已按幂等键忽略')] };
  }
  // OSCE 事件-阶段门控 + 专项训练事件门控：学生不得经 API 获取当前模式不应开放的病例事实
  if (!validateEventStage(session, event)) throw new Error(session.mode === 'practice' ? 'PRACTICE_EVENT_FORBIDDEN' : 'OSCE_EVENT_STAGE_FORBIDDEN');

  switch (event.type) {
    case 'ASK_QUESTION': return handleQuestion(session, event.data.text, clientEventId, options?.forwardHeaders, event.data.speech);
    case 'DOCTOR_INTERVENTION': return handleIntervention(session, event.data.action, clientEventId);
    case 'EXAM_ACTION': return handleExam(session, event.data.toolId, event.data.bodyPartId, clientEventId, event.data.posture);
    case 'ORDER_TEST': return handleTest(session, event.data, clientEventId, options?.accessToken);
    case 'SUBMIT_DECISION': return handleDecision(session, event.data, clientEventId);
    case 'SUBMIT_HISTORY_SUMMARY': return handleHistorySummary(session, event.data.summary, clientEventId);
    case 'SUBMIT_EXAM_OBSERVATION': return handleExamObservation(session, event.data, clientEventId);
    case 'SUBMIT_PLAN': return handlePlan(session, event.data, clientEventId);
    case 'SEND_COMMUNICATION': return handleCommunication(session, event.data.text, clientEventId, event.data.speech);
    case 'NAVIGATE_STAGE': {
      if (!validateStageNavigation(session, event.data.stage)) throw new Error(session.mode === 'practice' ? 'PRACTICE_STAGE_FORBIDDEN' : 'OSCE_STAGE_BACKTRACK_FORBIDDEN');
      // 非 OSCE 的「非前进一格」导航（回看已完成阶段/返回会话中心/同格重进）只记录展示阶段
      // viewStage，不修改业务阶段 stage——stage 列单向不变，DB 防回退触发器语义保持；
      // 沉浸式/guided「处置后回会话中心继续追问/沟通」链路由此恢复（此前被触发器 409 阻断）。
      // 前进一格时正常推进业务阶段并清除回看态；OSCE 防作弊约束不变（回退在上方被拒）。
      const navOrder = getCase(session.caseId, session.sourceSnapshotVersion, session.id).stages.map((item) => item.id);
      const curIdx = navOrder.indexOf(session.stage);
      const tgtIdx = navOrder.indexOf(event.data.stage);
      const isForwardStep = tgtIdx === curIdx + 1;
      if (session.mode !== 'osce' && !isForwardStep) {
        session.viewStage = event.data.stage;
        session.events.push(clinicalEvent(clientEventId, 'NAVIGATE_STAGE', event.data.stage, `回看${event.data.stage}阶段（业务阶段保持${session.stage}）`, null, []));
        session.updatedAt = now();
        return { session, newMessages: [], feedback: null, trace: [trace('病例状态', `回看${event.data.stage}阶段（业务阶段不变）`)] };
      }
      session.stage = event.data.stage;
      session.viewStage = undefined;
      session.events.push(clinicalEvent(clientEventId, 'NAVIGATE_STAGE', event.data.stage, `进入${event.data.stage}阶段`, null, []));
      session.updatedAt = now();
      return { session, newMessages: [], feedback: null, trace: [trace('病例状态', `切换至${event.data.stage}阶段`)] };
    }
    case 'FINISH_SESSION': {
      session.status = 'completed';
      session.stage = 'report';
      session.events.push(clinicalEvent(clientEventId, 'FINISH_SESSION', 'report', '完成训练并请求生成报告', true, []));
      session.updatedAt = now();
      return { session, newMessages: [], feedback: null, trace: [trace('OSCE评分', '冻结过程证据并生成可解释报告')] };
    }
  }
}
