import type {
  AgentEvent,
  AgentMessage,
  AgentTraceItem,
  AgentTurnResult,
  ClinicalEvent,
  PracticeFocus,
  SessionMode,
  SessionState,
  Stage,
} from '@/domain/agent';
import { FLAGSHIP_CASE, findExamRule, findTest, getCase, identifyHistoryIntents } from '@/domain/case';
import { retrieveKnowledge } from '@/domain/knowledge';
import { renderRoleReply } from '@/lib/role-agent';

function now(): string {
  return new Date().toISOString();
}

function message(actor: AgentMessage['actor'], content: string, options?: Partial<Pick<AgentMessage, 'emotion' | 'kind'>>): AgentMessage {
  return {
    id: crypto.randomUUID(),
    actor,
    content,
    emotion: options?.emotion ?? 'neutral',
    kind: options?.kind ?? 'dialogue',
    createdAt: now(),
  };
}

function clinicalEvent(
  clientEventId: string,
  type: AgentEvent['type'],
  stage: Stage,
  summary: string,
  correct: boolean | null,
  evidenceCodes: string[],
): ClinicalEvent {
  return { id: crypto.randomUUID(), clientEventId, type, stage, summary, correct, evidenceCodes, createdAt: now() };
}

export function createInitialSession(userId: string, mode: SessionMode, caseId = FLAGSHIP_CASE.id, practiceFocus?: PracticeFocus): SessionState {
  const pediatricCase = getCase(caseId);
  const startedAt = now();
  const expiresAt = mode === 'osce' ? new Date(Date.now() + 8 * 60_000).toISOString() : null;
  return {
    id: crypto.randomUUID(),
    userId,
    caseId: pediatricCase.id,
    caseVersion: pediatricCase.version,
    mode,
    practiceFocus: mode === 'practice' ? practiceFocus ?? 'history' : null,
    stage: 'triage',
    status: 'active',
    startedAt,
    updatedAt: startedAt,
    expiresAt,
    messages: [
      message('system', pediatricCase.triage, { kind: 'navigation' }),
      message('parent', pediatricCase.openingParent, { emotion: 'anxious' }),
    ],
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

const LOCK_STAGES = process.env.LOCK_STAGES === 'true';

function validateStageNavigation(session: SessionState, target: Stage): boolean {
  if (!LOCK_STAGES) return true;
  if (session.mode !== 'osce') return true;
  const order = getCase(session.caseId).stages.map((stage) => stage.id);
  return order.indexOf(target) >= order.indexOf(session.stage);
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

async function handleQuestion(session: SessionState, text: string, clientEventId: string, forwardHeaders?: Record<string, string>): Promise<AgentTurnResult> {
  const spokenIntervention = detectSpokenIntervention(text);
  const pediatricCase = getCase(session.caseId);
  const intents = identifyHistoryIntents(session.caseId, text);
  if (spokenIntervention && intents.length === 0) return handleIntervention(session, spokenIntervention, clientEventId, text);
  if (spokenIntervention) applyInterventionState(session, spokenIntervention);
  const studentMessage = message('student', text);
  const newMessages: AgentMessage[] = [studentMessage];
  const traces = [trace('角色调度', '按患儿年龄、问题意图和家长插话状态选择回答者')];
  if (spokenIntervention) traces.push(trace('病例状态', '从学生原话识别沟通干预并更新应答状态'));

  if (intents.length === 0) {
    newMessages.push(
      message('child', '我不知道怎么说……妈妈知道。', { emotion: session.childEmotion }),
      message('parent', '医生，您可以问得再具体一点吗？', { emotion: 'anxious' }),
    );
    session.behavior.childResponseStyle = 'off_topic';
    session.events.push(clinicalEvent(clientEventId, 'ASK_QUESTION', 'history', '问题过于宽泛，未获得新的病例事实', false, []));
    session.messages.push(...newMessages);
    session.stage = 'history';
    session.updatedAt = now();
    return { session, newMessages, feedback: feedbackFor(session, '问题较宽泛，可围绕起病时间、危险症状或一般状态进一步追问。'), trace: traces };
  }

  const preferredActor = intents.every((intent) => intent.preferredActor === 'parent')
    ? 'parent'
    : intents.every((intent) => intent.preferredActor === 'child') ? 'child' : 'mixed';
  const childFact = intents.map((intent) => intent.childAnswer).join(' ');
  const parentFact = intents.map((intent) => intent.parentAnswer).join(' ');
  const roleResult = await renderRoleReply({
    childAge: pediatricCase.age,
    childSex: pediatricCase.sex,
    question: text,
    childFact,
    parentFact,
    preferredActor,
    parentPaused: session.parentInterruption === 'paused',
    childComforted: session.childEmotion === 'calm',
  }, forwardHeaders);
  const modelReply = roleResult.reply;
  const childAnswer = modelReply?.child ?? childFact;
  const parentAnswer = modelReply?.parent ?? parentFact;
  const parentPaused = session.parentInterruption === 'paused';

  if (preferredActor === 'parent' && !parentPaused) {
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

  session.askedIntents = uniq([...session.askedIntents, ...intents.map((intent) => intent.id)]);
  session.unlockedEvidence = uniq([...session.unlockedEvidence, ...intents.map((intent) => intent.evidenceCode)]);
  if (intents.some((intent) => intent.id === 'exposure')) session.behavior.hiddenExposureRevealed = true;
  session.behavior.childResponseStyle = session.childEmotion === 'calm' ? 'cooperative' : 'brief';
  const labels = intents.map((intent) => intent.label).join('、');
  const evidenceCodes = intents.map((intent) => intent.evidenceCode);
  if (spokenIntervention) evidenceCodes.push('COMM_INTERVENTION');
  session.events.push(clinicalEvent(clientEventId, 'ASK_QUESTION', 'history', `完成${labels}问诊${spokenIntervention ? '并完成沟通干预' : ''}`, true, evidenceCodes));
  session.messages.push(...newMessages);
  session.stage = 'history';
  session.updatedAt = now();
  const sources = retrieveKnowledge(`${labels} 呼吸 肺炎`).map((source) => source.id);
  traces.push(trace('病例状态', `仅解锁“${labels}”对应的预置病史事实`));
  traces.push(trace('知识检索', '检索问诊结构与儿童危险信号公开测试资料', sources));
  return { session, newMessages, feedback: feedbackFor(session, `已形成“${labels}”的过程证据。`), trace: traces, runtime: roleResult.runtime };
}

function handleIntervention(session: SessionState, action: Extract<AgentEvent, { type: 'DOCTOR_INTERVENTION' }>['data']['action'], clientEventId: string, spokenText?: string): AgentTurnResult {
  const patientName = getCase(session.caseId).patientName;
  const copy = {
    child_answer: `${patientName}，接下来请你自己告诉我哪里不舒服，可以慢慢说。`,
    pause_parent: '我想先听孩子本人回答，家长稍后再补充，可以吗？',
    comfort_child: `${patientName}别紧张，我会一步一步告诉你要做什么，不舒服可以随时说。`,
  }[action];
  const studentMessage = message('student', spokenText ?? copy);
  let response: AgentMessage;
  applyInterventionState(session, action);
  if (action === 'pause_parent') {
    response = message('parent', '好的，我等孩子说完再补充。', { emotion: 'neutral' });
  } else if (action === 'comfort_child') {
    response = message('child', '好……我会慢慢说。', { emotion: 'calm' });
  } else {
    response = message('child', '嗯，我自己说。', { emotion: session.childEmotion });
  }
  const newMessages = [studentMessage, response];
  session.messages.push(...newMessages);
  session.events.push(clinicalEvent(clientEventId, 'DOCTOR_INTERVENTION', 'history', action === 'comfort_child' ? '完成患儿情绪安抚' : '调整患儿与家长应答秩序', true, ['COMM_INTERVENTION']));
  session.stage = 'history';
  session.updatedAt = now();
  return {
    session,
    newMessages,
    feedback: feedbackFor(session, '已识别你的沟通表达，将影响后续回答顺序与患儿配合度。'),
    trace: [trace('角色调度', '更新患儿情绪、家长插话和配合度状态'), trace('病例状态', '记录医生干预证据')],
  };
}

function handleExam(session: SessionState, toolId: string, bodyPartId: string, clientEventId: string): AgentTurnResult {
  const rule = findExamRule(session.caseId, toolId, bodyPartId);
  const traceItems = [trace('查体规则', '校验准备动作、器材、部位与检查顺序')];
  if (!rule) {
    session.events.push(clinicalEvent(clientEventId, 'EXAM_ACTION', 'exam', `器材${toolId}与部位${bodyPartId}不匹配`, false, []));
    session.stage = 'exam';
    session.updatedAt = now();
    return { session, newMessages: [], feedback: feedbackFor(session, '器材与部位不匹配，未解锁任何深层体征。'), trace: traceItems };
  }
  const missing = rule.requires.filter((code) => !session.unlockedEvidence.includes(code));
  if (missing.length > 0) {
    session.events.push(clinicalEvent(clientEventId, 'EXAM_ACTION', 'exam', `${rule.label}缺少必要准备动作`, false, []));
    session.stage = 'exam';
    session.updatedAt = now();
    return { session, newMessages: [], feedback: feedbackFor(session, '尚未完成必要准备。请先进行手卫生并向患儿说明检查。'), trace: [...traceItems, trace('安全校验', '阻止未完成准备的深层检查')] };
  }
  session.unlockedEvidence = uniq([...session.unlockedEvidence, rule.evidenceCode]);
  if (rule.id === 'prep-hygiene') session.preparationActions = uniq([...session.preparationActions, rule.id]);
  if (rule.evidenceCode === 'EX_SPO2') session.vitals.spo2 = 92;
  session.events.push(clinicalEvent(clientEventId, 'EXAM_ACTION', 'exam', `${rule.label}：${rule.result}`, true, [rule.evidenceCode]));
  session.stage = 'exam';
  session.updatedAt = now();
  const resultMessage = message('system', rule.result, { kind: 'navigation' });
  session.messages.push(resultMessage);
  return {
    session,
    newMessages: [resultMessage],
    feedback: feedbackFor(session, `${rule.label}已完成，结果已写入病例证据链。`),
    trace: [...traceItems, trace('病例状态', `解锁${rule.evidenceCode}体征证据`)],
  };
}

function handleTest(session: SessionState, testId: string, clientEventId: string): AgentTurnResult {
  const test = findTest(session.caseId, testId);
  if (!test) throw new Error('TEST_NOT_FOUND');
  session.orderedTests = uniq([...session.orderedTests, test.id]);
  session.unlockedEvidence = uniq([...session.unlockedEvidence, test.evidenceCode]);
  session.events.push(clinicalEvent(clientEventId, 'ORDER_TEST', 'tests', `${test.label}：${test.result}`, test.appropriate, [test.evidenceCode]));
  session.stage = 'tests';
  session.updatedAt = now();
  const resultMessage = message('system', test.result, { kind: 'navigation' });
  session.messages.push(resultMessage);
  return {
    session,
    newMessages: [resultMessage],
    feedback: feedbackFor(session, test.appropriate ? `${test.label}与当前证据相符。` : '当前证据不支持常规选择该检查，已记录低价值检查。'),
    trace: [trace('病例状态', '记录检查选择并解锁预置结果'), trace('安全校验', '判断检查适宜性')],
  };
}

function handleDecision(session: SessionState, data: Extract<AgentEvent, { type: 'SUBMIT_DECISION' }>['data'], clientEventId: string): AgentTurnResult {
  session.decision = data;
  session.events.push(clinicalEvent(clientEventId, 'SUBMIT_DECISION', 'assessment', `提交初步诊断：${data.diagnosis}`, null, ['DECISION']));
  session.stage = 'assessment';
  session.updatedAt = now();
  const sources = retrieveKnowledge(`${data.diagnosis} 低氧 呼吸`).map((source) => source.id);
  return {
    session,
    newMessages: [],
    feedback: feedbackFor(session, '诊断已保存。系统将在报告中核对诊断与已获取证据是否一致。'),
    trace: [trace('病例状态', '保存病情摘要、初步诊断与鉴别诊断'), trace('知识检索', '检索诊断与危险信号依据', sources)],
  };
}

function handlePlan(session: SessionState, data: Extract<AgentEvent, { type: 'SUBMIT_PLAN' }>['data'], clientEventId: string): AgentTurnResult {
  session.plan = data;
  const safe = /吸氧|氧疗|监测/.test(`${data.priority} ${data.detail}`);
  if (safe) {
    session.vitals.spo2 = 97;
    session.vitals.respiratoryRate = 36;
  }
  session.events.push(clinicalEvent(clientEventId, 'SUBMIT_PLAN', 'plan', `提交处置计划：${data.priority}`, safe, ['PLAN']));
  session.stage = 'plan';
  session.updatedAt = now();
  return {
    session,
    newMessages: [],
    feedback: feedbackFor(session, safe ? '安全校验通过：已优先处理低氧与生命体征风险。' : '当前存在低氧风险，请重新核对首要处置顺序。'),
    trace: [trace('安全校验', '校验是否优先稳定生命体征'), trace('病例状态', safe ? '处置后生命体征改善' : '保留处置前生命体征')],
  };
}

function handleCommunication(session: SessionState, text: string, clientEventId: string): AgentTurnResult {
  session.communication = text;
  session.unlockedEvidence = uniq([...session.unlockedEvidence, 'COMMUNICATION']);
  const studentMessage = message('student', text);
  const hasEmpathy = /理解|担心|别紧张|一起|我会/.test(text);
  const explainsRisk = /呼吸|血氧|危险|风险/.test(text);
  const nextStep = /下一步|先|监测|检查|处理/.test(text);
  const good = hasEmpathy && explainsRisk && nextStep;
  const parentReply = good
    ? '谢谢医生，我明白您会先处理呼吸和血氧问题，再一步一步告诉我检查结果。'
    : '医生，我还是有些担心。现在到底有什么风险，接下来要做什么呢？';
  const parentMessage = message('parent', parentReply, { emotion: good ? 'calm' : 'anxious' });
  session.messages.push(studentMessage, parentMessage);
  session.events.push(clinicalEvent(clientEventId, 'SEND_COMMUNICATION', 'communication', '完成家长沟通', good, ['COMMUNICATION']));
  session.stage = session.mode === 'osce' ? 'communication' : 'history';
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
}

export async function runAgentTurn(session: SessionState, event: AgentEvent, clientEventId: string, options?: AgentTurnOptions): Promise<AgentTurnResult> {
  if (session.status !== 'active') throw new Error('SESSION_COMPLETED');
  if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now() && event.type !== 'FINISH_SESSION') {
    throw new Error('SESSION_EXPIRED');
  }
  if (session.events.some((item) => item.clientEventId === clientEventId)) {
    return { session, newMessages: [], feedback: null, trace: [trace('病例状态', '重复事件已按幂等键忽略')] };
  }

  switch (event.type) {
    case 'ASK_QUESTION': return handleQuestion(session, event.data.text, clientEventId, options?.forwardHeaders);
    case 'DOCTOR_INTERVENTION': return handleIntervention(session, event.data.action, clientEventId);
    case 'EXAM_ACTION': return handleExam(session, event.data.toolId, event.data.bodyPartId, clientEventId);
    case 'ORDER_TEST': return handleTest(session, event.data.testId, clientEventId);
    case 'SUBMIT_DECISION': return handleDecision(session, event.data, clientEventId);
    case 'SUBMIT_PLAN': return handlePlan(session, event.data, clientEventId);
    case 'SEND_COMMUNICATION': return handleCommunication(session, event.data.text, clientEventId);
    case 'NAVIGATE_STAGE': {
      if (!validateStageNavigation(session, event.data.stage)) throw new Error('OSCE_STAGE_BACKTRACK_FORBIDDEN');
      session.stage = event.data.stage;
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
