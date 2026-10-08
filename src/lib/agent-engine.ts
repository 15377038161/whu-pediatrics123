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
    ...(pediatricCase.sourceFacts !== undefined ? { caseOptions: {
      sourceName: pediatricCase.sourceFacts?.sourceName ?? pediatricCase.title,
      age: pediatricCase.age, sex: pediatricCase.sex, hasSource: Boolean(pediatricCase.sourceFacts),
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

export function refreshSourceSession(session: SessionState): SessionState {
  if (!session.caseId.startsWith('teacher-') || (session.caseVersion >= 2 && session.caseOptions)) return session;
  const fresh = createInitialSession(session.userId, session.mode, session.caseId, session.practiceFocus ?? undefined);
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
  if (pediatricCase.sourceFacts !== undefined) {
    if (spokenIntervention) applyInterventionState(session, spokenIntervention);
    return handleSourceQuestion(session, text, clientEventId, forwardHeaders);
  }
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
    scene: session.mode === 'immersive' ? `沉浸式${session.stage}场景` : session.stage,
    recentMessages: session.messages.slice(-6).map((item) => ({ actor: item.actor, content: item.content })),
    cooperation: session.behavior.cooperation,
    disclosedFacts: session.askedIntents,
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

async function handleSourceQuestion(session: SessionState, text: string, clientEventId: string, forwardHeaders?: Record<string, string>): Promise<AgentTurnResult> {
  const pediatricCase = getCase(session.caseId);
  const source = pediatricCase.sourceFacts;
  const history = source?.sections.history ?? '';
  const sentences = history.split(/[。；;\n]/).filter((line) => line.trim());
  const topics = [
    { question: /哪里不舒服|怎么了|什么不舒服|主要|为什么来|主诉/, source: /./ },
    { question: /多久|什么时候|几天|开始|起病/, source: /天|周|月|小时|分钟|起病|出现/ },
    { question: /发烧|发热|体温|退烧/, source: /发热|发烧|体温|退热/ },
    { question: /精神|吃饭|食欲|吃东西|饮食|睡|喝水|大小便|小便/, source: /精神|饮食|食欲|睡眠|小便|大便|吃奶|喂养|尿/ },
    { question: /出生|早产|胎龄|怀孕|发育|生长|喂养/, source: /胎|产|出生|窒息|喂养|发育|生长/ },
    { question: /以前|既往|住院|过敏|疫苗|接种|家族/, source: /既往|平素|过敏|接种|家族|否认/ },
    { question: /吃药|用药|治疗|处理|在家|药/, source: /治疗|用药|予|在家|药|处理/ },
    { question: /喘|憋|呼吸|咳|痰/, source: /喘|呼吸|憋|咳|痰/ },
    { question: /水肿|肿|浮肿|尿|血尿/, source: /肿|浮肿|尿/ },
    { question: /疼|痛|肚子|呕吐|腹泻|拉肚子/, source: /痛|腹|呕吐|腹泻|大便/ },
    { question: /抽搐|惊厥|发作|意识|昏迷/, source: /抽搐|惊厥|发作|意识|昏迷/ },
    { question: /黄|皮疹|皮肤|出血/, source: /黄|皮疹|皮肤|出血/ },
  ];
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
    if (/哪里不舒服|怎么了|主诉|为什么来/.test(text) && source) matches = [{ fact: source.complaint, index: -2 }];
  }
  const fact = matches.map((item) => item.fact).join('。');
  const roleResult = fact ? await renderRoleReply({ childAge: pediatricCase.age, childSex: pediatricCase.sex,
    question: text, childFact: '', parentFact: fact, preferredActor: 'parent', parentPaused: session.parentInterruption === 'paused',
    childComforted: session.childEmotion === 'calm', recentMessages: session.messages.slice(-6),
  }, forwardHeaders) : null;
  const reply = fact ? roleResult?.reply?.parent ?? `当时的情况是这样：${fact.replaceAll('患儿', '孩子')}` : '这部分我说不清楚，需要再核实一下。';
  const newMessages = [message('student', text), message(session.parentInterruption === 'paused' ? 'child' : 'parent', session.parentInterruption === 'paused' ? '这个我说不清楚，可以请家长补充吗？' : reply, { emotion: session.childEmotion })];
  const codes = session.parentInterruption === 'paused' ? [] : matches.map((item) => `SOURCE_HX_${item.index}`);
  session.askedIntents = uniq([...session.askedIntents, ...codes]);
  session.unlockedEvidence = uniq([...session.unlockedEvidence, ...codes]);
  session.messages.push(...newMessages);
  session.events.push(clinicalEvent(clientEventId, 'ASK_QUESTION', 'history', codes.length ? `依据病例正文回答：${text}` : `问诊记录：${text}；该信息尚未获得`, null, codes));
  session.stage = 'history'; session.updatedAt = now();
  return { session, newMessages, feedback: feedbackFor(session, codes.length ? '回答依据该病例的原始病史，已记录来源证据。' : '请记录需要补充核实的信息，继续采集其他病史。'),
    trace: [trace('知识检索', '按本病例病史检索已提供事实', source ? [source.caseId] : []), trace('病例状态', '保留未知信息，不补写病史')], runtime: roleResult?.runtime };
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
  if (rule.evidenceCode === 'EX_SPO2' && getCase(session.caseId).sourceFacts === undefined) session.vitals.spo2 = 92;
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
    feedback: feedbackFor(session, test.appropriate === null ? '已打开本病例提供的检查记录，请结合病史判断其价值。' : test.appropriate ? `${test.label}与当前证据相符。` : '当前证据不支持常规选择该检查，已记录低价值检查。'),
    trace: [trace('病例状态', '记录检查选择并解锁预置结果'), trace('安全校验', '判断检查适宜性')],
  };
}

function handleDecision(session: SessionState, data: Extract<AgentEvent, { type: 'SUBMIT_DECISION' }>['data'], clientEventId: string): AgentTurnResult {
  session.decision = data;
  session.events.push(clinicalEvent(clientEventId, 'SUBMIT_DECISION', 'assessment', `提交初步诊断：${data.diagnosis}`, null, ['DECISION']));
  session.stage = 'assessment';
  session.updatedAt = now();
  const pediatricCase = getCase(session.caseId);
  const sources = pediatricCase.sourceFacts !== undefined ? pediatricCase.sourceFacts ? [pediatricCase.sourceFacts.caseId] : [] : retrieveKnowledge(`${data.diagnosis} 低氧 呼吸`).map((source) => source.id);
  return {
    session,
    newMessages: [],
    feedback: feedbackFor(session, '诊断已保存。系统将在报告中核对诊断与已获取证据是否一致。'),
    trace: [trace('病例状态', '保存病情摘要、初步诊断与鉴别诊断'), trace('知识检索', '检索诊断与危险信号依据', sources)],
  };
}

function handlePlan(session: SessionState, data: Extract<AgentEvent, { type: 'SUBMIT_PLAN' }>['data'], clientEventId: string): AgentTurnResult {
  session.plan = data;
  if (getCase(session.caseId).sourceFacts !== undefined) {
    session.events.push(clinicalEvent(clientEventId, 'SUBMIT_PLAN', 'plan', `提交处置计划：${data.priority}`, null, ['PLAN']));
    session.stage = 'plan'; session.updatedAt = now();
    return { session, newMessages: [], feedback: feedbackFor(session, '计划已记录。完成后可对照病例诊疗经过复盘。'), trace: [trace('病例状态', '保存处置思路，生命体征保持原始记录')] };
  }
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
  const isSourceCase = getCase(session.caseId).sourceFacts !== undefined;
  const explainsRisk = (isSourceCase ? /危险|风险|注意|症状|病情|可能|观察/ : /呼吸|血氧|危险|风险/).test(text);
  const nextStep = /下一步|先|监测|检查|处理/.test(text);
  const good = hasEmpathy && explainsRisk && nextStep;
  const parentReply = good
    ? isSourceCase ? '谢谢医生，您这样解释我明白一些了，接下来我会配合检查和观察。' : '谢谢医生，我明白您会先处理呼吸和血氧问题，再一步一步告诉我检查结果。'
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
  refreshSourceSession(session);
  getCase(session.caseId);
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
