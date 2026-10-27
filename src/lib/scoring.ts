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
    // C-观察与报告-04：查体专项观察/解释提交原文随快照冻结（历史报告无此字段按未提交展示）。
    examObservation: session.examObservation ? { ...session.examObservation } : null,
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

/** 否定守卫（C-评分补验-02）：关键词命中处于否定语境（词前 3 字内含否定字，
 *  如「不需要复查」「未闻及啰音」）时不作为肯定证据，可验证能力项记未达成/与事实相反。 */
function negatedMatch(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    let index = text.indexOf(term);
    while (index >= 0) {
      if (/[不未无没暂]/.test(text.slice(Math.max(0, index - 3), index))) return true;
      index = text.indexOf(term, index + term.length);
    }
    return false;
  });
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

/** 沟通项不可评价（C-评分补验-03）：共情/解释/语气等质量项与表述真实性（长距离否定/
 *  前后矛盾表述不可靠区分）均无法机器可靠评价，候选/过程反馈仅写入 detail（原文保留在报告
 *  studentSubmissions 快照），本项记无法评价、不计能力分、不进适用满分——不设打折分或新权重，
 *  待教师结合提交原文复核。 */
function communicationItemNotAssessable(candidateNote: string): ItemEvaluation {
  return {
    status: 'not_assessable',
    score: 0,
    detail: `${candidateNote}；本项无法机器可靠评价，记无法评价（0 分）、不计入适用满分，待教师结合提交原文复核。`,
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
      // C-评分补验-03（量表 v4）：沟通项整项按不可评价处理——下一步表述真实性同样无法
      // 机器可靠区分（长距离否定/前后矛盾表述可满分），不再给「可验证下一步」3 分伪装能力分；
      // 全部表述仅记过程反馈（写入 detail，原文保留在提交快照），整项排除出计分与适用满分，
      // 待教师结合提交原文复核。
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const notes: string[] = [];
      const nextStepTerms = ['下一步', '接下来', '监测', '检查', '处理', '吸氧', '复查'];
      const nextStep = includesAny(communicationText, nextStepTerms) && !negatedMatch(communicationText, nextStepTerms);
      notes.push(nextStep ? '过程反馈：含明确下一步安排表述（非能力分，真实性待教师复核）' : '过程反馈：未见明确下一步安排表述');
      const empathyCandidate = includesAny(communicationText, ['理解', '担心', '别紧张', '别担心', '一起', '我会']);
      const riskCandidate = includesAny(communicationText, ['呼吸', '血氧', '危险', '风险']);
      if (empathyCandidate) notes.push('含共情表述候选（质量待教师复核）');
      if (riskCandidate) notes.push('含风险解释表述候选（质量待教师复核）');
      return communicationItemNotAssessable(notes.join('；'));
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
      // C-观察与报告-04（量表 v5）：观察/解释提交通道已开放（SUBMIT_EXAM_OBSERVATION，服务端
      // 校验归属/版本/已解锁查体证据后保存），但结果识别仍无专业审核判据——机器无法可靠判定
      // 学生观察与病例真实所见是否一致（表述真实性/长距离否定不可区分），本项恒记无法评价（0 分）、
      // 不进适用满分；提交原文冻结在报告快照并记过程反馈（EX_OBSERVATION 事件可回放），
      // 待教师结合查体记录与提交原文复核。不设关键词命中计分或打折分支路。
      if (session.examObservation) {
        return {
          status: 'not_assessable',
          score: 0,
          detail: `已收到查体观察/解释提交（${session.examObservation.interpretation ? '含观察解释' : '未见观察解释'}，原文保留在提交快照）：结果识别缺少专业审核判据，本项记无法评价不计分，待教师结合查体记录与提交原文复核。`,
          evidenceCodes: ['EX_OBSERVATION'],
        };
      }
      return {
        status: 'not_assessable',
        score: 0,
        detail: '查体专项未提交观察/解释（提交通道已开放，服务端校验已解锁查体证据后保存），结果识别缺少可评价提交与专业审核判据，本项记无法评价不计分，待教师结合查体记录复核。',
        evidenceCodes: [],
      };
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
      // C-评分补验-02：回应顾虑属沟通质量项，无法机器可靠评价——候选词命中仅记候选证据
      // （原文保留在 studentSubmissions 快照），本项恒记无法评价（0 分），不设打折分或新权重。
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const concernHit = includesAny(communicationText, ['理解', '担心', '别紧张', '别担心', '一起', '我会', '辛苦']);
      return communicationItemNotAssessable(concernHit ? '命中回应顾虑候选表达（理解/担心等），仅作候选证据' : '未见回应顾虑候选表达');
    }
    case 'CM_PLAIN_EXPLANATION': {
      // C-评分补验-02：解释通俗性属沟通质量项，无法机器可靠评价——风险/病情表述命中仅记
      // 候选证据，本项恒记无法评价（0 分），不再关键词命中即满分。
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const explanationHit = includesAny(communicationText, ['呼吸', '血氧', '低氧', '危险', '风险', '病情', '情况', '治疗', '稳定', '感染']);
      return communicationItemNotAssessable(explanationHit ? '命中风险/病情解释候选表述，仅作候选证据' : '未见解释候选表述');
    }
    case 'CM_UNDERSTANDING_CHECK': {
      // C-评分补验-03（量表 v4）：核实理解表述无法机器可靠区分真实核实与模板化/长距离否定/
      // 前后矛盾表述（句首肯定句尾否定可满分），取消词命中计分——命中仅记候选/过程反馈，
      // 本项恒记无法评价（0 分）、不进适用满分，待教师结合提交原文复核。
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const checkTerms = ['明白吗', '理解吗', '清楚吗', '还有什么问题', '疑问', '听懂'];
      const checkHit = includesAny(communicationText, checkTerms);
      return communicationItemNotAssessable(checkHit ? '过程反馈：含核实理解表述（明白吗/还有什么问题等）候选，真实性待教师复核' : '未见核实理解表述');
    }
    case 'CM_NEXT_STEPS': {
      // C-评分补验-03（量表 v4）：后续安排表述同上无法机器可靠评价（长距离否定/前后矛盾可满分），
      // 取消词命中计分——命中仅记候选/过程反馈，本项恒记无法评价（0 分）、不进适用满分，待教师复核。
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const stepTerms = ['下一步', '接下来', '监测', '复查', '检查', '处理', '吸氧', '用药'];
      const stepHit = includesAny(communicationText, stepTerms);
      return communicationItemNotAssessable(stepHit ? '过程反馈：含下一步安排表述（监测/检查/处理等）候选，真实性待教师复核' : '未见下一步安排表述');
    }
    case 'CM_RESPECTFUL_TONE': {
      // C-评分补验-02：语气尊重性属沟通质量项，无法机器可靠评价——安抚候选表达仅记候选证据，
      // 本项恒记无法评价（0 分），不设打折分或新权重。
      if (!hasCaseContent(communicationText)) return communicationNotAssessable();
      const toneHit = includesAny(communicationText, ['陪', '安抚', '放心', '慢慢来', '我们一起']);
      return communicationItemNotAssessable(toneHit ? '命中安抚性候选表达，仅作候选证据' : '未见安抚候选表达');
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
  const isAssessable = (status: RubricItemStatus | undefined): boolean => status !== undefined && assessableStatuses.includes(status as (typeof assessableStatuses)[number]);
  const notAssessableCount = rubric.items.filter((_, index) => !isAssessable(evidence[index].status)).length;
  // C-观察与报告-04：可评价满分按适用计分项满分之和持久化（与前端展示同源）；
  // 全部计分项均无法评价（not_assessable/not_applicable）时报告记「未评分」——总分 0 不代表
  // 能力 0 分，不得进入平均分/最好成绩等趋势统计；原因随快照持久化，旧报告不重算。
  const assessableMaxScore = rubric.items.reduce((sum, item, index) => sum + (isAssessable(evidence[index].status) ? item.maxScore : 0), 0);
  const unscored = rubric.items.every((_, index) => !isAssessable(evidence[index].status));
  const unscoredReason = unscored
    ? `「${rubric.name}」全部评分项均无法机器可靠评价（缺少可评价判据），本报告记「未评分」，总分 0 不代表能力 0 分，不计入平均分/最好成绩等趋势统计，待教师结合提交原文复核。`
    : undefined;
  const strengths = rubric.items.filter((_, index) => evidence[index].status === 'achieved').slice(0, 3).map((item) => item.label);
  // C-评分补验-01：无法评价/不适用项缺证据不等于待改进，不列为「重点改进」，在推荐语中说明待复核。
  const improvements = rubric.items
    .filter((_, index) => evidence[index].status !== 'achieved' && assessableStatuses.includes(evidence[index].status as (typeof assessableStatuses)[number]))
    .map((item) => item.label);
  const isFocused = rubric.scope === 'focused';
  // C-评分补验-02：improvements 为空不等于「各项均达成」——若全部分项均无可评价证据
  //（achieved 项数为 0），如实说明无可评价项得分，不展示「各项均达成」或满分达成。
  const achievedCount = rubric.items.filter((_, index) => evidence[index].status === 'achieved').length;
  const allNotAssessable = achievedCount === 0 && improvements.length === 0;
  const recommendationBase = improvements[0]
    ? (isFocused
        ? `本报告按「${rubric.name}」评价，优先补强：${improvements[0]}。`
        : `优先完成“${improvements[0]}”专项补练，再进入同类进阶病例。`)
    : allNotAssessable
      ? `本报告各项均缺少可评价证据，未计入能力得分，待教师复核。`
      : (isFocused
          ? `本专项已评价项均达成，可结合教师反馈进入进阶训练。`
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
    sourceSnapshotVersion: session.sourceSnapshotVersion ?? null,
    evaluationBasis: 'clinical_rubric',
    assessableMaxScore,
    ...(unscored ? { unscored, unscoredReason } : {}),
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
  let checks: Array<{ key: keyof AbilityScores; label: string; max: number; codes: string[]; complete: boolean; detail: string }> = [
    { key: 'history', label: '病史采集记录', max: 25, codes: session.askedIntents.filter((code) => code.startsWith('SOURCE_HX_')), complete: session.askedIntents.some((code) => code.startsWith('SOURCE_HX_')), detail: '是否通过问诊获取该病例实际提供的病史。' },
    { key: 'examination', label: '查体证据记录', max: 25, codes: session.unlockedEvidence.filter((code) => code.startsWith('SOURCE_EX_')), complete: session.unlockedEvidence.some((code) => code.startsWith('SOURCE_EX_')), detail: '是否完成检查准备并获取原病例的查体结果。' },
    { key: 'reasoning', label: '诊断思路提交', max: 20, codes: ['DECISION'], complete: Boolean(session.decision?.diagnosis && session.decision.summary), detail: '记录病情摘要与诊断思路；本项评价任务完成，不判断诊断正确性。' },
    { key: 'safety', label: '处置计划提交', max: 15, codes: ['PLAN'], complete: Boolean(session.plan?.priority && session.plan.detail), detail: '记录优先级与后续计划；临床合理性由教师结合原病例复核。' },
    { key: 'communication', label: '家长沟通记录', max: 10, codes: ['COMMUNICATION'], complete: Boolean(session.communication?.trim()), detail: '是否提交向患儿及家长说明病情、风险和后续安排的沟通原文。' },
    { key: 'professionalism', label: '检查准备', max: 5, codes: ['EX_PREP'], complete: session.unlockedEvidence.includes('EX_PREP'), detail: '是否完成手卫生与检查说明。' },
  ];
  const focus = session.mode === 'practice' ? session.practiceFocus : null;
  const focusedDimensions: Record<NonNullable<SessionState['practiceFocus']>, Array<keyof AbilityScores>> = {
    history: ['history'], exam: ['examination', 'professionalism'],
    safety: ['reasoning', 'safety'], communication: ['communication'],
  };
  if (focus) checks = checks.filter(check => focusedDimensions[focus].includes(check.key));
  // 沟通专项只保留提交，不能用提交或关键词代替沟通质量评分。
  const unscored = focus === 'communication';
  const abilities: AbilityScores = { history: 0, examination: 0, reasoning: 0, safety: 0, communication: 0, professionalism: 0 };
  for (const check of checks) abilities[check.key] = !unscored && check.complete ? check.max : 0;
  const evidence: ScoreEvidence[] = checks.map((check) => ({ code: `SOURCE_PROCESS_${check.key}`, label: check.label,
    achieved: !unscored && check.complete, score: abilities[check.key], maxScore: unscored ? 0 : check.max,
    ...(unscored ? { status: 'not_assessable' as const } : {}),
    detail: unscored ? '沟通提交原文已保留；缺少专业审核的沟通质量判据，无法自动评价，待教师复核。' : check.detail,
    eventIds: eventIdsFor(session, check.codes) }));
  if (focus === 'exam') evidence.push({code:'SOURCE_EX_FINDINGS',label:'查体结果识别',achieved:false,score:0,maxScore:0,status:'not_assessable',
    detail:'观察与解释提交及关联证据保留在报告；缺少专业审核的结果识别判据，待教师复核。',eventIds:eventIdsFor(session,['EX_OBSERVATION'])});
  if (diagnosisReference) evidence.push({ code: 'SOURCE_DIAGNOSIS_REFERENCE', label: '原病例诊断对照', achieved: true, score: 0, maxScore: 0, detail: diagnosisReference, eventIds: [] });
  if (planReference) evidence.push({ code: 'SOURCE_PLAN_REFERENCE', label: '原病例诊疗经过对照', achieved: true, score: 0, maxScore: 0, detail: planReference, eventIds: [] });
  return { id: reportId, sessionId: session.id, userId: session.userId, caseId: session.caseId, mode: session.mode,
    sourceSnapshotVersion: session.sourceSnapshotVersion ?? null,
    studentDecision: session.decision ? { ...session.decision } : null,
    caseTitle: resolveCaseTitleForReport(session),
    totalScore: Object.values(abilities).reduce((sum, score) => sum + score, 0), abilities, evidence,
    evaluatedAbilities: checks.map(check => check.key),
    strengths: unscored ? (session.communication?.trim() ? ['已保留沟通提交，质量待教师复核。'] : []) : checks.filter((check) => check.complete).map((check) => check.label),
    improvements: unscored ? [] : checks.filter((check) => !check.complete).map((check) => check.label),
    recommendation: source ? '对照原病例诊断与诊疗经过，解释自己的证据与判断；请教师复核诊断及处置。' : '本病种暂无独立原始病历，请整理自己的问诊与诊疗思路，待补充资料后再对照复盘。',
    scoreBasis: 'process',
    ...(session.practiceFocus ? { practiceFocus: session.practiceFocus } : {}),
    evaluationBasis: 'process_completion',
    // C-观察与报告-04：过程分报告按六环节满分之和持久化可评价满分（与前端展示同源）。
    assessableMaxScore: unscored ? 0 : checks.reduce((sum, check) => sum + check.max, 0),
    ...(unscored ? {unscored:true,unscoredReason:'缺少专业审核的沟通质量判据，提交原文保留待教师复核。'} : {}),
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
