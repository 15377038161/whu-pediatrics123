import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { recordSchema, getKnowledgeRoot, type TeacherCaseData } from '@/lib/teacher-case-data';

/**
 * 教师病例导入：将本地受控交接产物的运行时教学事实（knowledge/teaching-cases/*.json）
 * 以教师身份双写持久缓存（case_snapshot_facts + case_snapshot_answers）。
 *
 * 边界与安全约束：
 * - 读取全部发生在服务端（Next.js API Route 进程内），客户端零患者原文传输；
 * - 写库走教师身份（getSupabaseUserClient(accessToken)），行级权限由 RLS
 *   （app_is_teacher）判定，匿名/学生调用被数据库拒绝——应用层双校验之外
 *   数据库侧兜底；
 * - 版本指纹：与 case-snapshot 召回快照同一算法（documents sha256 聚合哈希，
 *   截 16 位）。导入版本与会话绑定/恢复链路完全兼容；
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

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 与 case-snapshot buildSnapshot 一致的版本算法：documents sha256 聚合哈希截 16 位。 */
export function computeImportVersion(record: TeacherCaseData): string {
  const shas = record.documents.map((doc) => doc.sha256).sort();
  return sha256(shas.join('\n')).slice(0, 16);
}

/** 教学事实载荷（不含诊断/诊疗经过/原文/媒体）：学生经受控 RPC 可读形态。 */
function buildFactsPayload(record: TeacherCaseData) {
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

interface ImportOptions {
  /** 限定病例列表（缺省=目录内全部 JSON）。 */
  only?: string[];
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
    try {
      // facts：同版本已存在则幂等跳过（unchanged），否则新增（imported）
      const { data: existing, error: selectError } = await db
        .from('case_snapshot_facts')
        .select('version')
        .eq('case_id', caseId)
        .eq('version', version)
        .maybeSingle();
      if (selectError) throw selectError;
      if (existing) {
        results.push({ caseId, status: 'unchanged', version });
        continue;
      }
      const { error: factsError } = await db
        .from('case_snapshot_facts')
        .upsert(
          { case_id: caseId, version, source_name: record.sourceName, facts: buildFactsPayload(record) },
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
