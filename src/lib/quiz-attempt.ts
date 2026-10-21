/**
 * 学生题库练习仓储（阶段 F / AI 题库闭环）：
 * - 可见题集/批次详情/作答判分/批次列表全部经 SECURITY DEFINER 受控 RPC：
 *   作答前不返回 answer/explanation（首次提交后释放），归属与幂等判分在 RPC 内强制；
 * - 页面投影类型与 RPC jsonb 字段一一对应（camelCase），不在此层引入第二套命名。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface QuizBankStudentSummary {
  bankId: string;
  title: string;
  description: string;
  topic: string;
  itemCount: number;
  version: number;
  platformWide: boolean;
  completedAttempts: number;
  bestCorrectRate: number | null;
  inProgressAttemptId: string | null;
  updatedAt: string;
}

export interface QuizAttemptItemView {
  itemId: string;
  stem: string;
  options: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  knowledgePoint: string | null;
  answered: boolean;
  submittedAnswer: string | null;
  isCorrect: boolean | null;
  answer: string | null;
  explanation: string | null;
}

export interface QuizAttemptStateView {
  attemptId: string;
  bankId: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  startedAt: string;
  completedAt: string | null;
  version: number;
  itemCount: number;
  items: QuizAttemptItemView[];
}

export interface QuizAttemptAnswerResult {
  correct?: boolean;
  answer?: string;
  explanation?: string;
  alreadyAnswered?: boolean;
  submittedAnswer?: string;
  completed?: boolean;
}

export interface QuizAttemptSummary {
  attemptId: string;
  bankId: string;
  bankTitle: string;
  topic: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  startedAt: string;
  completedAt: string | null;
  version: number;
  itemCount: number;
  answeredCount: number;
  correctCount: number;
}

function asDifficulty(value: unknown): 'easy' | 'medium' | 'hard' {
  return value === 'easy' || value === 'hard' ? value : 'medium';
}

/** 学生可见题集列表（已发布 + platform 或本人所在 owner 班级；含本人练习概览）。 */
export async function listVisibleQuizBanks(db: SupabaseClient): Promise<QuizBankStudentSummary[]> {
  const { data, error } = await db.rpc('quiz_bank_list_student');
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    bankId: String(row.bankId ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    topic: String(row.topic ?? ''),
    itemCount: Number(row.itemCount ?? 0),
    version: Number(row.version ?? 0),
    platformWide: row.platformWide === true,
    completedAttempts: Number(row.completedAttempts ?? 0),
    bestCorrectRate: row.bestCorrectRate === null || row.bestCorrectRate === undefined ? null : Number(row.bestCorrectRate),
    inProgressAttemptId: row.inProgressAttemptId == null ? null : String(row.inProgressAttemptId),
    updatedAt: String(row.updatedAt ?? ''),
  }));
}

/** 开始/续作练习批次（fresh=true 时旧进行中批次记 abandoned 并新建）。 */
export async function startQuizAttempt(db: SupabaseClient, bankId: string, fresh: boolean): Promise<QuizAttemptStateView> {
  const { data, error } = await db.rpc('quiz_attempt_start', { p_bank_id: bankId, p_fresh: fresh });
  if (error) throw error;
  return parseAttemptState(data);
}

/** 批次详情（已作答题释放答案与解析，未作答题不返回答案）。 */
export async function getQuizAttemptState(db: SupabaseClient, attemptId: string): Promise<QuizAttemptStateView> {
  const { data, error } = await db.rpc('quiz_attempt_state', { p_attempt_id: attemptId });
  if (error) throw error;
  return parseAttemptState(data);
}

/** 提交单题答案（服务端判分：归属 + 幂等，首次提交终局）。 */
export async function submitQuizAttemptAnswer(
  db: SupabaseClient,
  attemptId: string,
  itemId: string,
  answer: string,
): Promise<QuizAttemptAnswerResult> {
  const { data, error } = await db.rpc('quiz_attempt_answer', {
    p_attempt_id: attemptId,
    p_item_id: itemId,
    p_answer: answer,
  });
  if (error) throw error;
  return (data ?? {}) as QuizAttemptAnswerResult;
}

/** 本人题库批次列表（统一报告列表数据源，题集标题经 RPC 投影返回）。 */
export async function listMyQuizAttempts(db: SupabaseClient): Promise<QuizAttemptSummary[]> {
  const { data, error } = await db.rpc('quiz_attempt_list_mine');
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    attemptId: String(row.attemptId ?? ''),
    bankId: String(row.bankId ?? ''),
    bankTitle: String(row.bankTitle ?? ''),
    topic: String(row.topic ?? ''),
    status: (['in_progress', 'completed', 'abandoned'].includes(String(row.status)) ? row.status : 'completed') as QuizAttemptSummary['status'],
    startedAt: String(row.startedAt ?? ''),
    completedAt: row.completedAt == null ? null : String(row.completedAt),
    version: Number(row.version ?? 0),
    itemCount: Number(row.itemCount ?? 0),
    answeredCount: Number(row.answeredCount ?? 0),
    correctCount: Number(row.correctCount ?? 0),
  }));
}

function parseAttemptState(raw: unknown): QuizAttemptStateView {
  const value = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(value.items) ? (value.items as Array<Record<string, unknown>>) : [];
  return {
    attemptId: String(value.attemptId ?? ''),
    bankId: String(value.bankId ?? ''),
    status: (['in_progress', 'completed', 'abandoned'].includes(String(value.status)) ? value.status : 'in_progress') as QuizAttemptStateView['status'],
    startedAt: String(value.startedAt ?? ''),
    completedAt: value.completedAt == null ? null : String(value.completedAt),
    version: Number(value.version ?? 0),
    itemCount: Number(value.itemCount ?? 0),
    items: items.map((item) => ({
      itemId: String(item.itemId ?? ''),
      stem: String(item.stem ?? ''),
      options: Array.isArray(item.options) ? (item.options as string[]) : [],
      difficulty: asDifficulty(item.difficulty),
      knowledgePoint: item.knowledgePoint == null || item.knowledgePoint === '' ? null : String(item.knowledgePoint),
      answered: item.answered === true,
      submittedAnswer: item.submittedAnswer == null ? null : String(item.submittedAnswer),
      isCorrect: typeof item.isCorrect === 'boolean' ? item.isCorrect : null,
      answer: item.answer == null ? null : String(item.answer),
      explanation: item.explanation == null ? null : String(item.explanation),
    })),
  };
}
