import type { AbilityScores, ScoreEvidence, SessionState, TrainingReport } from '@/domain/agent';

function includesAny(value: string, terms: string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function eventIdsFor(session: SessionState, codes: string[]): string[] {
  return session.events.filter((event) => event.evidenceCodes.some((code) => codes.includes(code))).map((event) => event.id);
}

export function buildReport(session: SessionState, reportId = crypto.randomUUID()): TrainingReport {
  const asked = new Set(session.askedIntents);
  const evidence = new Set(session.unlockedEvidence);
  const decisionText = `${session.decision?.diagnosis ?? ''} ${session.decision?.summary ?? ''} ${session.decision?.differentials ?? ''}`;
  const planText = `${session.plan?.priority ?? ''} ${session.plan?.detail ?? ''}`;
  const communicationText = session.communication ?? '';

  const historyScore = Math.min(25,
    (asked.has('danger') ? 8 : 0)
      + (asked.has('onset') ? 4 : 0)
      + (asked.has('fever') ? 4 : 0)
      + (asked.has('general') ? 4 : 0)
      + (asked.has('exposure') ? 3 : 0)
      + (asked.has('vaccination') || asked.has('birth') || asked.has('allergy') ? 2 : 0));

  const examinationScore = Math.min(25,
    (evidence.has('EX_PREP') ? 4 : 0)
      + (evidence.has('EX_RESP') ? 10 : 0)
      + (evidence.has('EX_SPO2') ? 7 : 0)
      + ([...evidence].filter((code) => ['EX_TEMP', 'EX_MOUTH', 'EX_BP'].includes(code)).length > 0 ? 4 : 0));

  const pneumoniaIdentified = includesAny(decisionText, ['肺炎', '下呼吸道感染']);
  const lowOxygenIdentified = includesAny(decisionText, ['低氧', '血氧', '呼吸困难', '气促', '危险']);
  const differentialProvided = (session.decision?.differentials.trim().length ?? 0) >= 6;
  const reasoningScore = (pneumoniaIdentified ? 10 : 0) + (lowOxygenIdentified ? 6 : 0) + (differentialProvided ? 4 : 0);

  const safePriority = includesAny(planText, ['吸氧', '氧疗', '监测', '生命体征']);
  const furtherAssessment = includesAny(planText, ['评估', '住院', '转诊', '复评', '检查']);
  const avoidsUnsafeDischarge = !includesAny(planText, ['回家观察', '无需处理', '仅观察']);
  const safetyScore = (safePriority ? 8 : 0) + (furtherAssessment ? 4 : 0) + (avoidsUnsafeDischarge ? 3 : 0);

  const empathy = includesAny(communicationText, ['理解', '担心', '别紧张', '一起', '我会']);
  const explainsRisk = includesAny(communicationText, ['呼吸', '血氧', '危险', '风险']);
  const nextStep = includesAny(communicationText, ['下一步', '先', '监测', '检查', '处理']);
  const communicationScore = (empathy ? 3 : 0) + (explainsRisk ? 4 : 0) + (nextStep ? 3 : 0);

  const comfortUsed = session.events.some((event) => event.summary.includes('安抚'));
  const professionalScore = (evidence.has('EX_PREP') ? 2 : 0) + (comfortUsed ? 2 : 0) + (session.events.length >= 5 ? 1 : 0);

  const abilities: AbilityScores = {
    history: historyScore,
    examination: examinationScore,
    reasoning: reasoningScore,
    safety: safetyScore,
    communication: communicationScore,
    professionalism: professionalScore,
  };

  const scoreEvidence: ScoreEvidence[] = [
    {
      code: 'RUBRIC_HISTORY_DANGER', label: '呼吸危险信号问诊', achieved: asked.has('danger'),
      score: asked.has('danger') ? 8 : 0, maxScore: 8,
      detail: asked.has('danger') ? '主动询问气促、喘憋或青紫，并形成可回放记录。' : '未形成呼吸困难、青紫等危险信号的有效追问证据。',
      eventIds: eventIdsFor(session, ['HX_DANGER']),
    },
    {
      code: 'RUBRIC_EXAM_RESP', label: '肺部重点查体', achieved: evidence.has('EX_RESP'),
      score: evidence.has('EX_RESP') ? 10 : 0, maxScore: 10,
      detail: evidence.has('EX_RESP') ? '完成手卫生后使用听诊器检查胸部并获取局灶体征。' : '未通过正确器材、部位和准备动作获得肺部听诊证据。',
      eventIds: eventIdsFor(session, ['EX_RESP']),
    },
    {
      code: 'RUBRIC_EXAM_OXYGEN', label: '低氧识别', achieved: evidence.has('EX_SPO2'),
      score: evidence.has('EX_SPO2') ? 7 : 0, maxScore: 7,
      detail: evidence.has('EX_SPO2') ? '正确使用血氧仪获取静息血氧结果。' : '未完成血氧监测，低氧判断缺少直接证据。',
      eventIds: eventIdsFor(session, ['EX_SPO2']),
    },
    {
      code: 'RUBRIC_REASONING', label: '诊断与证据整合', achieved: pneumoniaIdentified && lowOxygenIdentified,
      score: reasoningScore, maxScore: 20,
      detail: pneumoniaIdentified && lowOxygenIdentified ? '诊断能够同时覆盖肺部感染与低氧风险。' : '诊断或病情摘要尚未把肺部证据和低氧风险完整串联。',
      eventIds: eventIdsFor(session, ['DECISION']),
    },
    {
      code: 'RUBRIC_SAFETY', label: '患者安全与处置优先级', achieved: safePriority && furtherAssessment,
      score: safetyScore, maxScore: 15,
      detail: safePriority && furtherAssessment ? '优先监测与氧疗，并安排进一步评估。' : '处置未同时覆盖生命体征稳定和进一步评估。',
      eventIds: eventIdsFor(session, ['PLAN']),
    },
    {
      code: 'RUBRIC_COMMUNICATION', label: '家长沟通', achieved: empathy && explainsRisk && nextStep,
      score: communicationScore, maxScore: 10,
      detail: empathy && explainsRisk && nextStep ? '回应家长情绪，以通俗语言说明风险和后续步骤。' : '沟通中仍缺少共情、风险解释或明确的下一步。',
      eventIds: eventIdsFor(session, ['COMMUNICATION']),
    },
  ];

  const totalScore = Object.values(abilities).reduce((total, value) => total + value, 0);
  const strengths = scoreEvidence.filter((item) => item.achieved).slice(0, 3).map((item) => item.label);
  const improvements = scoreEvidence.filter((item) => !item.achieved).map((item) => item.label);
  const recommendation = improvements[0]
    ? `优先完成“${improvements[0]}”专项补练，再进入同类进阶病例。`
    : '进入儿童肺炎动态病情变化与治疗后复评进阶病例。';

  return {
    id: reportId,
    sessionId: session.id,
    userId: session.userId,
    caseId: session.caseId,
    mode: session.mode,
    totalScore,
    abilities,
    evidence: scoreEvidence,
    strengths,
    improvements,
    recommendation,
    status: 'ready',
    createdAt: new Date().toISOString(),
  };
}
