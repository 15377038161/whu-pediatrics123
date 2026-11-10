import { getLocalImportVersion } from '@/lib/teacher-case-import';
import { getSnapshotVersion, getDatabaseSnapshotVersion, restoreCaseSnapshotFacts } from '@/lib/case-snapshot';
import { getActiveCaseVersion } from '@/lib/case-active-version';
import {verifiedRecoveredSourceVersion} from '@/lib/teaching-package-store';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';

/**
 * 教师病例会话版本选择（权威稳定序，防止完整本地材料被绑定零散召回指纹）：
 * 1) local：本地固定事实与原文的完整内容指纹（case-data-version，算法v2）——权威版本；
 * 2) db：教师导入通道写入 case_snapshot_facts 的最新完整版本（冷启动场景）；
 * 3) recall：知识库召回快照指纹（可能不完整）——仅兜底。
 * 旧会话不受影响：getSession 按会话已绑定版本恢复，保持不漂移。
 * 全部不可用返回 null（会话走"资料不足"，不回退漂移数据换患者）。
 *
 * 依赖经 deps 注入：单测注入假实现，repository 使用默认真实实现。
 */

export interface CaseVersionDeps {
  getActiveCaseVersion: (caseId: string, accessToken: string) => Promise<string | null>;
  getLocalImportVersion: (caseId: string) => string | null;
  getSnapshotVersion: (caseId: string) => string | null;
  getDatabaseSnapshotVersion: (caseId: string, accessToken: string | null) => Promise<string | null>;
  restoreCaseSnapshotFacts: (caseId: string, version: string, accessToken: string | null, role?: string, sessionId?: string) => Promise<unknown>;
}

export const defaultCaseVersionDeps: CaseVersionDeps = {
  getActiveCaseVersion,
  getLocalImportVersion:caseId=>getLocalImportVersion(caseId)??verifiedRecoveredSourceVersion(caseId),
  getSnapshotVersion,
  getDatabaseSnapshotVersion,
  restoreCaseSnapshotFacts,
};

export interface VersionResolution {
  /** 选定的版本指纹；null=无可用完整版本（资料不足）。 */
  version: string | null;
  /** 版本来源：local=本地完整审核哈希 / db=教师导入版本 / recall=召回快照 / null=无。 */
  source: 'active' | 'local' | 'db' | 'recall' | null;
  /** 冷启动场景（本地缺失，绑定 DB 导入版本，需要后续恢复事实）。 */
  coldStart: boolean;
}

export interface VersionSelectOptions {
  accessToken: string | null;
  role: string;
  isPreview: boolean;
}

export async function resolveTeacherCaseVersion(caseId: string, options: VersionSelectOptions, deps: CaseVersionDeps = defaultCaseVersionDeps): Promise<VersionResolution> {
  // 仅用于本地私有教学代次验收：显式开启时，新会话优先绑定本地完整来源及其教学包。
  // 默认（包括生产）仍优先数据库活动版本；旧会话始终按原绑定版本读取，不经过此选择器。
  const preferLocal = process.env.PEDIATRICS_TRAINING_PREFER_LOCAL === '1';
  if (!preferLocal && !options.isPreview && options.accessToken) {
    const active = await deps.getActiveCaseVersion(caseId, options.accessToken);
    if (active) {
      const local = deps.getLocalImportVersion(caseId);
      if (local === active) return { version: active, source: 'active', coldStart: false };
      if (options.role === 'teacher') {
        const restored = await deps.restoreCaseSnapshotFacts(caseId, active, options.accessToken, 'teacher');
        if (!restored) throw new Error('CASE_ACTIVE_VERSION_UNAVAILABLE');
      }
      return { version: active, source: 'active', coldStart: true };
    }
  }
  const decodedCaseId = decodeURIComponent(caseId);
  const localLookupId = preferLocal ? TEACHER_CASE_LINKS[decodedCaseId]?.sourceId ?? decodedCaseId : caseId;
  const local = deps.getLocalImportVersion(localLookupId);
  if (local) return { version: local, source: 'local', coldStart: false };
  if (!options.isPreview && options.accessToken) {
    const dbVersion = await deps.getDatabaseSnapshotVersion(caseId, options.accessToken);
    if (dbVersion) {
      // 教师直读恢复（RLS app_is_teacher 放行）写入进程缓存，供随后 createInitialSession 使用
      if (options.role === 'teacher') {
        await deps.restoreCaseSnapshotFacts(caseId, dbVersion, options.accessToken, 'teacher');
      }
      return { version: dbVersion, source: 'db', coldStart: true };
    }
  }
  const recall = deps.getSnapshotVersion(caseId);
  if (recall) return { version: recall, source: 'recall', coldStart: false };
  return { version: null, source: null, coldStart: false };
}
