/**
 * 题库运行时（适配当前架构：requireAuth 用户 JWT + 受控 RPC）：
 * - 取题：quiz_fetch_questions（SECURITY DEFINER，随机分发未分配题目，投影不含 answer/explanation）
 * - 判分：quiz_submit_answer（归属校验 + 幂等：首次结果终局，重复提交不覆盖不刷分）
 * - 复盘：quiz_review_mine（仅已作答题返回 answer/explanation，作答前不可取答案）
 * - 教师维护：quiz_questions 走 RLS app_is_teacher（读/写/改/删）
 * 数据库既有 43 题（quiz_questions）直接使用；AI 扩容仅在教师显式触发且
 * 生成题目未经教师审核前不计入权威题库（本轮不实现扩容，保持 43 题闭环）。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUserClient } from '@/lib/supabase-client';

export interface QuizQuestionProjection {
  id: string;
  caseId: string;
  stem: string;
  options: string[];
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface QuizAnswerResult {
  correct?: boolean;
  answer?: string;
  explanation?: string;
  alreadyAnswered?: boolean;
  submittedAnswer?: string;
  error?: string;
}

export interface QuizReviewItem extends QuizQuestionProjection {
  submittedAnswer: string | null;
  isCorrect: boolean | null;
  answeredAt: string | null;
  answer: string | null;
  explanation: string | null;
}

export interface QuizPoolStatus {
  totalAvailable: number;
  perCase: Record<string, number>;
}

/** 学生取题：受控 RPC 分发（登录 + 未分配题目随机分发 + 自动写分配记录，投影无答案）。 */
export async function fetchQuestions(db: SupabaseClient, count: number): Promise<QuizQuestionProjection[]> {
  const safeCount = Math.min(Math.max(count, 1), 20);
  const { data, error } = await db.rpc('quiz_fetch_questions', { p_count: safeCount });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    caseId: String(row.case_id ?? ''),
    stem: String(row.stem ?? ''),
    options: Array.isArray(row.options) ? (row.options as string[]) : [],
    difficulty: (['easy', 'medium', 'hard'].includes(String(row.difficulty)) ? row.difficulty : 'medium') as QuizQuestionProjection['difficulty'],
  }));
}

/** 学生判分：受控 RPC（归属校验 + 幂等）。重复提交返回首次结果，不覆盖不刷分。 */
export async function submitAnswer(db: SupabaseClient, questionId: string, answer: string): Promise<QuizAnswerResult> {
  const { data, error } = await db.rpc('quiz_submit_answer', { p_question_id: questionId, p_answer: answer });
  if (error) throw error;
  return (data ?? {}) as QuizAnswerResult;
}

/** 学生错题复盘：仅本人作答记录；answer/explanation 仅已作答题返回。 */
export async function reviewMine(db: SupabaseClient): Promise<QuizReviewItem[]> {
  const { data, error } = await db.rpc('quiz_review_mine');
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.question_id),
    caseId: String(row.case_id ?? ''),
    stem: String(row.stem ?? ''),
    options: Array.isArray(row.options) ? (row.options as string[]) : [],
    difficulty: (['easy', 'medium', 'hard'].includes(String(row.difficulty)) ? row.difficulty : 'medium') as QuizQuestionProjection['difficulty'],
    submittedAnswer: typeof row.submitted_answer === 'string' ? row.submitted_answer : null,
    isCorrect: typeof row.is_correct === 'boolean' ? row.is_correct : null,
    answeredAt: typeof row.answered_at === 'string' ? row.answered_at : null,
    answer: typeof row.answer === 'string' ? row.answer : null,
    explanation: typeof row.explanation === 'string' ? row.explanation : null,
  }));
}

/** 教师查看题池状态（RLS app_is_teacher 放行直读）。 */
export async function getPoolStatus(accessToken: string): Promise<QuizPoolStatus> {
  const db = getSupabaseUserClient(accessToken);
  const { data, error } = await db.from('quiz_questions').select('case_id').eq('status', 'available');
  if (error) throw error;
  const perCase: Record<string, number> = {};
  for (const row of data ?? []) {
    const key = String(row.case_id ?? '');
    perCase[key] = (perCase[key] ?? 0) + 1;
  }
  return { totalAvailable: data?.length ?? 0, perCase };
}
