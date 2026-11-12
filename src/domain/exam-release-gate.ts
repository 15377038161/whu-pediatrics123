import { stageReached, type Stage } from './agent';
import type { TeachingExam } from './teaching-package';

export interface ExamReleaseBlock {
  allowed: false;
  kind: 'stage' | 'applicability';
  reason: string;
}

/**
 * Author-side release flags are authoritative for the current initial teaching snapshot.
 * Conditional exams with an explicit fixed scenario may run; later snapshots and explicit
 * no-release rows never leak a result, evidence code or measurement into the initial exam.
 */
export function teachingExamReleaseBlock(exam: TeachingExam | undefined, stage: Stage): ExamReleaseBlock | null {
  if (!exam) return null;
  const parameters = exam.fixedParameters ?? {};
  const reason = typeof parameters.reason === 'string' && parameters.reason.trim()
    ? parameters.reason.trim()
    : exam.applicability?.reason ?? '本例当前条件不满足，未释放查体结果。';
  if (parameters.availableFromStage === 'after-successful-exam' && !stageReached(stage, 'exam')) {
    return { allowed: false, kind: 'stage', reason: '该检查需在查体阶段完成准备与正确操作后释放。' };
  }
  if (exam.applicability?.status === 'not_applicable' || parameters.applicable === false) {
    return { allowed: false, kind: 'applicability', reason };
  }
  if (typeof parameters.currentCaseCondition === 'string' && parameters.currentCaseCondition.trim()) {
    const condition = parameters.currentCaseCondition.trim();
    return {
      allowed: false,
      kind: 'applicability',
      reason: condition === 'not-satisfied'
        ? reason
        : `该结果属于“${condition}”后续场景，当前初始查体不释放，也不覆盖初始记录。`,
    };
  }
  if (parameters.releasePatientResult === false || parameters.releaseEvidence === false) {
    return { allowed: false, kind: 'applicability', reason };
  }
  return null;
}
