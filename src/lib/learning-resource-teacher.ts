/**
 * 学习资源中心教师端仓储（D10 / 方案第 13 节）：
 * - 表直读直写全部经用户身份客户端（RLS：维护者或项目管理员），不绕过任何策略；
 * - 写入形态由 learning_resources_write_guard 触发器收口：教师新建强制 draft/class，
 *   owner/scope 受保护，状态迁移白名单 draft→published→retired→draft，
 *   发布前置校验（file_id 非空、class 范围需本人管辖班级授权行）全部在数据库强制；
 * - 本层不复制归属判定，仅做「读不到即 RESOURCE_NOT_FOUND」的投影与错误翻译；
 * - fileId 不出服务端给学生的契约不变；教师端文件选择器列表仅返回元数据（不含访问链接）。
 */

import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireAuth } from '@/lib/request-auth';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { isProjectAdmin } from '@/lib/question-bank';

export type TeacherResourceStatus = 'draft' | 'published' | 'retired';

export interface TeacherResourceRecord {
  resourceId: string;
  ownerId: string;
  title: string;
  description: string | null;
  kind: 'video' | 'document';
  topic: string | null;
  coverFileId: string | null;
  fileId: string | null;
  durationSeconds: number | null;
  source: string | null;
  status: TeacherResourceStatus;
  scope: 'class' | 'platform';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TeacherClassBrief {
  id: string;
  name: string;
  memberCount: number;
}

export interface StorageFileBrief {
  fileId: string;
  fileName: string;
  fileSize: number;
  contentType: string | null;
  updateTime: string;
}

export interface TeacherResourceApiContext {
  userId: string;
  db: SupabaseClient;
  isAdmin: boolean;
}

/** 教师资源门控：身份交集 + 数据库配置 + 项目管理员标记（与题库同一谓词）。 */
export async function resolveTeacherResourceContext(request: NextRequest): Promise<TeacherResourceApiContext> {
  const user = await requireAuth(request, 'teacher');
  if (!user.accessToken) throw new Error('AUTH_REQUIRED');
  if (!isDatabaseConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');
  if (!(await isTeacherByWhitelist(user.accessToken))) throw new Error('FORBIDDEN');
  const db = getSupabaseUserClient(user.accessToken);
  const isAdmin = await isProjectAdmin(db);
  return { userId: user.id, db, isAdmin };
}

const UUID_RE = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export const MAX_DURATION_SECONDS = 24 * 60 * 60;

export const createResourceSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: z.enum(['video', 'document']),
  topic: z.string().trim().max(120).nullable().optional(),
  coverFileId: z.string().trim().max(255).nullable().optional(),
  fileId: z.string().trim().max(255).nullable().optional(),
  durationSeconds: z.number().int().min(0).max(MAX_DURATION_SECONDS).nullable().optional(),
  source: z.string().trim().max(120).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
}).strict();

export const updateResourceSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  kind: z.enum(['video', 'document']).optional(),
  topic: z.string().trim().max(120).nullable().optional(),
  coverFileId: z.string().trim().max(255).nullable().optional(),
  fileId: z.string().trim().max(255).nullable().optional(),
  durationSeconds: z.number().int().min(0).max(MAX_DURATION_SECONDS).nullable().optional(),
  source: z.string().trim().max(120).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
}).strict();

export const visibilitySchema = z.object({
  cohortIds: z.array(z.string().uuid()).max(50),
}).strict();

export const publishResourceSchema = z.object({
  scope: z.enum(['class', 'platform']).optional(),
}).strict();

/** 写守卫错误翻译：数据库强制的守卫码原样抛出（errorFromUnknown 统一映射中文文案），其余归并保存失败。 */
function translateWriteError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const guardCodes = ['FILE_REQUIRED', 'VISIBILITY_REQUIRED', 'OWNER_PROTECTED', 'SCOPE_PROTECTED', 'INVALID_STATUS_TRANSITION'];
  if (guardCodes.some((code) => message.includes(code))) return new Error(message);
  return new Error(`RESOURCE_SAVE_FAILED: ${message}`);
}

function rowToRecord(row: Record<string, unknown>): TeacherResourceRecord {
  const status = String(row.status);
  const kind = String(row.kind);
  return {
    resourceId: String(row.id),
    ownerId: String(row.owner_id),
    title: String(row.title ?? ''),
    description: row.description == null ? null : String(row.description),
    kind: kind === 'document' ? 'document' : 'video',
    topic: row.topic == null ? null : String(row.topic),
    coverFileId: row.cover_file_id == null ? null : String(row.cover_file_id),
    fileId: row.file_id == null ? null : String(row.file_id),
    durationSeconds: typeof row.duration_seconds === 'number' ? row.duration_seconds : null,
    source: row.source == null ? null : String(row.source),
    status: (['draft', 'published', 'retired'].includes(status) ? status : 'draft') as TeacherResourceStatus,
    scope: row.scope === 'platform' ? 'platform' : 'class',
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

/** 教师资源列表（RLS：本人草稿/全部 + 其他教师已发布；项目管理员可见全部）。 */
export async function listTeacherResources(db: SupabaseClient): Promise<TeacherResourceRecord[]> {
  const { data, error } = await db
    .from('learning_resources')
    .select('id,owner_id,title,description,kind,topic,cover_file_id,file_id,duration_seconds,source,status,scope,sort_order,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`RESOURCE_LIST_FAILED: ${error.message}`);
  return (data ?? []).map((row) => rowToRecord(row as Record<string, unknown>));
}

/** 资源详情（RLS 强制：读不到（不在维护范围且未发布）一律 RESOURCE_NOT_FOUND）。 */
export async function getTeacherResource(db: SupabaseClient, resourceId: string): Promise<TeacherResourceRecord> {
  const { data, error } = await db
    .from('learning_resources')
    .select('id,owner_id,title,description,kind,topic,cover_file_id,file_id,duration_seconds,source,status,scope,sort_order,created_at,updated_at')
    .eq('id', resourceId)
    .maybeSingle();
  if (error) throw new Error(`RESOURCE_GET_FAILED: ${error.message}`);
  if (!data) throw new Error('RESOURCE_NOT_FOUND');
  return rowToRecord(data as Record<string, unknown>);
}

/** 资源已授权班级清单（RLS：维护者/项目管理员可读）。 */
export async function getResourceVisibility(db: SupabaseClient, resourceId: string): Promise<string[]> {
  const { data, error } = await db
    .from('resource_class_visibility')
    .select('cohort_id')
    .eq('resource_id', resourceId);
  if (error) throw new Error(`RESOURCE_GET_FAILED: ${error.message}`);
  return (data ?? []).map((row) => String((row as Record<string, unknown>).cohort_id));
}

/** 教师管理班级清单（受控聚合 RPC teacher_student_index；与学情首页同源）。 */
export async function listManagedClasses(db: SupabaseClient): Promise<TeacherClassBrief[]> {
  const { data, error } = await db.rpc('teacher_student_index');
  if (error) throw new Error(`RESOURCE_LIST_FAILED: ${error.message}`);
  const index = (data ?? {}) as { classes?: Array<Record<string, unknown>> };
  return (index.classes ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    memberCount: Number(row.memberCount ?? 0),
  }));
}

/** 新建资源草稿（触发器对非项目管理员强制 draft/class）。 */
export async function createTeacherResource(
  db: SupabaseClient,
  userId: string,
  input: z.infer<typeof createResourceSchema>,
): Promise<TeacherResourceRecord> {
  const { data, error } = await db
    .from('learning_resources')
    .insert({
      owner_id: userId,
      title: input.title,
      description: input.description ?? null,
      kind: input.kind,
      topic: input.topic ?? null,
      cover_file_id: input.coverFileId ?? null,
      file_id: input.fileId ?? null,
      duration_seconds: input.durationSeconds ?? null,
      source: input.source ?? null,
      sort_order: input.sortOrder ?? 0,
    })
    .select('id,owner_id,title,description,kind,topic,cover_file_id,file_id,duration_seconds,source,status,scope,sort_order,created_at,updated_at')
    .single();
  if (error) throw translateWriteError(error);
  return rowToRecord(data as Record<string, unknown>);
}

export type ResourceUpdatePatch = Partial<{
  title: string;
  description: string | null;
  kind: 'video' | 'document';
  topic: string | null;
  coverFileId: string | null;
  fileId: string | null;
  durationSeconds: number | null;
  source: string | null;
  sortOrder: number;
}>;

/** 编辑资源元数据（不改状态；owner/scope 由触发器保护，updated_at 服务端维护）。 */
export async function updateTeacherResource(
  db: SupabaseClient,
  resourceId: string,
  patch: ResourceUpdatePatch,
): Promise<TeacherResourceRecord> {
  const values: Record<string, unknown> = {};
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.kind !== undefined) values.kind = patch.kind;
  if (patch.topic !== undefined) values.topic = patch.topic;
  if (patch.coverFileId !== undefined) values.cover_file_id = patch.coverFileId;
  if (patch.fileId !== undefined) values.file_id = patch.fileId;
  if (patch.durationSeconds !== undefined) values.duration_seconds = patch.durationSeconds;
  if (patch.source !== undefined) values.source = patch.source;
  if (patch.sortOrder !== undefined) values.sort_order = patch.sortOrder;
  if (Object.keys(values).length === 0) return getTeacherResource(db, resourceId);
  const { data, error } = await db
    .from('learning_resources')
    .update(values)
    .eq('id', resourceId)
    .select('id,owner_id,title,description,kind,topic,cover_file_id,file_id,duration_seconds,source,status,scope,sort_order,created_at,updated_at')
    .single();
  if (error) throw translateWriteError(error);
  if (!data) throw new Error('RESOURCE_NOT_FOUND');
  return rowToRecord(data as Record<string, unknown>);
}

/**
 * 发布资源：draft→published。前置校验（file_id 非空、class 范围需授权行）由触发器强制。
 * scope='platform' 仅项目管理员（触发器 SCOPE_PROTECTED + 应用层预检双重保险）。
 */
export async function publishTeacherResource(
  db: SupabaseClient,
  resourceId: string,
  scope?: 'class' | 'platform',
): Promise<TeacherResourceRecord> {
  const values: Record<string, unknown> = { status: 'published' };
  if (scope === 'platform') values.scope = 'platform';
  const { data, error } = await db
    .from('learning_resources')
    .update(values)
    .eq('id', resourceId)
    .select('id,owner_id,title,description,kind,topic,cover_file_id,file_id,duration_seconds,source,status,scope,sort_order,created_at,updated_at')
    .single();
  if (error) throw translateWriteError(error);
  if (!data) throw new Error('RESOURCE_NOT_FOUND');
  return rowToRecord(data as Record<string, unknown>);
}

/** 下架（published→retired）：学生列表立即移除，历史进度保留。 */
export async function retireTeacherResource(db: SupabaseClient, resourceId: string): Promise<TeacherResourceRecord> {
  const { data, error } = await db
    .from('learning_resources')
    .update({ status: 'retired' })
    .eq('id', resourceId)
    .select('id,owner_id,title,description,kind,topic,cover_file_id,file_id,duration_seconds,source,status,scope,sort_order,created_at,updated_at')
    .single();
  if (error) throw translateWriteError(error);
  if (!data) throw new Error('RESOURCE_NOT_FOUND');
  return rowToRecord(data as Record<string, unknown>);
}

/** 重新编辑（retired→draft）：修订后可再次发布。 */
export async function restoreTeacherResource(db: SupabaseClient, resourceId: string): Promise<TeacherResourceRecord> {
  const { data, error } = await db
    .from('learning_resources')
    .update({ status: 'draft' })
    .eq('id', resourceId)
    .select('id,owner_id,title,description,kind,topic,cover_file_id,file_id,duration_seconds,source,status,scope,sort_order,created_at,updated_at')
    .single();
  if (error) throw translateWriteError(error);
  if (!data) throw new Error('RESOURCE_NOT_FOUND');
  return rowToRecord(data as Record<string, unknown>);
}

/**
 * 替换可见班级集合（删除既有授权行后整批重建；RLS with check 强制 app_manages_class）。
 * 空集合仅在草稿/平台范围下合法；发布前触发器强制 class 范围至少一行本人管辖班级授权。
 */
export async function setResourceVisibility(
  db: SupabaseClient,
  resourceId: string,
  userId: string,
  cohortIds: string[],
): Promise<string[]> {
  const resource = await getTeacherResource(db, resourceId);
  const removeError = await db
    .from('resource_class_visibility')
    .delete()
    .eq('resource_id', resourceId)
    .then((result) => result.error, (reason: unknown) => reason);
  if (removeError) throw translateWriteError(removeError);
  const unique = [...new Set(cohortIds)];
  if (unique.length > 0) {
    const rows = unique.map((cohortId) => ({
      resource_id: resource.resourceId,
      cohort_id: cohortId,
      granted_by: userId,
    }));
    const insertError = await db
      .from('resource_class_visibility')
      .insert(rows)
      .then((result) => result.error, (reason: unknown) => reason);
    if (insertError) throw translateWriteError(insertError);
  }
  return getResourceVisibility(db, resourceId);
}

/** 删除资源：仅草稿可删（发布/下架过的资源保留学生进度历史，只能下架不能物理删除）。 */
export async function deleteTeacherResource(db: SupabaseClient, resourceId: string): Promise<void> {
  const resource = await getTeacherResource(db, resourceId);
  if (resource.status !== 'draft') {
    throw new Error('DELETE_DRAFT_ONLY');
  }
  const { error } = await db.from('learning_resources').delete().eq('id', resourceId);
  if (error) throw translateWriteError(error);
}

/** 对象存储文件清单（教师端文件绑定选择器）：仅元数据，不含访问链接。 */
export async function listStorageFilesForPicker(): Promise<StorageFileBrief[]> {
  const { StorageClient } = await import('coder-coding-dev-sdk');
  const storage = new StorageClient();
  const files = await storage.listFiles();
  return (files ?? [])
    .map((file) => ({
      fileId: file.fileId,
      fileName: file.fileName,
      fileSize: file.fileSize,
      contentType: file.contentType ?? null,
      updateTime: file.updateTime ?? file.createTime ?? '',
    }))
    .sort((a, b) => b.updateTime.localeCompare(a.updateTime));
}

/** 教师预览链接：以库内登记的 fileId 换取带期限链接（与学生端同一契约）。 */
export async function getTeacherPlaybackLink(fileId: string): Promise<{ url: string; expiresAt: string; fileName: string | null }> {
  const { StorageClient } = await import('coder-coding-dev-sdk');
  const storage = new StorageClient();
  const info = await storage.getFile({ fileId, expiresInSeconds: 3600 });
  return { url: info.url, expiresAt: info.expiresAt ?? '', fileName: info.fileName ?? null };
}
