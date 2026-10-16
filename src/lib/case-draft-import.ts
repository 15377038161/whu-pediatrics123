import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';

/**
 * 应用层教师判定：与数据库 RLS 白名单谓词完全一致（同一 app_is_teacher()），
 * 教师身份不自封、不信任客户端声明；数据库不可用时 fail-closed 返回 false。
 */
export async function isTeacherByWhitelist(accessToken: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  try {
    const db = getSupabaseUserClient(accessToken);
    const { data } = await db.rpc('app_is_teacher');
    return data === true;
  } catch {
    return false;
  }
}

/**
 * 教师病例草稿导入（最小实现）。
 *
 * 边界（与本阶段承诺一致）：
 * - 草稿仅落 case_draft_imports 表，与运行中事实快照（case_snapshot_facts/answers）完全隔离，
 *   不被 case 加载器（readTeacherCaseData/ensureCaseSnapshot）或学生 RPC 读取；
 * - 预校验只报告缺失字段与状态，不自动补任何患者事实；
 * - 无学生发布动作：status 固定 'draft'（数据库 CHECK 约束兜底）；
 * - 防覆盖：表无 UPDATE/DELETE 权限，修订必须升 draft_version（如 v2），旧版本保留；
 * - 重复导入同一 (case_id, draft_version) 触发唯一约束，返回明确的 DUPLICATE 结果。
 */

export interface CaseDraftSectionPayload {
  history?: string;
  exam?: string;
  tests?: string;
  diagnosis?: string;
  plan?: string;
}

export interface CaseDraftPayload {
  caseId: string;
  age?: string;
  sex?: string;
  complaint?: string;
  sections: CaseDraftSectionPayload;
  vitals?: { temperature?: number | null; heartRate?: number | null; respiratoryRate?: number | null; spo2?: number | null };
  media?: Array<{ url?: string; caption?: string }>;
  documents?: Array<{ source?: string; text?: string }>;
}

export interface CaseDraftPrecheckResult {
  caseId: string;
  caseName: string;
  /** 解析后的别名/亚型目标来源（仅记录映射关系，不把别名算作新增独立病例）。 */
  aliasSourceId: string | null;
  aliasRelation: 'alias' | 'subtype' | null;
  /** 来源标识：catalog（目录项）/ alias（别名映射到既有来源）/ unknown（目录外，仅可存草稿）。 */
  sourceMatch: 'catalog' | 'alias' | 'unknown';
  /** 必填字段缺失清单（不补造，仅报告）。 */
  missingFields: string[];
  completeness: {
    requiredTotal: number;
    provided: number;
    sectionFields: Record<keyof CaseDraftSectionPayload, boolean>;
  };
  /** 脱敏/媒体审核状态（显式记录，默认未审核）。 */
  desensitized: boolean;
  mediaReviewed: boolean;
  mediaCount: number;
  documentCount: number;
  /** 预校验发现的问题（缺失字段、身份信息疑似未脱敏等），不为空时不建议保存。 */
  issues: string[];
  /** 已存在相同 (case_id, draft_version) 的草稿。 */
  duplicate: boolean;
}

export interface CaseDraftRecord {
  id: string;
  caseId: string;
  caseName: string;
  draftVersion: string;
  sourceName: string;
  sourceKind: string;
  aliasSourceId: string | null;
  status: string;
  desensitized: boolean;
  mediaReviewed: boolean;
  missingFields: string[];
  completeness: Record<string, unknown>;
  mediaCount: number;
  documentCount: number;
  createdBy: string;
  createdAt: string;
}

export interface CaseDraftDetail extends CaseDraftRecord {
  payload: CaseDraftPayload;
}

/** 必填字段：五段核心事实 + 基本人口学（年龄/性别/主诉）。诊断/处置属于答案面，草稿需记录但同样必填。 */
const REQUIRED_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'age', label: '年龄' },
  { key: 'sex', label: '性别' },
  { key: 'complaint', label: '主诉' },
  { key: 'history', label: '病史' },
  { key: 'exam', label: '体格检查' },
  { key: 'tests', label: '辅助检查' },
  { key: 'diagnosis', label: '诊断' },
  { key: 'plan', label: '诊疗计划' },
];

/** 与 prepare-teacher-cases.py / case-snapshot.ts 一致的身份信息模式（用于脱敏预检提示）。 */
const PII_PATTERNS = [
  /(?:姓名|住院号|门诊号|病案号|身份证(?:号)?|联系电话|联系方式|家庭住址|家长姓名)[：:]\s*\S/,
  /(?<!\d)1[3-9]\d{9}(?!\d)/,
  /(?<!\d)\d{17}[\dXx](?!\d)/,
];

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 入参结构校验：类型不对直接抛错（400），字段缺失不在此处拦截（由预校验报告）。 */
export function parseDraftPayload(input: unknown): CaseDraftPayload {
  if (typeof input !== 'object' || input === null) throw new Error('INVALID_DRAFT_PAYLOAD');
  const raw = input as Record<string, unknown>;
  const caseId = normalizeText(raw.caseId);
  if (!caseId) throw new Error('CASE_ID_REQUIRED');
  const sections = (typeof raw.sections === 'object' && raw.sections !== null ? raw.sections : {}) as Record<string, unknown>;
  const payload: CaseDraftPayload = {
    caseId,
    age: normalizeText(raw.age) || undefined,
    sex: normalizeText(raw.sex) || undefined,
    complaint: normalizeText(raw.complaint) || undefined,
    sections: {
      history: normalizeText(sections.history) || undefined,
      exam: normalizeText(sections.exam) || undefined,
      tests: normalizeText(sections.tests) || undefined,
      diagnosis: normalizeText(sections.diagnosis) || undefined,
      plan: normalizeText(sections.plan) || undefined,
    },
  };
  if (typeof raw.vitals === 'object' && raw.vitals !== null) {
    const vitals = raw.vitals as Record<string, unknown>;
    payload.vitals = {
      temperature: typeof vitals.temperature === 'number' ? vitals.temperature : null,
      heartRate: typeof vitals.heartRate === 'number' ? vitals.heartRate : null,
      respiratoryRate: typeof vitals.respiratoryRate === 'number' ? vitals.respiratoryRate : null,
      spo2: typeof vitals.spo2 === 'number' ? vitals.spo2 : null,
    };
  }
  if (Array.isArray(raw.media)) {
    payload.media = raw.media.map((m) => {
      const item = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
      return { url: normalizeText(item.url) || undefined, caption: normalizeText(item.caption) || undefined };
    });
  }
  if (Array.isArray(raw.documents)) {
    payload.documents = raw.documents.map((d) => {
      const item = (typeof d === 'object' && d !== null ? d : {}) as Record<string, unknown>;
      return { source: normalizeText(item.source) || undefined, text: normalizeText(item.text) || undefined };
    });
  }
  return payload;
}

function joinDraftText(payload: CaseDraftPayload): string {
  return [payload.age, payload.sex, payload.complaint, payload.sections.history, payload.sections.exam,
    payload.sections.tests, payload.sections.diagnosis, payload.sections.plan,
    ...(payload.documents ?? []).map((d) => d.text ?? '')].filter(Boolean).join('\n');
}

export function normalizeDraftVersion(input: unknown): string {
  const version = normalizeText(input);
  if (!version) return 'v1';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(version)) throw new Error('INVALID_DRAFT_VERSION');
  return version;
}

function resolveCatalogEntry(caseId: string): { name: string; sourceMatch: CaseDraftPrecheckResult['sourceMatch']; aliasSourceId: string | null; aliasRelation: 'alias' | 'subtype' | null } {
  const link = TEACHER_CASE_LINKS[caseId];
  if (link) {
    const target = TEACHER_CASE_CATALOG.find((item) => item.id === link.sourceId);
    return { name: target?.name ?? caseId, sourceMatch: 'alias', aliasSourceId: link.sourceId, aliasRelation: link.relation };
  }
  const entry = TEACHER_CASE_CATALOG.find((item) => item.id === caseId);
  if (entry) return { name: entry.name, sourceMatch: 'catalog', aliasSourceId: null, aliasRelation: null };
  return { name: caseId, sourceMatch: 'unknown', aliasSourceId: null, aliasRelation: null };
}

/** 预校验：只报告，不补造。教师端据此决定是否保存。 */
export async function precheckDraft(accessToken: string, payload: CaseDraftPayload, draftVersion: string, options?: { desensitized?: boolean; mediaReviewed?: boolean }): Promise<CaseDraftPrecheckResult> {
  const catalog = resolveCatalogEntry(payload.caseId);
  const sectionFields: Record<keyof CaseDraftSectionPayload, boolean> = {
    history: Boolean(payload.sections.history),
    exam: Boolean(payload.sections.exam),
    tests: Boolean(payload.sections.tests),
    diagnosis: Boolean(payload.sections.diagnosis),
    plan: Boolean(payload.sections.plan),
  };
  const providedMap: Record<string, boolean> = {
    age: Boolean(payload.age), sex: Boolean(payload.sex), complaint: Boolean(payload.complaint), ...sectionFields,
  };
  const missingFields = REQUIRED_FIELDS.filter((f) => !providedMap[f.key]).map((f) => f.label);
  const desensitized = options?.desensitized ?? false;
  const mediaReviewed = options?.mediaReviewed ?? false;
  const mediaCount = (payload.media ?? []).filter((m) => m.url).length;
  const documentCount = (payload.documents ?? []).filter((d) => d.text).length;

  const issues: string[] = [];
  if (missingFields.length > 0) issues.push(`必填字段缺失 ${missingFields.length} 项：${missingFields.join('、')}`);
  if (catalog.sourceMatch === 'unknown') issues.push('这是独立新病例，将保存到待审核草稿；尚未加入学生病例库。');
  if (!desensitized && PII_PATTERNS.some((p) => p.test(joinDraftText(payload)))) {
    issues.push('正文疑似含未脱敏身份信息（姓名/证件号/电话等），保存前请确认脱敏状态');
  }
  if (mediaCount > 0 && !mediaReviewed) issues.push(`含 ${mediaCount} 项媒体引用但未确认媒体审核状态，学生不可见直至审核完成`);

  let duplicate = false;
  if (isDatabaseConfigured()) {
    const db = getSupabaseUserClient(accessToken);
    const { data } = await db.from('case_draft_imports').select('id').eq('case_id', payload.caseId).eq('draft_version', draftVersion).maybeSingle();
    duplicate = Boolean(data);
  }
  if (duplicate) issues.push(`本版本已保存，重复提交不会覆盖旧记录；请从病例草稿中打开后修改`);

  return {
    caseId: payload.caseId,
    caseName: catalog.name,
    aliasSourceId: catalog.aliasSourceId,
    aliasRelation: catalog.aliasRelation,
    sourceMatch: catalog.sourceMatch,
    missingFields,
    completeness: {
      requiredTotal: REQUIRED_FIELDS.length,
      provided: REQUIRED_FIELDS.length - missingFields.length,
      sectionFields,
    },
    desensitized,
    mediaReviewed,
    mediaCount,
    documentCount,
    issues,
    duplicate,
  };
}

/** 保存草稿：仅教师 JWT 可写（RLS），唯一约束冲突返回 DUPLICATE（不覆盖）。 */
export async function saveDraft(accessToken: string, payload: CaseDraftPayload, draftVersion: string, options?: { desensitized?: boolean; mediaReviewed?: boolean; sourceName?: string }): Promise<{ result: 'saved'; record: CaseDraftRecord } | { result: 'duplicate'; existingId: string }> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');
  const db = getSupabaseUserClient(accessToken);
  const precheck = await precheckDraft(accessToken, payload, draftVersion, options);
  const insert = await db.from('case_draft_imports').insert({
    case_id: payload.caseId,
    draft_version: draftVersion,
    source_name: options?.sourceName ?? precheck.caseName,
    source_kind: 'structured_json',
    alias_source_id: precheck.aliasSourceId,
    payload: payload as unknown as Record<string, unknown>,
    missing_fields: precheck.missingFields,
    completeness: precheck.completeness as unknown as Record<string, unknown>,
    desensitized: precheck.desensitized,
    media_reviewed: precheck.mediaReviewed,
    status: 'draft',
  }).select('id, case_id, draft_version, source_name, alias_source_id, status, desensitized, media_reviewed, missing_fields, completeness, payload, created_by, created_at').single();
  if (insert.error) {
    if (insert.error.code === '23505') {
      const existing = await db.from('case_draft_imports').select('id').eq('case_id', payload.caseId).eq('draft_version', draftVersion).maybeSingle();
      return { result: 'duplicate', existingId: existing.data?.id ?? '' };
    }
    throw new Error(insert.error.message);
  }
  const row = insert.data;
  const mediaCount = (payload.media ?? []).filter((m) => m.url).length;
  const documentCount = (payload.documents ?? []).filter((d) => d.text).length;
  return {
    result: 'saved',
    record: {
      id: row.id, caseId: row.case_id, caseName: row.source_name, draftVersion: row.draft_version,
      sourceName: row.source_name, sourceKind: 'structured_json', aliasSourceId: row.alias_source_id,
      status: row.status, desensitized: row.desensitized, mediaReviewed: row.media_reviewed,
      missingFields: row.missing_fields ?? [], completeness: row.completeness ?? {},
      mediaCount, documentCount, createdBy: row.created_by, createdAt: row.created_at,
    },
  };
}

/** 草稿列表（教师）：按病例分组不必要，直接倒序列出，附预校验摘要。 */
export async function listDrafts(accessToken: string, limit = 50): Promise<CaseDraftRecord[]> {
  if (!isDatabaseConfigured()) return [];
  const db = getSupabaseUserClient(accessToken);
  const { data, error } = await db.from('case_draft_imports')
    .select('id, case_id, draft_version, source_name, alias_source_id, status, desensitized, media_reviewed, missing_fields, completeness, payload, created_by, created_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id, caseId: row.case_id, caseName: row.source_name, draftVersion: row.draft_version,
    sourceName: row.source_name, sourceKind: 'structured_json', aliasSourceId: row.alias_source_id,
    status: row.status, desensitized: row.desensitized, mediaReviewed: row.media_reviewed,
    missingFields: row.missing_fields ?? [], completeness: row.completeness ?? {},
    mediaCount: Array.isArray((row.payload as Record<string, unknown>)?.media) ? ((row.payload as { media: unknown[] }).media.length) : 0,
    documentCount: Array.isArray((row.payload as Record<string, unknown>)?.documents) ? ((row.payload as { documents: unknown[] }).documents.length) : 0,
    createdBy: row.created_by, createdAt: row.created_at,
  }));
}

/** 草稿详情（教师）。 */
export async function getDraft(accessToken: string, draftId: string): Promise<CaseDraftDetail | null> {
  if (!isDatabaseConfigured()) return null;
  const db = getSupabaseUserClient(accessToken);
  const { data, error } = await db.from('case_draft_imports')
    .select('id, case_id, draft_version, source_name, alias_source_id, status, desensitized, media_reviewed, missing_fields, completeness, payload, created_by, created_at')
    .eq('id', draftId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id, caseId: data.case_id, caseName: data.source_name, draftVersion: data.draft_version,
    sourceName: data.source_name, sourceKind: 'structured_json', aliasSourceId: data.alias_source_id,
    status: data.status, desensitized: data.desensitized, mediaReviewed: data.media_reviewed,
    missingFields: data.missing_fields ?? [], completeness: data.completeness ?? {},
    mediaCount: Array.isArray((data.payload as Record<string, unknown>)?.media) ? ((data.payload as { media: unknown[] }).media.length) : 0,
    documentCount: Array.isArray((data.payload as Record<string, unknown>)?.documents) ? ((data.payload as { documents: unknown[] }).documents.length) : 0,
    createdBy: data.created_by, createdAt: data.created_at,
    payload: data.payload as unknown as CaseDraftPayload,
  };
}
