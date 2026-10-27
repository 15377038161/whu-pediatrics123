import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { recordSchema, getKnowledgeRoot, type TeacherCaseData } from '@/lib/teacher-case-data';
import { computeCaseDataVersion } from '@/lib/case-data-version';

/**
 * 教师病例导入：将本地受控交接产物的运行时教学事实（knowledge/teaching-cases/*.json）
 * 以教师身份双写持久缓存（case_snapshot_facts + case_snapshot_answers）。
 *
 * 边界与安全约束：
 * - 读取全部发生在服务端（Next.js API Route 进程内），客户端零患者原文传输；
 * - 写库走教师身份（getSupabaseUserClient(accessToken)），行级权限由 RLS
 *   （app_is_teacher）判定，匿名/学生调用被数据库拒绝——应用层双校验之外
 *   数据库侧兜底；
 * - 版本指纹：与本地读取/召回快照共用完整病例内容指纹（算法 v2，16 位）。
 *   固定事实或文档内容改变即换版，原件哈希不变不再掩盖字段修订；
 * - upsert ignoreDuplicates：同 (case_id, version) 幂等，不覆盖已装载版本，
 *   不替换完整事实；版本不同则新增行，互不干扰；
 * - 不修改原件、不上传原文到第三方、不创建新表/新权限；
 * - 客户端不传 role、不传病例内容：role 由服务端 getUser 判定，内容仅来自
 *   服务端本地文件（教师导入的是教师已审核的受控产物，非用户自由文本）。
 */

export type ImportStatus =
  | 'imported'
  | 'unchanged'
  | 'skipped_missing_file'
  | 'skipped_invalid_schema'
  | 'skipped_not_in_catalog'
  | 'failed';

export interface ImportCaseResult {
  caseId: string;
  status: ImportStatus;
  version?: string;
  detail?: string;
}

export interface ImportSummary {
  total: number;
  imported: number;
  unchanged: number;
  skipped: number;
  failed: number;
  results: ImportCaseResult[];
}

/** Opaque version key shared with the local reader and recall snapshot builder. */
export function computeImportVersion(record: TeacherCaseData): string {
  return computeCaseDataVersion(record);
}

/** 本地完整审核版本：读本地受控产物 JSON 并计算内容哈希（完整审核来源的权威稳定版本）。
 *  文件缺失/schema 无效返回 null（调用方按版本选择规则降级）。
 *  与导入写入 DB 的版本同算法：本地存在即与 DB 导入版本一致，新会话直接绑定权威版本。 */
export function getLocalImportVersion(caseId: string): string | null {
  const sourceId = decodeURIComponent(caseId);
  if (!TEACHER_CASE_CATALOG.some((item) => item.id === sourceId)) return null;
  try {
    const file = path.join(getKnowledgeRoot(), 'teaching-cases', `${sourceId}.json`);
    const record = recordSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    if (record.caseId !== sourceId) return null;
    return computeImportVersion(record);
  } catch {
    return null;
  }
}

/** 教学事实载荷（不含诊断/诊疗经过/原文/媒体）：学生经受控 RPC 可读形态。
 *  导出供受控初始化生成器复用（同一 payload 形态，保证 DB 行与教师导入通道完全一致）。 */
export function buildFactsPayloadForInit(record: TeacherCaseData) {
  return {
    caseId: record.caseId,
    sourceName: record.sourceName,
    sourceDocument: record.sourceDocument,
    age: record.age,
    sex: record.sex,
    complaint: record.complaint,
    sections: { history: record.sections.history, exam: record.sections.exam, tests: record.sections.tests },
    vitals: record.vitals,
  };
}

/** Private, version-bound metadata. Never put this object into student facts. */
export function buildBindingConfigForInit(record: Pick<TeacherCaseData, 'testMedia' | 'examMedia' | 'testRelease'>) {
  if (record.testMedia === undefined && record.examMedia === undefined && record.testRelease === undefined) return null;
  return {
    testMedia: record.testMedia ?? [],
    examMedia: record.examMedia ?? [],
    testRelease: record.testRelease ?? [],
  };
}

interface ImportOptions {
  /** 限定病例列表（缺省=目录内全部 JSON）。 */
  only?: string[];
}

export interface CaseImportDiagnostic {
  caseId: string;
  localVersion: string | null;
  dbVersion: string | null;
  /** imported=本地与DB同版本已装载；pending=本地有DB无；missing_local=本地缺失（冷启动场景）；no_source=两者皆无（资料不足）。 */
  status: 'loaded' | 'pending' | 'missing_local' | 'no_source';
}

export interface ImportDiagnostic {
  total: number;
  loaded: number;
  pending: number;
  missingLocal: number;
  noSource: number;
  /** 教师侧健康计数（case_knowledge_health_counts RPC，仅教师可执行）。 */
  counts: { persistedFactsVersions: number | null; persistedAnswerVersions: number | null; boundTeacherSessions: number | null };
  cases: CaseImportDiagnostic[];
}

/** 仅教师诊断：本地完整审核版本与 DB 导入版本覆盖对照（不含任何患者原文/密钥，仅版本指纹与状态枚举）。 */
export async function diagnoseTeacherCaseImport(accessToken: string): Promise<ImportDiagnostic> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');
  const db = getSupabaseUserClient(accessToken);
  // DB 侧全部已装载版本指纹（教师 RLS 直读，仅 case_id/version 两列）
  const { data: dbRows, error } = await db.from('case_snapshot_facts').select('case_id,version');
  if (error) throw error;
  const dbLatest = new Map<string, string>();
  for (const row of (dbRows ?? []) as Array<{ case_id: string; version: string }>) {
    const current = dbLatest.get(row.case_id);
    if (!current || row.version > current) dbLatest.set(row.case_id, row.version);
  }
  // 教师健康计数（收紧后 RPC：app_is_teacher 守卫，非教师返回 null）
  let counts: ImportDiagnostic['counts'] = { persistedFactsVersions: null, persistedAnswerVersions: null, boundTeacherSessions: null };
  try {
    const { data: rpcData } = await db.rpc('case_knowledge_health_counts');
    if (rpcData && typeof rpcData === 'object') {
      const raw = rpcData as { persisted_facts_versions?: number; persisted_answer_versions?: number; bound_teacher_sessions?: number };
      counts = {
        persistedFactsVersions: Number(raw.persisted_facts_versions ?? 0),
        persistedAnswerVersions: Number(raw.persisted_answer_versions ?? 0),
        boundTeacherSessions: Number(raw.bound_teacher_sessions ?? 0),
      };
    }
  } catch {
    // RPC 异常保持 null，如实显示未知
  }
  // 本地侧：catalog 53 例逐例解析本地版本指纹
  const cases: CaseImportDiagnostic[] = TEACHER_CASE_CATALOG
    .filter((item) => item.folder)
    .map((item) => {
      const localVersion = getLocalImportVersion(item.id);
      const dbVersion = dbLatest.get(item.id) ?? null;
      const status: CaseImportDiagnostic['status'] =
        localVersion && dbVersion === localVersion ? 'loaded'
        : localVersion && !dbVersion ? 'pending'
        : !localVersion && dbVersion ? 'missing_local'
        : 'no_source';
      return { caseId: item.id, localVersion, dbVersion, status };
    });
  return {
    total: cases.length,
    loaded: cases.filter((c) => c.status === 'loaded').length,
    pending: cases.filter((c) => c.status === 'pending').length,
    missingLocal: cases.filter((c) => c.status === 'missing_local').length,
    noSource: cases.filter((c) => c.status === 'no_source').length,
    counts,
    cases,
  };
}

/** 教师导入主流程：读本地 JSON → schema 校验 → 版本指纹 → 教师身份双写持久缓存。 */
export async function importTeacherCases(accessToken: string, options?: ImportOptions): Promise<ImportSummary> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');
  const db = getSupabaseUserClient(accessToken);

  const dir = path.join(getKnowledgeRoot(), 'teaching-cases');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return { total: 0, imported: 0, unchanged: 0, skipped: 0, failed: 0, results: [] };
  }

  const results: ImportCaseResult[] = [];
  for (const file of files) {
    const caseId = file.replace(/\.json$/, '');
    if (options?.only?.length && !options.only.includes(caseId)) continue;
    if (!TEACHER_CASE_CATALOG.some((item) => item.id === caseId)) {
      results.push({ caseId, status: 'skipped_not_in_catalog' });
      continue;
    }
    let record: TeacherCaseData;
    try {
      record = recordSchema.parse(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
    } catch (error) {
      results.push({ caseId, status: 'skipped_invalid_schema', detail: (error as Error).message });
      continue;
    }
    if (record.caseId !== caseId) {
      results.push({ caseId, status: 'skipped_invalid_schema', detail: '文件名与 caseId 不一致' });
      continue;
    }
    const version = computeImportVersion(record);
    const bindingConfig = buildBindingConfigForInit(record);
    try {
      // Probe the private column before writing facts. A missing migration must not
      // leave a fresh facts-only row that a retry later mistakes for a complete import.
      let persistedBindings: ReturnType<typeof buildBindingConfigForInit> = null;
      if (bindingConfig) {
        const { data: answer, error } = await db.from('case_snapshot_answers')
          .select('binding_config').eq('case_id', caseId).eq('version', version).maybeSingle();
        if (error) throw error;
        if (answer?.binding_config) {
          const parsed = recordSchema.pick({ testMedia: true, examMedia: true, testRelease: true }).parse(answer.binding_config);
          persistedBindings = buildBindingConfigForInit(parsed);
          if (JSON.stringify(persistedBindings) !== JSON.stringify(bindingConfig)) throw new Error('SNAPSHOT_BINDING_CONFIG_MISSING_OR_CONFLICT');
        }
      }
      // facts：同版本已存在则幂等跳过（unchanged），否则新增（imported）
      const { data: existing, error: selectError } = await db
        .from('case_snapshot_facts')
        .select('version')
        .eq('case_id', caseId)
        .eq('version', version)
        .maybeSingle();
      if (selectError) throw selectError;
      if (existing) {
        if (bindingConfig) {
          // The old importer could already have written this version while dropping metadata.
          // Do not silently reinterpret a historical version or call that state unchanged.
          if (!persistedBindings) throw new Error('SNAPSHOT_BINDING_CONFIG_MISSING_OR_CONFLICT');
        }
        results.push({ caseId, status: 'unchanged', version });
        continue;
      }
      const { error: factsError } = await db
        .from('case_snapshot_facts')
        .upsert(
          { case_id: caseId, version, source_name: record.sourceName, facts: buildFactsPayloadForInit(record) },
          { onConflict: 'case_id,version', ignoreDuplicates: true },
        );
      if (factsError) throw factsError;
      // answers：诊断/诊疗经过/原文分片（仅教师可读）
      const { error: answersError } = await db
        .from('case_snapshot_answers')
        .upsert(
          {
            case_id: caseId,
            version,
            diagnosis: record.sections.diagnosis,
            plan: record.sections.plan,
            documents: record.documents,
            media: [],
            ...(bindingConfig ? { binding_config: bindingConfig } : {}),
          },
          { onConflict: 'case_id,version', ignoreDuplicates: true },
        );
      if (answersError) throw answersError;
      results.push({ caseId, status: 'imported', version });
    } catch (error) {
      results.push({ caseId, status: 'failed', version, detail: (error as Error).message });
    }
  }

  const imported = results.filter((r) => r.status === 'imported').length;
  const unchanged = results.filter((r) => r.status === 'unchanged').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.length - imported - unchanged - failed;
  return { total: results.length, imported, unchanged, skipped, failed, results };
}
