import admissionSummaries from '@/domain/admission-summaries.json';
import { CASE_INDEX_NUMBER, TEACHER_CASE_CATALOG, type TeacherCaseCatalogItem } from '@/domain/teacher-case-catalog';
import { CASE_PUBLIC_IDS } from '@/lib/case-identity';

/**
 * 教师端「编号+诊断+完整主诉」统一索引视图（批次 2）。
 *
 * 安全边界（CRITICAL）：本模块依赖 CASE_PUBLIC_IDS（teacher-id ↔ case-uuid 防透题映射），
 * 仅允许在服务端调用（API Route / Server Component）；严禁被客户端组件以值导入方式
 * 引用，否则映射表会进入客户端 bundle 造成透题。客户端只经 /api/teacher/case-index
 * 拿聚合结果，条目仅含教师目录 id（teacher-<病名>），不含 case-uuid。
 */

const summaries: Record<string, { age: string; sex: string; complaint: string }> = admissionSummaries;

/** 教师端索引视图条目：编号+诊断+完整主诉三要素 + 既有核对元数据。 */
export interface TeacherCaseIndexEntry {
  /** 教师目录 id（teacher-<病名>），详情页跳转键。 */
  id: string;
  /** 病例编号；编号失联 → null（渲染 #—）。 */
  indexNumber: number | null;
  /** 诊断（目录病名）；病名缺失/空白 → null（渲染「诊断待确认」）。 */
  diagnosis: string | null;
  /** 完整主诉（接诊摘要）；主诉映射失联或空白 → null（渲染「主诉待补充」）。 */
  complaint: string | null;
  category: string;
  status: TeacherCaseCatalogItem['status'];
  source: TeacherCaseCatalogItem['source'];
  mediaCount: number;
  documentCount: number;
}

/**
 * 「诊断待确认」回退规则（三槽位独立失联回退，纯函数便于负测覆盖）：
 * - 诊断：目录病名缺失/空白 → diagnosis=null（教师索引不再回退显示 id）；
 * - 主诉：映射失联或 complaint 空白 → complaint=null；
 * - 编号：CASE_INDEX_NUMBER 无该条目 → indexNumber=null。
 */
export function resolveTeacherCaseIndexEntry(
  item: TeacherCaseCatalogItem,
  complaint: string | null,
): TeacherCaseIndexEntry {
  const numberValue = CASE_INDEX_NUMBER[item.id];
  return {
    id: item.id,
    indexNumber: typeof numberValue === 'number' ? numberValue : null,
    diagnosis: item.name.trim() === '' ? null : item.name,
    complaint: complaint !== null && complaint.trim() !== '' ? complaint : null,
    category: item.category,
    status: item.status,
    source: item.source,
    mediaCount: item.mediaCount,
    documentCount: item.documentCount,
  };
}

function complaintFor(teacherId: string): string | null {
  const publicId = CASE_PUBLIC_IDS[teacherId];
  if (!publicId) return null;
  return summaries[publicId]?.complaint ?? null;
}

/** 聚合全部教师病例索引条目（顺序与教师目录一致）。 */
export function buildTeacherCaseIndex(): TeacherCaseIndexEntry[] {
  return TEACHER_CASE_CATALOG.map((item) => resolveTeacherCaseIndexEntry(item, complaintFor(item.id)));
}

/** 按教师目录 id 取单条（教师病例详情页复用）；目录无此 id 返回 null。 */
export function getTeacherCaseIndexEntry(id: string): TeacherCaseIndexEntry | null {
  const item = TEACHER_CASE_CATALOG.find((entry) => entry.id === id);
  if (!item) return null;
  return resolveTeacherCaseIndexEntry(item, complaintFor(item.id));
}
