import { getPublicCase, resolveCaseId } from '@/lib/case-identity';
// 服务端接诊信息：只从受控病例事实取主诉，不把诊断目录导入客户端。
import { CASE_CATALOG, type PublicCaseProfile } from '@/domain/case-catalog';
import { isScorableCase } from '@/domain/case-classification';
import { verifiedComplaint } from '@/lib/admission-complaint';
export { verifiedComplaint } from '@/lib/admission-complaint';
import { getTeacherSourceId, readTeacherCaseData } from '@/lib/teacher-case-data';
import { getCachedSnapshot, getDatabaseSnapshotVersion, getSnapshotVersion } from '@/lib/case-snapshot';
import { getLocalImportVersion } from '@/lib/teacher-case-import';


export function admissionProfile(profile: PublicCaseProfile): PublicCaseProfile {
  if (!resolveCaseId(profile.id).startsWith('teacher-')) return profile;
  const source = readTeacherCaseData(resolveCaseId(profile.id));
  const complaint = verifiedComplaint(source);
  if (!source || !complaint) return profile;
  const sex = source.sex === '男' ? '男童' : source.sex === '女' ? '女童' : '患儿';
  return { ...profile, title: `${source.age}${sex}，${complaint}`, presentingSymptoms: [complaint],
    age: source?.age || '待核验', sex: source?.sex === '男' || source?.sex === '女' ? source.sex : '待核验' };
}

export interface AdmissionCandidate { caseId: string; sourceId: string }
/** 目录级资格池：只依赖公开目录字段，不读取病例事实。
 *  部署环境 knowledge/ 不入库（localFiles=missing），事实在 DB 快照/对象存储里，
 *  同步读不到并不代表病例不可用；若在这里按 sourceFacts 过滤，专项/OSCE 会整池为空。
 *  真实可玩性由 pickPlayableAdmission 在选中后按本地/缓存/DB 版本探测。 */
export function eligibleAdmissions(unpublished: ReadonlySet<string>): AdmissionCandidate[] {
  return CASE_CATALOG.flatMap(profile => {
    const caseId = resolveCaseId(profile.id);
    if (unpublished.has(caseId) || profile.contentStatus === 'demo-pending-review') return [];
    // 资料不足（无独立材料且无源关联）仍不得进入可评分测试。
    if (!isScorableCase(profile)) return [];
    return [{ caseId, sourceId: getTeacherSourceId(caseId) }];
  });
}

// 随机抽取前先滤除资料不足病例，把 OSCE/专项的可评分守卫前移，避免学生抽中后才死路（CASE_INSUFFICIENT）。
export function scorableAdmissions(candidates: AdmissionCandidate[]): AdmissionCandidate[] {
  return candidates.filter(candidate => {
    try {
      return isScorableCase(getPublicCase(candidate.caseId));
    } catch {
      return false;
    }
  });
}

/** 选中病例后探测是否真的能取到完整版本：本地导入 > 进程内快照 > DB 持久版本。
 *  与建会话时的版本选择链同源，但只返回布尔，不读取/下发任何病例内容。
 *  探测失败（网络/权限）按不可用处理，调用方会换一例；全部失败时保留原抽中项，
 *  不把一次 DB 抖动变成「暂无病例」。 */
export async function hasResolvableCaseSource(candidate: AdmissionCandidate, accessToken: string | null): Promise<boolean> {
  if (getLocalImportVersion(candidate.sourceId)) return true;
  if (getSnapshotVersion(candidate.caseId)) return true;
  if (getCachedSnapshot(candidate.caseId)) return true;
  return Boolean(await getDatabaseSnapshotVersion(candidate.caseId, accessToken));
}

export function selectAdmission(candidates: AdmissionCandidate[], excludedCase?: string, allowRepeat = false, random = Math.random): string {
  // 合并同源别名，不让同一份病历因目录条目较多而提高抽中概率。
  const bySource = new Map(candidates.map(item => [item.sourceId, item.caseId]));
  const excludedSource = excludedCase ? getTeacherSourceId(excludedCase) : null;
  const available = [...bySource].filter(([source]) => source !== excludedSource);
  if (!bySource.size) throw new Error('NO_ELIGIBLE_CASE');
  if (!available.length) {
    if (allowRepeat) return [...bySource.values()][0];
    throw new Error('ONLY_CURRENT_CASE');
  }
  return available[Math.min(available.length - 1, Math.floor(random() * available.length))][1];
}
