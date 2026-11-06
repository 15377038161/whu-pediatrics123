import type { CaseAnalysisBlock, SessionState, TrainingReport } from '@/domain/agent';
import type { CaseAnswerKeyRecord } from '@/domain/case-analysis';
import type { DiagnosisAnswerInput } from '@/domain/diagnosis-answer';
import {
  generateCaseAnswerKey,
  gradeCaseAnalysis,
  readCaseAnalysisCase,
  type CaseAnalysisCaseInput,
  type CaseAnalysisGradeResult,
} from '@/lib/case-analysis-ai';
import { getCaseAnswerKey } from '@/lib/case-answer-key-store';
import { isCaseAnalysisCase, isCaseAnalysisEnabled } from '@/lib/case-analysis-config';

const DISCLAIMER = '病例分析试点分：不影响主分数；按 AI 从原件生成的得分点判分，仅作教学反馈。';

export interface CaseAnalysisReportDeps {
  getKey?: (caseId: string, version: string) => Promise<CaseAnswerKeyRecord | null>;
  generateKey?: typeof generateCaseAnswerKey;
  grade?: (key: NonNullable<CaseAnswerKeyRecord['key']>, submission: DiagnosisAnswerInput) => Promise<CaseAnalysisGradeResult>;
  readCase?: (caseId: string, version?: string | null) => CaseAnalysisCaseInput;
}

function notAssessable(reason: string): CaseAnalysisBlock {
  return { status: 'not_assessable', reason, disclaimer: DISCLAIMER };
}

function toSubmission(session: SessionState): DiagnosisAnswerInput {
  return {
    primary: session.decision?.diagnosis ?? '',
    secondary: session.decision?.secondaryDiagnosis ?? [],
    evidence: session.decision?.diagnosisBasis ?? '',
    differentials: session.decision?.differentials ?? '',
    management: [session.plan?.priority, session.plan?.detail].filter(Boolean).join('；'),
  };
}

/**
 * 给报告附加病例分析影子分：
 * - 开关关闭或非灰度病例时，原报告一个字节都不改；
 * - 未提交的诊断或治疗字段以空文本进入逐点判分，由确定性执行器判零；
 * - 标答缺失/表未迁移/AI 失败时只附加 not_assessable 说明，绝不让报告生成失败；
 * - 分数只写入 caseAnalysis，不修改 report.totalScore 与旧统计。
 */
export async function attachCaseAnalysis(
  report: TrainingReport,
  session: SessionState,
  deps: CaseAnalysisReportDeps = {},
): Promise<TrainingReport> {
  if (!isCaseAnalysisEnabled() || !isCaseAnalysisCase(session.caseId)) return report;

  let input: CaseAnalysisCaseInput;
  try {
    input = (deps.readCase ?? readCaseAnalysisCase)(session.caseId, session.sourceSnapshotVersion ?? null);
  } catch {
    report.caseAnalysis = notAssessable('CASE_NOT_FOUND');
    return report;
  }

  let record: CaseAnswerKeyRecord | null;
  try {
    record = await (deps.getKey ?? getCaseAnswerKey)(input.caseId, input.version);
  } catch {
    report.caseAnalysis = notAssessable('STORE_UNAVAILABLE');
    return report;
  }
  if (!record || record.status !== 'auto' || !record.key) {
    report.caseAnalysis = notAssessable(record?.reason ?? 'KEY_NOT_READY');
    return report;
  }

  let result: CaseAnalysisGradeResult;
  try {
    result = await (deps.grade ?? ((key, submission) => gradeCaseAnalysis(key, submission)))(record.key, toSubmission(session));
  } catch {
    report.caseAnalysis = notAssessable('GRADE_FAILED');
    return report;
  }

  report.caseAnalysis = {
    status: 'scored',
    percent: result.percent,
    rawScore: result.grade.totalScore,
    rawMaxScore: result.grade.maxScore,
    model: result.model,
    promptVersion: result.promptVersion,
    keyVersion: record.version,
    usedFallback: result.usedFallback,
    points: result.grade.points,
    missingPoints: result.grade.missingPoints,
    disclaimer: DISCLAIMER,
  };
  return report;
}