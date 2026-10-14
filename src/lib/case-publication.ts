import { getSupabaseUserClient, isDatabaseConfigured } from '@/lib/supabase-client';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';

/**
 * 教师单例上下架（发布状态）读取与守卫：
 * - 语义（与迁移 20261014100000 一致）：case_publication 无行 = 已发布（缺省开放）；
 *   published=false 行 = 教师已下架。下架是可恢复停用：不删原文/历史会话/成绩。
 * - 学生守卫范围：仅拦截"新建训练会话"与"病例目录展示"；既有会话恢复、
 *   教师访问不受影响（教师始终可预览与复核）。
 * - 幂等初始化（facts/answers 导入）不写本表，教师的下架决定不会被重置。
 */

export interface CasePublicationRow {
  caseId: string;
  published: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  reason: string;
  /** 缺少原始接诊资料（folder=null 目录条目）：教师列表展示提示，不影响上下架能力。 */
  missingSource: boolean;
}

/** 读取全部下架病例 ID（published=false 的行）。无行/无权限/预览态返回空集合。
 *  教师与学生均可读（RLS：authenticated select using(true)，仅状态无患者原文）。 */
export async function getUnpublishedCaseIds(accessToken: string | null): Promise<Set<string>> {
  if (!accessToken || !isDatabaseConfigured()) return new Set();
  const db = getSupabaseUserClient(accessToken);
  const { data, error } = await db.from('case_publication').select('case_id').eq('published', false);
  if (error) throw error;
  return new Set(((data ?? []) as Array<{ case_id: string }>).map((row) => row.case_id));
}

/** 学生新建会话守卫：teacher- 病例已下架时抛 CASE_UNPUBLISHED（教师豁免，可继续预览复核）。
 *  豁免判定 = 应用层教师角色 OR 数据库白名单（app_is_teacher RPC，与 RLS 谓词同一函数）：
 *  超星登录教师通常应用层 role='teacher'；白名单教师（如 app_metadata 未标记的探针）
 *  由数据库判定豁免。非 teacher- 病例、预览态（无 DB）直接放行。 */
export async function assertCasePublishedForNewSession(caseId: string | undefined, role: string, accessToken: string | null): Promise<void> {
  if (!caseId?.startsWith('teacher-')) return;
  if (role === 'teacher') return;
  if (accessToken && (await isTeacherByWhitelist(accessToken))) return;
  const unpublished = await getUnpublishedCaseIds(accessToken);
  if (unpublished.has(caseId)) throw new Error('CASE_UNPUBLISHED');
}

/** 教师端：目录病例 + 发布状态对照（供上下架面板）。
 *  目录有效性 = 存在于教师病例目录（TEACHER_CASE_CATALOG）；folder=null 的 catalog-only
 *  条目同样纳入管理（可上下架），并以 missingSource 标记"缺少原始接诊资料"。
 *  未知 ID（不在目录中）仍由 setCasePublication 拒绝。 */
export async function getCasePublicationOverview(accessToken: string): Promise<CasePublicationRow[]> {
  const db = getSupabaseUserClient(accessToken);
  const { data, error } = await db.from('case_publication').select('case_id,published,updated_at,updated_by,reason');
  if (error) throw error;
  const byId = new Map(((data ?? []) as Array<{ case_id: string; published: boolean; updated_at: string | null; updated_by: string | null; reason: string }>).map((row) => [row.case_id, row]));
  return TEACHER_CASE_CATALOG.map((item) => {
    const row = byId.get(item.id);
    return {
      caseId: item.id,
      published: row ? row.published : true,
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by ?? null,
      reason: row?.reason ?? '',
      missingSource: !item.folder,
    };
  });
}

/** 教师端：上架/下架写入（upsert 单行；updated_by 记录操作教师，保留审计痕迹）。
 *  目录有效性 = 存在于教师病例目录；folder=null 的 catalog-only 条目同样可上下架
 *  （缺原始资料的目录病例需要可恢复停用）。未知 ID（不在目录中）拒绝 CASE_NOT_FOUND。
 *  该放宽仅适用于发布管理，不适用于病例导入（无资料病例依旧不能导入）。 */
export async function setCasePublication(accessToken: string, teacherId: string, caseId: string, published: boolean, reason: string): Promise<CasePublicationRow> {
  const inCatalog = TEACHER_CASE_CATALOG.some((item) => item.id === caseId);
  if (!inCatalog) throw new Error('CASE_NOT_FOUND');
  const db = getSupabaseUserClient(accessToken);
  const { error } = await db.from('case_publication').upsert(
    { case_id: caseId, published, updated_by: teacherId, updated_at: new Date().toISOString(), reason },
    { onConflict: 'case_id' },
  );
  if (error) throw error;
  return { caseId, published, updatedAt: new Date().toISOString(), updatedBy: teacherId, reason, missingSource: TEACHER_CASE_CATALOG.find((item) => item.id === caseId)?.folder == null };
}
