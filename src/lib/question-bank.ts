/**
 * 题集仓储（阶段 F / AI 题库闭环教师端）：
 * - 表直读直写全部经用户身份客户端（RLS：owner 或项目管理员），不绕过任何策略；
 * - 发布仅经 quiz_bank_publish 受控 RPC（审核校验 + 版本冻结快照，原子完成）；
 * - AI 生成条目幂等定位：同一 generation_id 重复生成返回既有草稿，不重复插入；
 * - 状态迁移白名单：published 只能经发布 RPC 达成，本层 updateBank 拒绝直接置为 published。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type BankStatus = 'draft' | 'ready_for_review' | 'published' | 'retired';
export type BankVisibility = 'own_class' | 'platform';
export type ItemDifficulty = 'easy' | 'medium' | 'hard';
export type ItemReviewStatus = 'draft' | 'approved' | 'rejected';
export type ItemSource = 'ai' | 'manual';

export interface QuestionBankRecord {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  topic: string | null;
  status: BankStatus;
  visibility: BankVisibility;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionBankItemRecord {
  id: string;
  bankId: string;
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
  knowledgePoint: string | null;
  difficulty: ItemDifficulty;
  reviewStatus: ItemReviewStatus;
  source: ItemSource;
  generationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionBankSummary extends QuestionBankRecord {
  itemCount: number;
  approvedCount: number;
  publishedItemCount: number | null;
  publishedVersion: number | null;
}

export interface QuestionBankDetail extends QuestionBankRecord {
  items: QuestionBankItemRecord[];
  versions: Array<{ id: string; version: number; itemCount: number; publishedAt: string }>;
  isAdminOwned: boolean;
}

export interface PublishBankResult {
  bankId: string;
  version: number;
  itemCount: number;
  versionId: string;
}

/** 状态迁移白名单（published 只能经发布 RPC 达成；retired→draft 允许修订后再发布）。 */
export const BANK_STATUS_TRANSITIONS: Record<BankStatus, BankStatus[]> = {
  draft: ['ready_for_review'],
  ready_for_review: ['draft'],
  published: ['retired'],
  retired: ['draft'],
};

export function canTransitionBankStatus(from: BankStatus, to: BankStatus): boolean {
  return BANK_STATUS_TRANSITIONS[from].includes(to);
}

const UUID_RE = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function rowToBank(row: Record<string, unknown>): QuestionBankRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    title: String(row.title ?? ''),
    description: row.description == null ? null : String(row.description),
    topic: row.topic == null ? null : String(row.topic),
    status: (['draft', 'ready_for_review', 'published', 'retired'].includes(String(row.status)) ? row.status : 'draft') as BankStatus,
    visibility: row.visibility === 'platform' ? 'platform' : 'own_class',
    currentVersionId: row.current_version_id == null ? null : String(row.current_version_id),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

function rowToItem(row: Record<string, unknown>): QuestionBankItemRecord {
  return {
    id: String(row.id),
    bankId: String(row.bank_id),
    stem: String(row.stem ?? ''),
    options: Array.isArray(row.options) ? (row.options as string[]) : [],
    answer: String(row.answer ?? ''),
    explanation: String(row.explanation ?? ''),
    knowledgePoint: row.knowledge_point == null ? null : String(row.knowledge_point),
    difficulty: (['easy', 'medium', 'hard'].includes(String(row.difficulty)) ? row.difficulty : 'medium') as ItemDifficulty,
    reviewStatus: (['draft', 'approved', 'rejected'].includes(String(row.review_status)) ? row.review_status : 'draft') as ItemReviewStatus,
    source: row.source === 'manual' ? 'manual' : 'ai',
    generationId: row.generation_id == null ? null : String(row.generation_id),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

/** 教师题集列表（RLS：本人题集；项目管理员可见全部）。汇总条目数与已发布版本信息。 */
export async function listQuestionBanks(db: SupabaseClient): Promise<QuestionBankSummary[]> {
  const [{ data: banks, error: banksError }, { data: items, error: itemsError }, { data: versions, error: versionsError }] = await Promise.all([
    db.from('question_banks').select('id,owner_id,title,description,topic,status,visibility,current_version_id,created_at,updated_at').order('updated_at', { ascending: false }),
    db.from('bank_items').select('bank_id,review_status'),
    db.from('question_bank_versions').select('id,bank_id,version,item_count,published_at'),
  ]);
  if (banksError) throw banksError;
  if (itemsError) throw itemsError;
  if (versionsError) throw versionsError;
  const itemCounts = new Map<string, number>();
  const approvedCounts = new Map<string, number>();
  for (const row of (items ?? []) as Array<Record<string, unknown>>) {
    const bankId = String(row.bank_id);
    itemCounts.set(bankId, (itemCounts.get(bankId) ?? 0) + 1);
    if (row.review_status === 'approved') approvedCounts.set(bankId, (approvedCounts.get(bankId) ?? 0) + 1);
  }
  const versionById = new Map<string, { version: number; itemCount: number }>();
  const versionsByBank = new Map<string, Array<{ id: string; version: number; itemCount: number; publishedAt: string }>>();
  for (const row of (versions ?? []) as Array<Record<string, unknown>>) {
    const entry = {
      id: String(row.id),
      version: Number(row.version ?? 0),
      itemCount: Number(row.item_count ?? 0),
      publishedAt: String(row.published_at ?? ''),
    };
    versionById.set(entry.id, { version: entry.version, itemCount: entry.itemCount });
    const bankId = String(row.bank_id);
    const list = versionsByBank.get(bankId) ?? [];
    list.push(entry);
    versionsByBank.set(bankId, list);
  }
  return ((banks ?? []) as Array<Record<string, unknown>>).map((row) => {
    const bank = rowToBank(row);
    const published = bank.currentVersionId ? versionById.get(bank.currentVersionId) ?? null : null;
    return {
      ...bank,
      itemCount: itemCounts.get(bank.id) ?? 0,
      approvedCount: approvedCounts.get(bank.id) ?? 0,
      publishedItemCount: published ? published.itemCount : null,
      publishedVersion: published ? published.version : null,
    };
  });
}

/** 题集详情（RLS：owner/项目管理员）：含全部条目与版本历史。 */
export async function getQuestionBank(db: SupabaseClient, bankId: string): Promise<QuestionBankDetail | null> {
  const { data: bankRow, error: bankError } = await db.from('question_banks')
    .select('id,owner_id,title,description,topic,status,visibility,current_version_id,created_at,updated_at')
    .eq('id', bankId)
    .maybeSingle();
  if (bankError) throw bankError;
  if (!bankRow) return null;
  const bank = rowToBank(bankRow as Record<string, unknown>);
  const [{ data: itemRows, error: itemsError }, { data: versionRows, error: versionsError }] = await Promise.all([
    db.from('bank_items')
      .select('id,bank_id,stem,options,answer,explanation,knowledge_point,difficulty,review_status,source,generation_id,created_at,updated_at')
      .eq('bank_id', bankId)
      .order('created_at', { ascending: true }),
    db.from('question_bank_versions')
      .select('id,bank_id,version,item_count,published_at')
      .eq('bank_id', bankId)
      .order('version', { ascending: false }),
  ]);
  if (itemsError) throw itemsError;
  if (versionsError) throw versionsError;
  return {
    ...bank,
    items: ((itemRows ?? []) as Array<Record<string, unknown>>).map(rowToItem),
    versions: ((versionRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      version: Number(row.version ?? 0),
      itemCount: Number(row.item_count ?? 0),
      publishedAt: String(row.published_at ?? ''),
    })),
    isAdminOwned: false,
  };
}

/** 新建题集（owner_id 必须为当前会话用户，RLS with check 强制）。 */
export async function createQuestionBank(
  db: SupabaseClient,
  ownerId: string,
  input: { title: string; description: string | null; topic: string | null },
): Promise<QuestionBankRecord> {
  const { data, error } = await db.from('question_banks')
    .insert({ owner_id: ownerId, title: input.title, description: input.description, topic: input.topic })
    .select('id,owner_id,title,description,topic,status,visibility,current_version_id,created_at,updated_at')
    .single();
  if (error) throw error;
  return rowToBank(data as Record<string, unknown>);
}

export interface BankUpdatePatch {
  title?: string;
  description?: string | null;
  topic?: string | null;
  status?: BankStatus;
}

/** 更新题集元信息/状态（状态迁移白名单在 API 层校验；published 不可经本函数设定）。 */
export async function updateQuestionBank(db: SupabaseClient, bankId: string, patch: BankUpdatePatch): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.topic !== undefined) update.topic = patch.topic;
  if (patch.status !== undefined) update.status = patch.status;
  const { error } = await db.from('question_banks').update(update).eq('id', bankId);
  if (error) throw error;
}

/** 删除题集（RLS：owner/管理员）。已发布过版本的题集禁止删除（保护学生练习记录），先下架并确认无批次。 */
export async function deleteQuestionBank(db: SupabaseClient, bankId: string): Promise<void> {
  const { count, error: countError } = await db.from('question_bank_versions').select('id', { count: 'exact', head: true }).eq('bank_id', bankId);
  if (countError) throw countError;
  if ((count ?? 0) > 0) throw new Error('BANK_HAS_VERSIONS');
  const { error } = await db.from('question_banks').delete().eq('id', bankId);
  if (error) throw error;
}

export interface ItemUpdatePatch {
  stem?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
  knowledgePoint?: string | null;
  difficulty?: ItemDifficulty;
  reviewStatus?: ItemReviewStatus;
}

/** 更新题目条目（编辑或审核）。answer ∈ options 由 API 层 schema 校验，数据库 CHECK 兜底。 */
export async function updateQuestionBankItem(
  db: SupabaseClient,
  bankId: string,
  itemId: string,
  patch: ItemUpdatePatch,
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.stem !== undefined) update.stem = patch.stem;
  if (patch.options !== undefined) update.options = patch.options;
  if (patch.answer !== undefined) update.answer = patch.answer;
  if (patch.explanation !== undefined) update.explanation = patch.explanation;
  if (patch.knowledgePoint !== undefined) update.knowledge_point = patch.knowledgePoint;
  if (patch.difficulty !== undefined) update.difficulty = patch.difficulty;
  if (patch.reviewStatus !== undefined) update.review_status = patch.reviewStatus;
  const { error } = await db.from('bank_items').update(update).eq('id', itemId).eq('bank_id', bankId);
  if (error) throw error;
}

/** 删除题目条目（RLS：owner/管理员）。 */
export async function deleteQuestionBankItem(db: SupabaseClient, bankId: string, itemId: string): Promise<void> {
  const { error } = await db.from('bank_items').delete().eq('id', itemId).eq('bank_id', bankId);
  if (error) throw error;
}

export interface GeneratedItemInput {
  stem: string;
  options: string[];
  answer: string;
  explanation: string;
  knowledgePoint: string | null;
  difficulty: ItemDifficulty;
}

/** 插入 AI 生成草稿条目（source='ai'，generationId 为幂等定位符）。 */
export async function insertGeneratedItems(
  db: SupabaseClient,
  bankId: string,
  generationId: string,
  items: GeneratedItemInput[],
): Promise<QuestionBankItemRecord[]> {
  const rows = items.map((item) => ({
    bank_id: bankId,
    stem: item.stem,
    options: item.options,
    answer: item.answer,
    explanation: item.explanation,
    knowledge_point: item.knowledgePoint,
    difficulty: item.difficulty,
    source: 'ai' as const,
    generation_id: generationId,
  }));
  const { data, error } = await db.from('bank_items')
    .insert(rows)
    .select('id,bank_id,stem,options,answer,explanation,knowledge_point,difficulty,review_status,source,generation_id,created_at,updated_at');
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(rowToItem);
}

/** 幂等查询：同一 (bankId, generationId) 是否已有生成草稿。 */
export async function findGeneratedItems(db: SupabaseClient, bankId: string, generationId: string): Promise<QuestionBankItemRecord[]> {
  const { data, error } = await db.from('bank_items')
    .select('id,bank_id,stem,options,answer,explanation,knowledge_point,difficulty,review_status,source,generation_id,created_at,updated_at')
    .eq('bank_id', bankId)
    .eq('generation_id', generationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(rowToItem);
}

/** 发布题集（受控 RPC：审核校验 + 选项唯一性 + 版本冻结，原子完成）。 */
export async function publishQuestionBank(db: SupabaseClient, bankId: string, visibility: BankVisibility | null): Promise<PublishBankResult> {
  const { data, error } = await db.rpc('quiz_bank_publish', { p_bank_id: bankId, p_visibility: visibility });
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    bankId: String(row.bankId ?? bankId),
    version: Number(row.version ?? 0),
    itemCount: Number(row.itemCount ?? 0),
    versionId: String(row.versionId ?? ''),
  };
}

/** 当前会话是否项目管理员（与 RLS 同一谓词 app_is_project_admin）。 */
export async function isProjectAdmin(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc('app_is_project_admin');
  if (error) throw error;
  return data === true;
}
