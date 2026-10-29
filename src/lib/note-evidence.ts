import type { TrainingReport } from '@/domain/agent';

/**
 * 批次6·「本例已获得证据」摘要（AI 审阅输入，纯函数）。
 *
 * 依据 CASE_WORKFLOW_AND_NOTE_WRITING.md 第4节第3条：
 * AI 建议必须引用学生已写内容或本例可获得的证据，区分漏采与漏写，不编造检查结果或临床结论。
 * 调用方必须传入学生版投影后的报告（projectReportForRole(report, 'student')）——
 * 教师版报告含 SOURCE_DIAGNOSIS_REFERENCE / SOURCE_PLAN_REFERENCE 答案参照，不得进入学生可见的 AI 输入。
 */

export interface ReleasedEvidenceSummary {
  /** 证据项（学生版投影后，不含答案参照）：label/detail 为报告口径文案。 */
  evidence: Array<{ label: string; detail: string; status: string }>;
  /** 采集覆盖：问诊/查体/检查三类可用与已采集数量（不含未请求检查的伪遗漏）。 */
  collection: Array<{ area: 'history' | 'exam' | 'tests'; label: string; available: number; collected: number }>;
  /** 学生最终提交（训练会话内已确认的内容，作为一致性对照）。 */
  submissions: {
    diagnosis: string | null;
    summary: string | null;
    diagnosisBasis: string | null;
    differentials: string | null;
    planPriority: string | null;
    planDetail: string | null;
    communication: string | null;
    historySummary: string | null;
    examFindings: string | null;
    examInterpretation: string | null;
  };
  strengths: string[];
  improvements: string[];
}

export function buildReleasedEvidenceSummary(report: TrainingReport): ReleasedEvidenceSummary {
  return {
    evidence: (report.evidence ?? []).map((item) => ({
      label: item.label,
      detail: item.detail,
      status: item.status ?? (item.achieved ? 'achieved' : 'missing'),
    })),
    collection: (report.collectionReview ?? []).map((item) => ({
      area: item.area,
      label: item.label,
      available: item.available,
      collected: item.collected,
    })),
    submissions: {
      diagnosis: report.studentSubmissions?.decision?.diagnosis ?? report.studentDecision?.diagnosis ?? null,
      summary: report.studentSubmissions?.decision?.summary ?? report.studentDecision?.summary ?? null,
      diagnosisBasis: report.studentSubmissions?.decision?.diagnosisBasis ?? report.studentDecision?.diagnosisBasis ?? null,
      differentials: report.studentSubmissions?.decision?.differentials ?? report.studentDecision?.differentials ?? null,
      planPriority: report.studentSubmissions?.plan?.priority ?? null,
      planDetail: report.studentSubmissions?.plan?.detail ?? null,
      communication: report.studentSubmissions?.communication ?? null,
      historySummary: report.studentSubmissions?.historySummary ?? null,
      examFindings: report.studentSubmissions?.examObservation?.findings ?? null,
      examInterpretation: report.studentSubmissions?.examObservation?.interpretation ?? null,
    },
    strengths: [...(report.strengths ?? [])],
    improvements: [...(report.improvements ?? [])],
  };
}
