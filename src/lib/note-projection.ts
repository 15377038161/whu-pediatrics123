import type { AppRole } from '@/domain/agent';
import type { NoteReviewResult, NoteSubmissionRecord } from '@/domain/medical-note';

/**
 * 批次6·病历提交的角色投影（与 report/session 投影同范式，纯函数不落库）。
 *
 * 学生：返回本人提交的原文与 AI 意见（自己的反馈），但不返回 caseId/caseVersion——
 * 内部 caseId 形如 teacher-<病名>，含病种名，病历书写模块仍遵守防透题边界
 * （REPORT_ANSWER_BOUNDARY：标准病历整篇不进学生响应/页面源码）。
 * 教师：全字段（含病例绑定与 AI 意见），行级可见性由 RLS（app_can_view_student +
 * class_period 时间锚点）与教师路由鉴权共同保证。
 */

export interface NoteView {
  id: string;
  userId: string;
  sessionId: string;
  /** 病例绑定（teacher-<病名>）：仅教师可见 */
  caseId?: string;
  caseVersion?: string | null;
  templateVersion: string;
  content: Record<string, string>;
  submittedAt: string;
  aiReviewStatus: 'pending' | 'ready' | 'failed';
  aiReview: NoteReviewResult | null;
  aiPromptVersion: string | null;
  createdAt: string;
  /** 学生侧：本人已提交版本序号（1=首次提交，按 submittedAt 升序） */
  revisionIndex?: number;
}

export function projectNoteForRole(record: NoteSubmissionRecord, role: AppRole, revisionIndex?: number): NoteView {  if (role === 'teacher') {
    return {
      id: record.id,
      userId: record.userId,
      sessionId: record.sessionId,
      caseId: record.caseId,
      caseVersion: record.caseVersion,
      templateVersion: record.templateVersion,
      content: record.content,
      submittedAt: record.submittedAt,
      aiReviewStatus: record.aiReviewStatus,
      aiReview: record.aiReview,
      aiPromptVersion: record.aiPromptVersion,
      createdAt: record.createdAt,
      ...(revisionIndex === undefined ? {} : { revisionIndex }),
    };
  }
  return {
    id: record.id,
    userId: record.userId,
    sessionId: record.sessionId,
    templateVersion: record.templateVersion,
    content: record.content,
    submittedAt: record.submittedAt,
    aiReviewStatus: record.aiReviewStatus,
    aiReview: record.aiReview,
    aiPromptVersion: record.aiPromptVersion,
    createdAt: record.createdAt,
    ...(revisionIndex === undefined ? {} : { revisionIndex }),
  };
}

/** 提交列表按提交时间升序的版本序号映射（1=首次提交；与 projectNoteForRole 的 revisionIndex 配套）。 */
export function noteRevisionIndexMap(records: NoteSubmissionRecord[]): Map<string, number> {
  const index = new Map<string, number>();
  [...records]
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
    .forEach((record, position) => index.set(record.id, position + 1));
  return index;
}
