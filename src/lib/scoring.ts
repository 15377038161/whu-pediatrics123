import type { AbilityScores, ScoreEvidence, SessionState, TrainingReport } from '@/domain/agent';
import { getCase } from '@/domain/case';
import { flagshipClinicalRubric, focusedRubrics, type RubricDefinition, type RubricItem, type RubricItemStatus } from '@/domain/training-rubric';

function includesAny(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function eventIdsFor(session: SessionState, codes: string[]): string[] {
  return session.events.filter((event) => event.evidenceCodes.some((code) => codes.includes(code))).map((event) => event.id);
}

/** 评分对照来源：优先使用会话绑定版本的安全读取结果（RPC/教师直读），
 *  避免直接使用进程内快照（可能因召回漂移与绑定版本不一致）。 */
export interface ReportReference {
  diagnosis?: string;
  plan?: string;
}

/** 原始提交快照（方案 4.6）：报告生成时冻结学生的全部最终提交原文，不追溯重写。 */
function snapshotSubmissions(session: SessionState): NonNullable<TrainingReport['studentSubmissions']> {
  return {
    decision: session.decision ? { ...session.decision } : null,
    plan: session.plan ? { ...session.plan } : null,
    communication: session.communication ?? null,
    historySummary: session.historySummary ?? null,
  };
}

/** 量表选择（方案 4.5/5.2）：practice 会话按 focus 取专项量表，其余（guided/osce/immersive 演示病例）
 *  用旗舰完整接诊量表；来源病例（教师病例）走过程分口径（buildSourceReport），不套用临床量表。 */
function rubricForSession(session: SessionState): RubricDefinition {
  if (session.mode === 'practice' && session.practiceFocus) {
    const rubric = focusedRubrics[session.practiceFocus];
    if (rubric) return rubric;
  }
  return flagshipClinicalRubric;
}

export function buildReport(session: SessionState, reportId = crypto.randomUUID(), reference?: ReportReference): TrainingReport {
  // 评分全程按会话绑定版本+会话作用域读取教学事实：teacher 病例命中本人会话投影态，
  // 不读共享键的完整事实（防跨会话泄露）；无有效事实时走 buildSourceReport 过程分口径（非生成式兜底）。
  const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
  if (pediatricCase.sourceFacts !== undefined) return buildSourceReport(session, reportId, reference);
  return buildRubricReport(session, reportId, rubricForSession(session));
}

interface ItemEvaluation {
  status: RubricItemStatus;
  score: number;
  detail: string;
  evidenceCodes: string[];
}

/** 病例相关沟通内容要素词（C-评分补验-01）：礼貌/共情类关键词命中仅为候选证据，
 *  沟通原文须包含病例相关实际内容（症状/体征/处置等）才授予最终沟通质量分。 */
const CASE_CONTENT_TERMS = ['发热', '发烧', '咳嗽', '喘', '呼吸', '血氧', '氧', '肺', '体温', '精神', '进食', '尿量', '用药', '药物', '观察', '检查', '复查', '住院', '监测', '病情', '感染', '治疗', '处置', '吸氧', '雾化', '随访', '听诊', '口咽'];

function hasCaseContent(text: string): boolean {
  return text.trim().length > 0 && includesAny(text, CASE_CONTENT_TERMS);
}

/** 沟通不可评价（C-评分补验-01）：空提交、否定表述或仅礼貌类候选词时，
 *  关键词命中仅作候选证据，不授予最终沟通质量分，待教师复核。 */
function communicationNotAssessable(): ItemEvaluation {
  return {
    status: 'not_assessable',
    score: 0,
    detail: '沟通原文缺少病例相关实际内容（空提交、否定表述或仅礼貌类候选词）；关键词命中仅作候选证据，本项记无法评价，待教师复核。',
    evidenceCodes: ['COMMUNICATION'],
  };
}

function evaluateItem(session: SessionState, item: RubricItem): ItemEvaluation {
  return rubricForSession(session).scope === 'focused' ? evaluateFocusedItem(session, item) : evaluateFlagshipItem(session, item);
}

/** 旗舰完整接诊量表执行器（rubric-clinical-flagship v1）：证据码沿用 RUBRIC_<itemId>，
 *  保持历史报告的 RUBRIC_SAFETY/RUBRIC_EXAM_RESP/RUBRIC_EXAM_OXYGEN/RUBRIC_HISTORY_DANGER/RUBRIC_COMMUNICATION 口径。 */
function evaluateFlagshipItem(session: SessionState, item: RubricItem): ItemEvaluation {
  const asked = new Set(session.askedIntents);
  const evidence = new Set(session.unlockedEvidence);
  const decisionText = `${session.decision?.diagnosis ?? ''} ${session.decision?.summary ?? ''} ${session.decision?.diagnosisBasis ?? ''} ${session.decision?.differentials ?? ''}`;
  const planText = `${session.plan?.priority ?? ''} ${session.plan?.detail ?? ''}`;
  const communicationText = session.communication ?? '';
  const isWheezeCase = session.caseId === 'peds-wheeze-002';
  switch (item.itemId) {
    case 'HISTORY_PRESENTING': {
      const parts = [
        asked.has('onset') ? 3 : 0,
        asked.has('fever') ? 3 : 0,
        asked.has('cough') ? 2 : 0,
        asked.has('treatment') ? 2 : 0,
      ];
      const score = parts.reduce((sum, value) => sum + value, 0);
      return {
        status: score === item.maxScore ? 'achieved' : score > 0 ? 'partial' : 'missing',
        score,
        detail: score > 0 ? `问诊覆盖主诉与现病史要点（起病/发热/咳嗽/院前用药），得 ${score}/${item.maxScore} 分。` : item.feedback,
        evidenceCodes: ['HX_ONSET', 'HX_FEVER', 'HX_COUGH', 'HX_TREATMENT'],
      };
    }
    case 'HISTORY_DANGER': {
      const hit = asked.has('danger');
      return {
        status: hit ? 'achieved' : 'missing',
        score: hit ? item.maxScore : 0,
        detail: hit ? '主动询问气促、喘憋或青紫，并形成可回放记录。' : item.feedback,
        evidenceCodes: ['HX_DANGER'],
      };
    }
    case 'HISTORY_GENERAL': {
      const hit = asked.has('general');
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '询问精神、进食、尿量等一般状态。' : item.feedback, evidenceCodes: ['HX_GENERAL'] };
    }
    case 'HISTORY_EXPOSURE': {
      const hit = asked.has('exposure');
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '询问接触史与诱因。' : item.feedback, evidenceCodes: ['HX_EXPOSURE'] };
    }
    case 'HISTORY_BACKGROUND': {
      const hit = ['vaccination', 'birth', 'allergy'].some((intent) => asked.has(intent));
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '询问预防接种、出生发育或过敏既往史。' : item.feedback, evidenceCodes: ['HX_VACCINATION', 'HX_BIRTH', 'HX_ALLERGY'] };
    }
    case 'EXAM_PREP': {
      const hit = evidence.has('EX_PREP');
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '完成手卫生与检查说明。' : item.feedback, evidenceCodes: ['EX_PREP'] };
    }
    case 'EXAM_RESP': {
      const hit = evidence.has('EX_RESP');
      return {
        status: hit ? 'achieved' : 'missing',
        score: hit ? item.maxScore : 0,
        detail: hit ? `完成手卫生后使用听诊器检查胸部并获取${isWheezeCase ? '哮鸣音与呼气相变化' : '局灶体征'}。` : item.feedback,
        evidenceCodes: ['EX_RESP'],
      };
    }
    case 'EXAM_OXYGEN': {
      const hit = evidence.has('EX_SPO2');
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '正确使用血氧仪获取静息血氧结果。' : item.feedback, evidenceCodes: ['EX_SPO2'] };
    }
    case 'EXAM_OTHER': {
      const hit = ['EX_TEMP', 'EX_MOUTH', 'EX_BP'].some((code) => evidence.has(code));
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '完成体温、口咽或血压等其他部位检查。' : item.feedback, evidenceCodes: ['EX_TEMP', 'EX_MOUTH', 'EX_BP'] };
    }
    case 'REASONING_PRIMARY': {
      const hit = includesAny(decisionText, isWheezeCase ? ['喘息', '哮喘', '支气管痉挛', '气道高反应'] : ['肺炎', '下呼吸道感染']);
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? `诊断覆盖本病例主要问题（${isWheezeCase ? '喘息性气道问题' : '肺部感染'}）。` : item.feedback, evidenceCodes: ['DECISION'] };
    }
    case 'REASONING_RISK': {
      const hit = includesAny(decisionText, ['低氧', '血氧', '呼吸困难', '气促', '危险']);
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '识别低氧、呼吸困难等危险信号。' : item.feedback, evidenceCodes: ['DECISION'] };
    }
    case 'REASONING_DIFFERENTIAL': {
      const differentials = session.decision?.differentials.trim() ?? '';
      if (!differentials) return { status: 'missing', score: 0, detail: item.feedback, evidenceCodes: ['DECISION'] };
      const hasReason = includesAny(differentials, ['考虑', '可能', '鉴别', '不除外', '依据', '支持', '除外']);
      return hasReason
        ? { status: 'achieved', score: item.maxScore, detail: '鉴别诊断包含鉴别方向与理由。', evidenceCodes: ['DECISION'] }
        : { status: 'partial', score: 2, detail: '鉴别诊断仅列举疾病名词，未给出鉴别理由。', evidenceCodes: ['DECISION'] };
    }
    case 'SAFETY': {
      if (includesAny(planText, ['回家观察', '无需处理', '仅观察'])) {
        return { status: 'incorrect', score: 0, detail: '处置包含不安全出院表述，本项按错误做法计 0 分。', evidenceCodes: ['PLAN'] };
      }
      const safePriority = includesAny(planText, ['吸氧', '氧疗', '监测', '生命体征']);
      const furtherAssessment = includesAny(planText, ['评估', '住院', '转诊', '复评', '检查']);
      const score = (safePriority ? 8 : 0) + (furtherAssessment ? 4 : 0) + 3;
      return {
        status: score === item.maxScore ? 'achieved' : 'partial',
        score,
        detail: score > 0 ? `处置覆盖稳定生命体征与进一步评估安排，得 ${score}/${item.maxScore} 分。` : item.feedback,
        evidenceCodes: ['PLAN'],
      };
    }
    case 'COMMUNICATION': {
      // C-评分补验-01：关键词命中仅为候选证据——无病例相关实际内容（空/否定/仅礼貌词）记无法评价；
      // 有实际内容时共情候选词部分计分（2/3，待教师复核），风险解释与下一步按提交原文计分。
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const empathy = includesAny(communicationText, ['理解', '担心', '别紧张', '别担心', '一起', '我会']);
      const explainsRisk = includesAny(communicationText, ['呼吸', '血氧', '危险', '风险']);
      const nextStep = includesAny(communicationText, ['下一步', '接下来', '监测', '检查', '处理', '吸氧', '复查']);
      const score = (empathy ? 2 : 0) + (explainsRisk ? 4 : 0) + (nextStep ? 3 : 0);
      return {
        status: score > 0 ? 'partial' : 'missing',
        score,
        detail: score > 0
          ? `沟通原文含病例相关实际内容；共情按候选证据部分计分（2/3，待教师复核），风险解释与下一步按提交原文计分，得 ${score}/${item.maxScore} 分。`
          : item.feedback,
        evidenceCodes: ['COMMUNICATION'],
      };
    }
    case 'PROFESSIONALISM': {
      const comfortUsed = session.events.some((event) => event.summary.includes('安抚'));
      const prepIndex = session.events.findIndex((event) => event.evidenceCodes.includes('EX_PREP'));
      const contactIndex = session.events.findIndex((event) => event.type === 'EXAM_ACTION' && event.correct !== false && event.evidenceCodes.some((code) => CONTACT_EXAM_CODES.includes(code)));
      const ordered = prepIndex >= 0 && (contactIndex === -1 || prepIndex < contactIndex);
      const score = (evidence.has('EX_PREP') ? 2 : 0) + (comfortUsed ? 2 : 0) + (ordered ? 1 : 0);
      return {
        status: score === item.maxScore ? 'achieved' : score > 0 ? 'partial' : 'missing',
        score,
        detail: score > 0 ? `手卫生、安抚与查体顺序证据得 ${score}/${item.maxScore} 分。` : item.feedback,
        evidenceCodes: ['EX_PREP'],
      };
    }
    default:
      return { status: 'not_assessable', score: 0, detail: `量表项 ${item.itemId} 暂无执行器，按无法评价处理。`, evidenceCodes: [] };
  }
}

const CONTACT_EXAM_CODES = ['EX_TEMP', 'EX_MOUTH', 'EX_RESP', 'EX_SPO2', 'EX_BP'];

/** 专项量表执行器（方案 4.5）：分数只评价本专项，不因未开放环节扣分；
 *  provided 事实（HX_PROVIDED 等）不进入计分证据。 */
function evaluateFocusedItem(session: SessionState, item: RubricItem): ItemEvaluation {
  const asked = new Set(session.askedIntents);
  const evidence = new Set(session.unlockedEvidence);
  const decisionText = `${session.decision?.diagnosis ?? ''} ${session.decision?.summary ?? ''} ${session.decision?.diagnosisBasis ?? ''}`;
  const planText = `${session.plan?.priority ?? ''} ${session.plan?.detail ?? ''}`;
  const communicationText = session.communication ?? '';
  switch (item.itemId) {
    case 'HX_PRESENTING': {
      const score = (asked.has('onset') ? 10 : 0) + (asked.has('fever') ? 10 : 0) + (asked.has('cough') ? 8 : 0) + (asked.has('treatment') ? 7 : 0);
      return {
        status: score === item.maxScore ? 'achieved' : score > 0 ? 'partial' : 'missing',
        score,
        detail: score > 0 ? `主诉及现病史要点（起病/发热/咳嗽/院前用药）得 ${score}/${item.maxScore} 分。` : item.feedback,
        evidenceCodes: ['HX_ONSET', 'HX_FEVER', 'HX_COUGH', 'HX_TREATMENT'],
      };
    }
    case 'HX_RED_FLAGS': {
      const score = (asked.has('danger') ? 18 : 0) + (asked.has('general') ? 12 : 0);
      return {
        status: score === item.maxScore ? 'achieved' : score > 0 ? 'partial' : 'missing',
        score,
        detail: score > 0 ? `危险信号与一般状态追问得 ${score}/${item.maxScore} 分。` : item.feedback,
        evidenceCodes: ['HX_DANGER', 'HX_GENERAL'],
      };
    }
    case 'HX_BACKGROUND': {
      const score = (asked.has('exposure') ? 7 : 0) + (asked.has('vaccination') ? 5 : 0) + (asked.has('birth') ? 4 : 0) + (asked.has('allergy') ? 4 : 0);
      return {
        status: score === item.maxScore ? 'achieved' : score > 0 ? 'partial' : 'missing',
        score,
        detail: score > 0 ? `接触史、预防接种、出生发育与过敏既往覆盖得 ${score}/${item.maxScore} 分。` : item.feedback,
        evidenceCodes: ['HX_EXPOSURE', 'HX_VACCINATION', 'HX_BIRTH', 'HX_ALLERGY'],
      };
    }
    case 'HX_ORGANIZATION': {
      const asks = session.events.filter((event) => event.type === 'ASK_QUESTION');
      const validAsks = asks.filter((event) => event.evidenceCodes.some((code) => code.startsWith('HX_'))).length;
      if (asks.length === 0) return { status: 'missing', score: 0, detail: item.feedback, evidenceCodes: [] };
      const invalidRatio = 1 - validAsks / asks.length;
      if (invalidRatio <= 0.2) return { status: 'achieved', score: item.maxScore, detail: `有效提问 ${validAsks}/${asks.length}，提问组织性良好。`, evidenceCodes: [] };
      if (invalidRatio <= 0.45) return { status: 'partial', score: 8, detail: `有效提问 ${validAsks}/${asks.length}，宽泛提问偏多。`, evidenceCodes: [] };
      return { status: 'missing', score: 0, detail: `有效提问仅 ${validAsks}/${asks.length}，问题过于宽泛。`, evidenceCodes: [] };
    }
    case 'EX_PREPARATION': {
      const hit = evidence.has('EX_PREP');
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '完成手卫生与检查说明。' : item.feedback, evidenceCodes: ['EX_PREP'] };
    }
    case 'EX_LUNG_AUSCULTATION': {
      const hit = evidence.has('EX_RESP');
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '听诊器×胸部完成肺部听诊。' : item.feedback, evidenceCodes: ['EX_RESP'] };
    }
    case 'EX_OXIMETRY': {
      const hit = evidence.has('EX_SPO2');
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '血氧仪获得静息血氧结果。' : item.feedback, evidenceCodes: ['EX_SPO2'] };
    }
    case 'EX_SEQUENCE': {
      const prepIndex = session.events.findIndex((event) => event.evidenceCodes.includes('EX_PREP'));
      const contactIndex = session.events.findIndex((event) => event.type === 'EXAM_ACTION' && event.correct !== false && event.evidenceCodes.some((code) => CONTACT_EXAM_CODES.includes(code)));
      const unpreparedAttempts = session.events.filter((event) => event.type === 'EXAM_ACTION' && event.correct === false && /缺少必要准备动作|尚未完成手卫生/.test(event.summary)).length;
      if (prepIndex === -1) {
        return {
          status: unpreparedAttempts > 0 ? 'incorrect' : 'missing',
          score: 0,
          detail: unpreparedAttempts > 0 ? `存在 ${unpreparedAttempts} 次未备即查的深层检查尝试，本项按错误做法计 0 分。` : item.feedback,
          evidenceCodes: ['EX_PREP'],
        };
      }
      const orderScore = contactIndex === -1 || prepIndex < contactIndex ? 15 : 12;
      const unsafeScore = unpreparedAttempts === 0 ? 10 : 0;
      const score = orderScore + unsafeScore;
      return {
        status: score === item.maxScore ? 'achieved' : unpreparedAttempts > 0 ? 'incorrect' : 'partial',
        score,
        detail: unpreparedAttempts > 0
          ? `存在 ${unpreparedAttempts} 次未备即查尝试；手卫生${prepIndex < contactIndex ? '先于' : '晚于'}接触性检查，得 ${score}/${item.maxScore} 分。`
          : `手卫生${prepIndex < contactIndex ? '先于' : '晚于'}接触性检查，得 ${score}/${item.maxScore} 分。`,
        evidenceCodes: ['EX_PREP'],
      };
    }
    case 'EX_FINDINGS': {
      // C-评分补验-01：查体操作点击仅为过程证据，不足以评价结果识别能力；
      // 只有学生观察/推理提交（诊断/摘要/依据锚定本病例查体所见）才支持本项可评价。
      const observationText = `${session.decision?.diagnosis ?? ''} ${session.decision?.summary ?? ''} ${session.decision?.diagnosisBasis ?? ''}`;
      const anchors = ['听诊', '呼吸音', '血氧', '体温', '口咽', '咽部', '血压', '湿啰', '哮鸣', '心率'].filter((term) => observationText.includes(term));
      if (anchors.length === 0) {
        return {
          status: 'not_assessable',
          score: 0,
          detail: '仅有查体操作点击属过程证据，未提交锚定本病例查体所见的观察/推理内容，结果识别能力无法评价，待核实。',
          evidenceCodes: [],
        };
      }
      if (anchors.length >= 2) {
        return { status: 'achieved', score: item.maxScore, detail: `观察/推理提交锚定 ${anchors.length} 项本病例查体所见，结果识别可评价。`, evidenceCodes: ['DECISION'] };
      }
      return { status: 'partial', score: 12, detail: '观察提交锚定 1 项查体所见，结果识别证据有限，得 12/20 分。', evidenceCodes: ['DECISION'] };
    }
    case 'SIG_DANGER_RECOGNITION': {
      const specific = includesAny(decisionText, ['气促', '呼吸困难', '低氧', '血氧', '青紫', '发绀', '喘憋']);
      if (specific) return { status: 'achieved', score: item.maxScore, detail: '识别气促/呼吸困难/低氧/青紫等特异危险信号。', evidenceCodes: ['DECISION'] };
      if (includesAny(decisionText, ['危重', '严重', '不稳定', '精神差'])) return { status: 'partial', score: 15, detail: '仅有一般严重度表述，未点名特异危险信号。', evidenceCodes: ['DECISION'] };
      return { status: 'missing', score: 0, detail: item.feedback, evidenceCodes: ['DECISION'] };
    }
    case 'SIG_CONCLUSION_BASIS': {
      const decision = session.decision;
      if (!decision || !decision.diagnosis.trim() || !decision.summary.trim()) {
        return { status: 'missing', score: 0, detail: item.feedback, evidenceCodes: ['DECISION'] };
      }
      if (decision.diagnosisBasis?.trim()) {
        return { status: 'achieved', score: item.maxScore, detail: '提交病情摘要与判断，依据锚定症状体征。', evidenceCodes: ['DECISION'] };
      }
      return { status: 'partial', score: 20, detail: '已提交病情摘要与判断，但依据未锚定症状体征。', evidenceCodes: ['DECISION'] };
    }
    case 'SIG_PRIORITY': {
      if (includesAny(planText, ['回家观察', '无需处理', '仅观察'])) {
        return { status: 'incorrect', score: 0, detail: '处置包含不安全出院表述，本项按错误做法计 0 分。', evidenceCodes: ['PLAN'] };
      }
      if (includesAny(planText, ['吸氧', '氧疗', '监护', '监测', '生命体征'])) {
        return { status: 'achieved', score: item.maxScore, detail: '首要处置覆盖氧疗与监护等稳定措施。', evidenceCodes: ['PLAN'] };
      }
      if (includesAny(planText, ['评估', '住院', '转诊', '复评', '检查'])) {
        return { status: 'partial', score: 18, detail: '仅安排进一步评估，未覆盖稳定生命体征。', evidenceCodes: ['PLAN'] };
      }
      return { status: 'missing', score: 0, detail: item.feedback, evidenceCodes: ['PLAN'] };
    }
    case 'CM_CONCERN_RESPONSE': {
      // C-评分补验-01：礼貌/共情词命中仅为候选证据，按过程证据部分计分，最终质量待教师复核。
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const hit = includesAny(communicationText, ['理解', '担心', '别紧张', '别担心', '一起', '我会', '辛苦']);
      return hit
        ? { status: 'partial', score: 15, detail: '命中回应顾虑的候选表达，按过程证据部分计分（15/25）；最终沟通质量待教师复核。', evidenceCodes: ['COMMUNICATION'] }
        : { status: 'missing', score: 0, detail: item.feedback, evidenceCodes: ['COMMUNICATION'] };
    }
    case 'CM_PLAIN_EXPLANATION': {
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      if (includesAny(communicationText, ['呼吸', '血氧', '低氧', '危险', '风险'])) {
        return { status: 'achieved', score: item.maxScore, detail: '具体解释了呼吸、血氧等风险。', evidenceCodes: ['COMMUNICATION'] };
      }
      if (includesAny(communicationText, ['病情', '情况', '治疗', '稳定', '感染'])) {
        return { status: 'partial', score: 15, detail: '仅一般性说明病情，未具体解释风险。', evidenceCodes: ['COMMUNICATION'] };
      }
      return { status: 'missing', score: 0, detail: item.feedback, evidenceCodes: ['COMMUNICATION'] };
    }
    case 'CM_UNDERSTANDING_CHECK': {
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const hit = includesAny(communicationText, ['明白吗', '理解吗', '清楚吗', '还有什么问题', '疑问', '听懂']);
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '主动核实家长是否理解。' : item.feedback, evidenceCodes: ['COMMUNICATION'] };
    }
    case 'CM_NEXT_STEPS': {
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const hit = includesAny(communicationText, ['下一步', '接下来', '监测', '复查', '检查', '处理', '吸氧', '用药']);
      return { status: hit ? 'achieved' : 'missing', score: hit ? item.maxScore : 0, detail: hit ? '说明了下一步监测/检查/处理安排。' : item.feedback, evidenceCodes: ['COMMUNICATION'] };
    }
    case 'CM_RESPECTFUL_TONE': {
      // C-评分补验-01：安抚类候选表达仅为过程证据，按部分计分，最终质量待教师复核。
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const hit = includesAny(communicationText, ['陪', '安抚', '放心', '慢慢来', '我们一起']);
      return hit
        ? { status: 'partial', score: 6, detail: '命中安抚性候选表达，按过程证据部分计分（6/10）；最终沟通质量待教师复核。', evidenceCodes: ['COMMUNICATION'] }
        : { status: 'missing', score: 0, detail: item.feedback, evidenceCodes: ['COMMUNICATION'] };
    }
    default:
      return { status: 'not_assessable', score: 0, detail: `量表项 ${item.itemId} 暂无执行器，按无法评价处理。`, evidenceCodes: [] };
  }
}

/** 量表计分报告：总分=计分项之和，总满分=适用计分项满分之和；快照带量表元数据与原始提交。 */
function buildRubricReport(session: SessionState, reportId: string, rubric: RubricDefinition): TrainingReport {
  const abilities: AbilityScores = { history: 0, examination: 0, reasoning: 0, safety: 0, communication: 0, professionalism: 0 };
  const evidence: ScoreEvidence[] = [];
  for (const item of rubric.items) {
    const evaluation = evaluateItem(session, item);
    abilities[item.dimension] += evaluation.score;
    evidence.push({
      code: `RUBRIC_${item.itemId}`,
      label: item.label,
      achieved: evaluation.status === 'achieved',
      score: evaluation.score,
      maxScore: item.maxScore,
      detail: evaluation.detail,
      eventIds: eventIdsFor(session, evaluation.evidenceCodes),
      status: evaluation.status,
    });
  }
  const totalScore = Object.values(abilities).reduce((total, value) => total + value, 0);
  const assessableStatuses = ['achieved', 'partial', 'missing', 'incorrect'] as const;
  const notAssessableCount = rubric.items.filter((_, index) => !assessableStatuses.includes(evidence[index].status as (typeof assessableStatuses)[number])).length;
  const strengths = rubric.items.filter((_, index) => evidence[index].status === 'achieved').slice(0, 3).map((item) => item.label);
  // C-评分补验-01：无法评价/不适用项缺证据不等于待改进，不列为「重点改进」，在推荐语中说明待复核。
  const improvements = rubric.items
    .filter((_, index) => evidence[index].status !== 'achieved' && assessableStatuses.includes(evidence[index].status as (typeof assessableStatuses)[number]))
    .map((item) => item.label);
  const isFocused = rubric.scope === 'focused';
  const recommendationBase = improvements[0]
    ? (isFocused
        ? `本报告按「${rubric.name}」评价，优先补强：${improvements[0]}。`
        : `优先完成“${improvements[0]}”专项补练，再进入同类进阶病例。`)
    : (isFocused
        ? `本专项各评价项均达成，可结合教师反馈进入进阶训练。`
        : `进入${session.caseId === 'peds-wheeze-002' ? '儿童喘息动态评估' : '儿童肺炎动态病情变化'}与治疗后复评进阶病例。`);
  const recommendation = notAssessableCount > 0
    ? `${recommendationBase}另有 ${notAssessableCount} 项因缺少可评价证据记无法评价，待教师复核。`
    : recommendationBase;
  return {
    id: reportId,
    studentDecision: session.decision ? { ...session.decision } : null,
    sessionId: session.id,
    userId: session.userId,
    caseId: session.caseId,
    mode: session.mode,
    totalScore,
    abilities,
    evidence,
    strengths,
    improvements,
    recommendation,
    status: 'ready',
    scoreBasis: 'clinical',
    ...(session.practiceFocus ? { practiceFocus: session.practiceFocus } : {}),
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    evaluationBasis: 'clinical_rubric',
    studentSubmissions: snapshotSubmissions(session),
    createdAt: new Date().toISOString(),
  };
}

function buildSourceReport(session: SessionState, reportId: string, reference?: ReportReference): TrainingReport {
  // 对照来源优先级：会话绑定版本的安全读取（RPC/教师直读）> 进程内缓存快照（本地 knowledge 场景）。
  // 学生会话无绑定版本对照时保持"资料不足"，不用漂移数据补造。
  const source = getCase(session.caseId, session.sourceSnapshotVersion, session.id).sourceFacts;
  const diagnosisReference = reference?.diagnosis ?? source?.sections.diagnosis ?? '';
  const planReference = reference?.plan ?? source?.sections.plan ?? '';
  const checks: Array<{ key: keyof AbilityScores; label: string; max: number; codes: string[]; complete: boolean; detail: string }> = [
    { key: 'history', label: '病史采集记录', max: 25, codes: session.askedIntents.filter((code) => code.startsWith('SOURCE_HX_')), complete: session.askedIntents.some((code) => code.startsWith('SOURCE_HX_')), detail: '是否通过问诊获取该病例实际提供的病史。' },
    { key: 'examination', label: '查体证据记录', max: 25, codes: session.unlockedEvidence.filter((code) => code.startsWith('SOURCE_EX_')), complete: session.unlockedEvidence.some((code) => code.startsWith('SOURCE_EX_')), detail: '是否完成检查准备并获取原病例的查体结果。' },
    { key: 'reasoning', label: '诊断思路提交', max: 20, codes: ['DECISION'], complete: Boolean(session.decision?.diagnosis && session.decision.summary), detail: '记录病情摘要与诊断思路；本项评价任务完成，不判断诊断正确性。' },
    { key: 'safety', label: '处置计划提交', max: 15, codes: ['PLAN'], complete: Boolean(session.plan?.priority && session.plan.detail), detail: '记录优先级与后续计划；临床合理性由教师结合原病例复核。' },
    { key: 'communication', label: '家长沟通记录', max: 10, codes: ['COMMUNICATION'], complete: Boolean(session.communication?.trim()), detail: '是否提交向患儿及家长说明病情、风险和后续安排的沟通原文。' },
    { key: 'professionalism', label: '检查准备', max: 5, codes: ['EX_PREP'], complete: session.unlockedEvidence.includes('EX_PREP'), detail: '是否完成手卫生与检查说明。' },
  ];
  const abilities = Object.fromEntries(checks.map((check) => [check.key, check.complete ? check.max : 0])) as unknown as AbilityScores;
  const evidence: ScoreEvidence[] = checks.map((check) => ({ code: `SOURCE_PROCESS_${check.key}`, label: check.label, achieved: check.complete, score: check.complete ? check.max : 0, maxScore: check.max, detail: check.detail, eventIds: eventIdsFor(session, check.codes) }));
  if (diagnosisReference) evidence.push({ code: 'SOURCE_DIAGNOSIS_REFERENCE', label: '原病例诊断对照', achieved: true, score: 0, maxScore: 0, detail: diagnosisReference, eventIds: [] });
  if (planReference) evidence.push({ code: 'SOURCE_PLAN_REFERENCE', label: '原病例诊疗经过对照', achieved: true, score: 0, maxScore: 0, detail: planReference, eventIds: [] });
  return { id: reportId, sessionId: session.id, userId: session.userId, caseId: session.caseId, mode: session.mode,
    studentDecision: session.decision ? { ...session.decision } : null,
    caseTitle: resolveCaseTitleForReport(session),
    totalScore: Object.values(abilities).reduce((sum, score) => sum + score, 0), abilities, evidence,
    strengths: checks.filter((check) => check.complete).map((check) => check.label), improvements: checks.filter((check) => !check.complete).map((check) => check.label),
    recommendation: source ? '对照原病例诊断与诊疗经过，解释自己的证据与判断；请教师复核诊断及处置。' : '本病种暂无独立原始病历，请整理自己的问诊与诊疗思路，待补充资料后再对照复盘。',
    scoreBasis: 'process',
    ...(session.practiceFocus ? { practiceFocus: session.practiceFocus } : {}),
    evaluationBasis: 'process_completion',
    studentSubmissions: snapshotSubmissions(session),
    status: 'pending_review', createdAt: new Date().toISOString() };
}

/** 报告病例显示标题（完成后释放病种名）：教师病例用真实病种名，演示病例用症状标题。
 *  会话绑定版本的教学事实缺失（资料不足）时降级用会话 caseOptions 的中性来源名。 */
function resolveCaseTitleForReport(session: SessionState): string | undefined {
  if (!session.caseId.startsWith('teacher-')) return undefined;
  const facts = getCase(session.caseId, session.sourceSnapshotVersion, session.id).sourceFacts;
  if (facts) return facts.caseId.replace(/^teacher-/, '');
  return session.caseOptions?.sourceName;
}
