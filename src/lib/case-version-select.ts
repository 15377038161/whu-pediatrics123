import { getLocalImportVersion } from '@/lib/teacher-case-import';
import { getSnapshotVersion, getDatabaseSnapshotVersion, restoreCaseSnapshotFacts } from '@/lib/case-snapshot';

/**
 * 教师病例会话版本选择（权威稳定序，防止完整本地材料被绑定零散召回指纹）：
 * 1) local：本地完整审核内容哈希（受控 53 JSON 的 documents sha256 聚合指纹）——权威版本；
 * 2) db：教师导入通道写入 case_snapshot_facts 的最新完整版本（冷启动场景）；
 * 3) recall：知识库召回快照指纹（可能不完整）——仅兜底。
 * 旧会话不受影响：getSession 按会话已绑定版本恢复，保持不漂移。
 * 全部不可用返回 null（会话走"资料不足"，不回退漂移数据换患者）。
 *
 * 依赖经 deps 注入：单测注入假实现，repository 使用默认真实实现。
 */

export interface CaseVersionDeps {
  getLocalImportVersion: (caseId: string) => string | null;
  getSnapshotVersion: (caseId: string) => string | null;
  getDatabaseSnapshotVersion: (caseId: string, accessToken: string | null) => Promise<string | null>;
  restoreCaseSnapshotFacts: (caseId: string, version: string, accessToken: string | null, role?: string, sessionId?: string) => Promise<unknown>;
}

export const defaultCaseVersionDeps: CaseVersionDeps = {
  getLocalImportVersion,
  getSnapshotVersion,
  getDatabaseSnapshotVersion,
  restoreCaseSnapshotFacts,
};

export interface VersionResolution {
  /** 选定的版本指纹；null=无可用完整版本（资料不足）。 */
  version: string | null;
  /** 版本来源：local=本地完整审核哈希 / db=教师导入版本 / recall=召回快照 / null=无。 */
  source: 'local' | 'db' | 'recall' | null;
  /** 冷启动场景（本地缺失，绑定 DB 导入版本，需要后续恢复事实）。 */
  coldStart: boolean;
}

export interface VersionSelectOptions {
  accessToken: string | null;
  role: string;
  isPreview: boolean;
}

export async function resolveTeacherCaseVersion(caseId: string, options: VersionSelectOptions, deps: CaseVersionDeps = defaultCaseVersionDeps): Promise<VersionResolution> {
  const local = deps.getLocalImportVersion(caseId);
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
