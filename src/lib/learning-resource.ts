/**
 * 学习资源中心仓储（D10 / 方案第 13 节）：
 * - 学生访问全部经 SECURITY DEFINER 受控 RPC（resource_list_student / resource_get_student /
 *   resource_progress_upsert），与题库 quiz_bank_list_student 同模式——学生无表直读面；
 * - fileId（平台对象存储标识）不出服务端：详情路由返回前剥离；播放路由仅用它换取带期限链接；
 * - 进度为本人断点位置（幂等 upsert），不当掌握程度，不入临床评分。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type LearningResourceKind = 'video' | 'document';

export interface LearningResourceSummary {
  resourceId: string;
  title: string;
  description: string;
  kind: LearningResourceKind;
  topic: string;
  coverFileId: string | null;
  durationSeconds: number | null;
  source: string;
  platformWide: boolean;
  sortOrder: number;
  positionSeconds: number | null;
  progressUpdatedAt: string | null;
  updatedAt: string;
}

/** 服务端内部投影（含 fileId）；对客户端返回前必须剥离 fileId。 */
export interface LearningResourceDetailInternal {
  resourceId: string;
  title: string;
  description: string;
  kind: LearningResourceKind;
  topic: string;
  coverFileId: string | null;
  fileId: string | null;
  durationSeconds: number | null;
  source: string;
  platformWide: boolean;
  updatedAt: string;
  positionSeconds: number | null;
  progressUpdatedAt: string | null;
}

export type LearningResourceDetail = Omit<LearningResourceDetailInternal, 'fileId'>;

export interface ResourceProgressResult {
  resourceId: string;
  positionSeconds: number;
  updatedAt: string;
}

export interface ResourcePlaybackLink {
  url: string;
  expiresAt: string;
  fileName: string | null;
}

function asKind(value: unknown): LearningResourceKind {
  return value === 'document' ? 'document' : 'video';
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
}

function rpcErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** RPC 错误翻译：PostgREST 透传的 P0002/NOT_FOUND → 领域码（errorFromUnknown 统一映射中文文案）。 */
function translateRpcError(error: unknown, context: string): Error {
  const message = rpcErrorMessage(error);
  if (message.includes('NOT_FOUND')) return new Error('RESOURCE_NOT_FOUND');
  if (message.includes('INVALID_REQUEST')) return new Error('INVALID_REQUEST');
  return new Error(`${context}_FAILED: ${message}`);
}

/** 学生可见资源列表（已发布 + platform 或本人可见班级；含本人断点进度）。 */
export async function listVisibleLearningResources(db: SupabaseClient): Promise<LearningResourceSummary[]> {
  const { data, error } = await db.rpc('resource_list_student');
  if (error) throw translateRpcError(error, 'RESOURCE_LIST');
  if (!Array.isArray(data)) return [];
  return (data as unknown[]).map((row) => {
    const item = asRecord(row);
    return {
      resourceId: String(item.resourceId ?? ''),
      title: String(item.title ?? ''),
      description: String(item.description ?? ''),
      kind: asKind(item.kind),
      topic: String(item.topic ?? ''),
      coverFileId: item.coverFileId ? String(item.coverFileId) : null,
      durationSeconds: typeof item.durationSeconds === 'number' ? item.durationSeconds : null,
      source: String(item.source ?? ''),
      platformWide: item.platformWide === true,
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
      positionSeconds: typeof item.positionSeconds === 'number' ? item.positionSeconds : null,
      progressUpdatedAt: item.progressUpdatedAt ? String(item.progressUpdatedAt) : null,
      updatedAt: String(item.updatedAt ?? ''),
    };
  });
}

/** 学生资源详情（服务端内部投影，含 fileId；可见性由 RPC 强制，不可见一律 RESOURCE_NOT_FOUND）。 */
export async function getVisibleLearningResource(db: SupabaseClient, resourceId: string): Promise<LearningResourceDetailInternal> {
  const { data, error } = await db.rpc('resource_get_student', { p_resource_id: resourceId });
  if (error) throw translateRpcError(error, 'RESOURCE_GET');
  const item = asRecord(data);
  if (!item.resourceId) throw new Error('RESOURCE_NOT_FOUND');
  return {
    resourceId: String(item.resourceId),
    title: String(item.title ?? ''),
    description: String(item.description ?? ''),
    kind: asKind(item.kind),
    topic: String(item.topic ?? ''),
    coverFileId: item.coverFileId ? String(item.coverFileId) : null,
    fileId: item.fileId ? String(item.fileId) : null,
    durationSeconds: typeof item.durationSeconds === 'number' ? item.durationSeconds : null,
    source: String(item.source ?? ''),
    platformWide: item.platformWide === true,
    updatedAt: String(item.updatedAt ?? ''),
    positionSeconds: typeof item.positionSeconds === 'number' ? item.positionSeconds : null,
    progressUpdatedAt: item.progressUpdatedAt ? String(item.progressUpdatedAt) : null,
  };
}

/** 观看进度幂等更新（仅本人位置；范围校验在 RPC 内强制）。 */
export async function saveResourceProgress(db: SupabaseClient, resourceId: string, positionSeconds: number): Promise<ResourceProgressResult> {
  const { data, error } = await db.rpc('resource_progress_upsert', {
    p_resource_id: resourceId,
    p_position_seconds: Math.floor(positionSeconds),
  });
  if (error) throw translateRpcError(error, 'RESOURCE_PROGRESS');
  const item = asRecord(data);
  return {
    resourceId: String(item.resourceId ?? resourceId),
    positionSeconds: Number(item.positionSeconds ?? Math.floor(positionSeconds)),
    updatedAt: String(item.updatedAt ?? ''),
  };
}

/**
 * 解析播放/查看链接：服务端经 StorageClient.getFile 以 fileId 换取带期限链接（默认有效期 1 小时）。
 * 不持久化 URL、不暴露存储凭据、不做开放 URL 代理（fileId 只来自库内登记，不接受客户端传入）。
 */
export async function getResourcePlaybackLink(fileId: string): Promise<ResourcePlaybackLink> {
  const { StorageClient } = await import('coder-coding-dev-sdk');
  const storage = new StorageClient();
  try {
    const info = await storage.getFile({ fileId, expiresInSeconds: 3600 });
    return { url: info.url, expiresAt: info.expiresAt ?? '', fileName: info.fileName ?? null };
  } catch (error) {
    throw new Error(`FILE_UNAVAILABLE: ${rpcErrorMessage(error)}`);
  }
}

/** 进度位置上限（秒）：24h，超出视为异常数据拒绝。 */
export const MAX_POSITION_SECONDS = 24 * 60 * 60;

/** 进度提交校验（纯函数，供路由与单测共用）。 */
export function parsePositionSeconds(value: unknown): number | null {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(num) || num < 0 || num > MAX_POSITION_SECONDS) return null;
  return Math.floor(num);
}
