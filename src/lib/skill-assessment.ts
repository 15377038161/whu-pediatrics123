import { z } from 'zod';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthedUserContext } from '@/lib/request-auth';
import { requireAuth } from '@/lib/request-auth';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { SKILL_RUBRIC_VERSION } from '@/domain/skill-assessment';

/**
 * 批次8·教师手机现场考核评分（repository 层）。
 *
 * 行级权限全部由 RLS 保证：
 * - skill_assessments_teacher_all：teacher_id = auth.uid() and app_is_teacher()；
 * - skill_assessment_scores_teacher_all：明细所属考核必须为本教师所有；
 * 发布固化与学生查询走受控 RPC（skill_assessment_publish / skill_assessments_student）。
 * 本层仅做状态机与评分口径校验，不做跨教师越权兜底。
 */

export interface SkillAssessmentTeacherContext {
  user: AuthedUserContext;
  db: SupabaseClient;
}

/** 教师端上下文解析：登录 + 白名单教师 + 用户态 Supabase 客户端（与题集模块同源范式）。 */
export async function resolveSkillAssessmentTeacherContext(
  request: NextRequest,
): Promise<SkillAssessmentTeacherContext> {
  const user = await requireAuth(request, 'teacher');
  if (!user.accessToken) throw new Error('AUTH_REQUIRED');
  if (!isDatabaseConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');
  if (!(await isTeacherByWhitelist(user.accessToken))) throw new Error('FORBIDDEN');
  const db = getSupabaseUserClient(user.accessToken);
  return { user, db };
}

export const createSkillAssessmentSchema = z.object({
  studentId: z.string().uuid(),
  skillId: z.string().uuid(),
  assessmentAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
  clientEventId: z.string().trim().min(8).max(80),
}).strict();

export const updateSkillAssessmentSchema = z.object({
  /** 整体替换语义：数组即当前完整明细（未观察项以 score=null 表示）。 */
  items: z.array(z.object({
    itemKey: z.string().trim().min(1).max(40),
    score: z.union([z.literal(0), z.literal(1), z.literal(2), z.null()]),
  })).max(10),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

export interface RubricItem {
  id: string;
  skillId: string;
  itemKey: string;
  itemLabel: string;
  sortOrder: number;
}

export interface AssessmentScoreEntry {
  itemKey: string;
  score: 0 | 1 | 2 | null;
}

export interface SkillAssessmentRecord {
  id: string;
  teacherId: string;
  studentId: string;
  skillId: string;
  rubricVersion: number;
  status: 'draft' | 'published';
  totalScore: number | null;
  publishedAt: string | null;
  assessmentAt: string;
  note: string | null;
  retakeOf: string | null;
  clientEventId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillAssessmentListItem extends SkillAssessmentRecord {
  skillTitle: string;
  skillSlug: string;
  rubricItemCount: number;
  scoredCount: number;
}

export interface SkillAssessmentDetail extends SkillAssessmentListItem {
  rubric: RubricItem[];
  scores: AssessmentScoreEntry[];
}

export interface StudentSkillAssessmentItem {
  assessmentId: string;
  skillId: string;
  skillTitle: string;
  totalScore: number | null;
  assessmentAt: string;
  publishedAt: string;
  note: string | null;
  items: Array<{ itemKey: string; itemLabel: string; score: number | null }>;
}

const ASSESSMENT_COLUMNS =
  'id,teacher_id,student_id,skill_id,rubric_version,status,total_score,published_at,assessment_at,note,retake_of,client_event_id,created_at,updated_at';

function rowToAssessment(row: Record<string, unknown>): SkillAssessmentRecord {
  return {
    id: row.id as string,
    teacherId: row.teacher_id as string,
    studentId: row.student_id as string,
    skillId: row.skill_id as string,
    rubricVersion: row.rubric_version as number,
    status: row.status as 'draft' | 'published',
    totalScore: (row.total_score as number | null) ?? null,
    publishedAt: (row.published_at as string | null) ?? null,
    assessmentAt: row.assessment_at as string,
    note: (row.note as string | null) ?? null,
    retakeOf: (row.retake_of as string | null) ?? null,
    clientEventId: row.client_event_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** 技能评分项（rubric 元数据，登录用户全员可读）。 */
export async function listRubricItems(db: SupabaseClient, skillId: string): Promise<RubricItem[]> {
  const { data, error } = await db.from('skill_rubric_items')
    .select('id,skill_id,item_key,item_label,sort_order')
    .eq('skill_id', skillId)
    .eq('rubric_version', SKILL_RUBRIC_VERSION)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    skillId: row.skill_id as string,
    itemKey: row.item_key as string,
    itemLabel: row.item_label as string,
    sortOrder: row.sort_order as number,
  }));
}

/** 教师考核列表（RLS 限定本人；含技能标题与计分进度，学生姓名由路由层合并班级清单）。 */
export async function listTeacherAssessments(
  db: SupabaseClient,
  teacherId: string,
): Promise<SkillAssessmentListItem[]> {
  const { data, error } = await db.from('skill_assessments')
    .select(`${ASSESSMENT_COLUMNS},skill:skills(title,slug)`)
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const assessments = rows.map(rowToAssessment);
  const ids = assessments.map((a) => a.id);
  const skillIds = [...new Set(assessments.map((a) => a.skillId))];
  // 哨兵 UUID：空集合查询时避免空数组 .in()，保证与正常分支同构
  const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

  const [rubricRes, scoresRes] = await Promise.all([
    db.from('skill_rubric_items').select('skill_id,item_key')
      .eq('rubric_version', SKILL_RUBRIC_VERSION)
      .in('skill_id', skillIds.length > 0 ? skillIds : [EMPTY_UUID]),
    db.from('skill_assessment_scores').select('assessment_id,score')
      .in('assessment_id', ids.length > 0 ? ids : [EMPTY_UUID]),
  ]);
  if (rubricRes.error) throw rubricRes.error;
  if (scoresRes.error) throw scoresRes.error;

  const rubricCountBySkill = new Map<string, number>();
  for (const r of (rubricRes.data ?? []) as Array<Record<string, unknown>>) {
    const key = r.skill_id as string;
    rubricCountBySkill.set(key, (rubricCountBySkill.get(key) ?? 0) + 1);
  }
  const scoredCountById = new Map<string, number>();
  for (const s of (scoresRes.data ?? []) as Array<Record<string, unknown>>) {
    if (s.score === null) continue;
    const key = s.assessment_id as string;
    scoredCountById.set(key, (scoredCountById.get(key) ?? 0) + 1);
  }

  return assessments.map((a, index) => {
    const skill = rows[index]?.skill as { title?: string; slug?: string } | undefined;
    return {
      ...a,
      skillTitle: skill?.title ?? '',
      skillSlug: skill?.slug ?? '',
      rubricItemCount: rubricCountBySkill.get(a.skillId) ?? 0,
      scoredCount: scoredCountById.get(a.id) ?? 0,
    };
  });
}

/** 教师考核详情（含 rubric 与逐项明细；RLS 限定本人，非本人返回 null）。 */
export async function getTeacherAssessment(
  db: SupabaseClient,
  teacherId: string,
  assessmentId: string,
): Promise<SkillAssessmentDetail | null> {
  const { data, error } = await db.from('skill_assessments')
    .select(`${ASSESSMENT_COLUMNS},skill:skills(title,slug)`)
    .eq('id', assessmentId)
    .eq('teacher_id', teacherId)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  const row = data as Record<string, unknown>;
  const [rubric, scoresRes] = await Promise.all([
    listRubricItems(db, row.skill_id as string),
    db.from('skill_assessment_scores').select('item_key,score').eq('assessment_id', assessmentId),
  ]);
  if (scoresRes.error) throw scoresRes.error;
  const scores: AssessmentScoreEntry[] = ((scoresRes.data ?? []) as Array<Record<string, unknown>>).map((s) => ({
    itemKey: s.item_key as string,
    score: s.score as 0 | 1 | 2 | null,
  }));
  const skill = row.skill as { title?: string; slug?: string } | undefined;
  return {
    ...rowToAssessment(row),
    skillTitle: skill?.title ?? '',
    skillSlug: skill?.slug ?? '',
    rubricItemCount: rubric.length,
    scoredCount: scores.filter((s) => s.score !== null).length,
    rubric,
    scores,
  };
}

/** 创建考核草稿（client_event_id 幂等，重复提交由唯一约束拦截）。 */
export async function createTeacherAssessment(
  db: SupabaseClient,
  teacherId: string,
  input: z.infer<typeof createSkillAssessmentSchema>,
): Promise<SkillAssessmentRecord> {
  const { data, error } = await db.from('skill_assessments')
    .insert({
      teacher_id: teacherId,
      student_id: input.studentId,
      skill_id: input.skillId,
      rubric_version: SKILL_RUBRIC_VERSION,
      status: 'draft',
      assessment_at: input.assessmentAt ?? new Date().toISOString(),
      note: input.note ?? null,
      client_event_id: input.clientEventId,
    })
    .select(ASSESSMENT_COLUMNS)
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('ASSESSMENT_DUPLICATE');
    if (error.code === '23503') throw new Error('ASSESSMENT_INVALID_TARGET');
    throw error;
  }
  return rowToAssessment(data as Record<string, unknown>);
}

/**
 * 保存草稿明细（整体替换语义）：
 * - 仅 draft 可改（published 成绩已固定，需先撤回）；
 * - itemKey 必须属于该技能当前 rubric 版本评分项；
 * - upsert 输入项 + 删除不再存在的旧明细 + 更新备注。
 */
export async function updateTeacherAssessmentScores(
  db: SupabaseClient,
  teacherId: string,
  assessmentId: string,
  input: z.infer<typeof updateSkillAssessmentSchema>,
): Promise<void> {
  const current = await getTeacherAssessment(db, teacherId, assessmentId);
  if (!current) throw new Error('ASSESSMENT_NOT_FOUND');
  if (current.status !== 'draft') throw new Error('ASSESSMENT_LOCKED');

  const allowed = new Set(current.rubric.map((r) => r.itemKey));
  const seen = new Set<string>();
  for (const item of input.items) {
    if (seen.has(item.itemKey) || !allowed.has(item.itemKey)) throw new Error('RUBRIC_MISMATCH');
    seen.add(item.itemKey);
  }

  const now = new Date().toISOString();
  if (input.items.length > 0) {
    const upsertRows = input.items.map((item) => ({
      assessment_id: assessmentId,
      item_key: item.itemKey,
      score: item.score,
      updated_at: now,
    }));
    const { error: upErr } = await db.from('skill_assessment_scores')
      .upsert(upsertRows, { onConflict: 'assessment_id,item_key' });
    if (upErr) throw upErr;
  }

  const staleKeys = [...allowed].filter((key) => !seen.has(key));
  if (staleKeys.length > 0) {
    const { error: delErr } = await db.from('skill_assessment_scores')
      .delete().eq('assessment_id', assessmentId).in('item_key', staleKeys);
    if (delErr) throw delErr;
  }

  if (input.note !== undefined) {
    const { error: noteErr } = await db.from('skill_assessments')
      .update({ note: input.note, updated_at: now })
      .eq('id', assessmentId)
      .eq('teacher_id', teacherId);
    if (noteErr) throw noteErr;
  }
}

/** 发布考核（受控 RPC：服务端校验本人/草稿/明细合法/至少 1 项计分并原子固化总分）。 */
export async function publishTeacherAssessment(
  db: SupabaseClient,
  teacherId: string,
  assessmentId: string,
): Promise<{ totalScore: number }> {
  const current = await getTeacherAssessment(db, teacherId, assessmentId);
  if (!current) throw new Error('ASSESSMENT_NOT_FOUND');
  if (current.status === 'published') throw new Error('ASSESSMENT_ALREADY_PUBLISHED');
  if (!current.scores.some((s) => s.score !== null)) throw new Error('ASSESSMENT_EMPTY');
  const { data, error } = await db.rpc('skill_assessment_publish', { p_assessment_id: assessmentId });
  if (error) {
    const msg = error.message;
    if (msg.includes('NOT_FOUND')) throw new Error('ASSESSMENT_NOT_FOUND');
    if (msg.includes('FORBIDDEN')) throw new Error('FORBIDDEN');
    if (msg.includes('INVALID_REQUEST')) throw new Error('RUBRIC_MISMATCH');
    throw error;
  }
  const payload = data as { totalScore: number } | null;
  return { totalScore: payload?.totalScore ?? 0 };
}

/** 撤回发布：published → draft（教师本人可改；学生查询只返回 published，撤回后成绩即时隐藏）。 */
export async function retractTeacherAssessment(
  db: SupabaseClient,
  teacherId: string,
  assessmentId: string,
): Promise<void> {
  const { data, error } = await db.from('skill_assessments')
    .select('id,status')
    .eq('id', assessmentId)
    .eq('teacher_id', teacherId)
    .single();
  if (error) {
    if (error.code === 'PGRST116') throw new Error('ASSESSMENT_NOT_FOUND');
    throw error;
  }
  if ((data as Record<string, unknown>).status !== 'published') throw new Error('ASSESSMENT_NOT_PUBLISHED');
  const { error: updErr } = await db.from('skill_assessments')
    .update({ status: 'draft', total_score: null, published_at: null, updated_at: new Date().toISOString() })
    .eq('id', assessmentId)
    .eq('teacher_id', teacherId);
  if (updErr) throw updErr;
}

/** 补考：基于原考核创建新草稿记录（retake_of 关联，历史保留可对比）。 */
export async function retakeTeacherAssessment(
  db: SupabaseClient,
  teacherId: string,
  assessmentId: string,
): Promise<SkillAssessmentRecord> {
  const current = await getTeacherAssessment(db, teacherId, assessmentId);
  if (!current) throw new Error('ASSESSMENT_NOT_FOUND');
  const { data, error } = await db.from('skill_assessments')
    .insert({
      teacher_id: teacherId,
      student_id: current.studentId,
      skill_id: current.skillId,
      rubric_version: current.rubricVersion,
      status: 'draft',
      assessment_at: new Date().toISOString(),
      note: null,
      retake_of: assessmentId,
      client_event_id: crypto.randomUUID(),
    })
    .select(ASSESSMENT_COLUMNS)
    .single();
  if (error) throw error;
  return rowToAssessment(data as Record<string, unknown>);
}

/** 学生查询本人已发布考核（受控 RPC，成绩仅本人可见）。 */
export async function listStudentAssessments(db: SupabaseClient): Promise<StudentSkillAssessmentItem[]> {
  const { data, error } = await db.rpc('skill_assessments_student');
  if (error) throw new Error('SKILL_ASSESSMENT_RPC_FAILED');
  return (data ?? []) as StudentSkillAssessmentItem[];
}

/** 批次8错误码 → HTTP 状态（与题集模块 failStatus 同构）。 */
export function failSkillAssessmentStatus(code: string): number {
  if (code === 'AUTH_REQUIRED') return 401;
  if (code === 'FORBIDDEN' || code === 'ASSESSMENT_STUDENT_FORBIDDEN') return 403;
  if (code === 'DATABASE_NOT_CONFIGURED' || code === 'RPC_UNAVAILABLE') return 503;
  if (code === 'ASSESSMENT_NOT_FOUND') return 404;
  return 400;
}
