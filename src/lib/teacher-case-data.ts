import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';
import { getCachedSnapshot } from '@/lib/case-snapshot';

export const recordSchema = z.object({
  caseId: z.string(), sourceName: z.string(), sourceDocument: z.string(),
  age: z.string(), sex: z.string(), complaint: z.string(),
  sections: z.object({ history: z.string(), exam: z.string(), tests: z.string(), diagnosis: z.string(), plan: z.string() }),
  vitals: z.object({ temperature: z.number().nullable(), heartRate: z.number().nullable(), respiratoryRate: z.number().nullable(), spo2: z.number().nullable() }),
  documents: z.array(z.object({ source: z.string(), text: z.string(), sha256: z.string() })),
});
export type TeacherCaseData = z.infer<typeof recordSchema>;

export function getTeacherSourceId(caseId: string): string {
  const decoded = decodeURIComponent(caseId);
  return TEACHER_CASE_LINKS[decoded]?.sourceId ?? decoded;
}

export function getKnowledgeRoot(): string {
  return path.resolve(process.env.PEDIATRICS_KNOWLEDGE_ROOT || [process.cwd(), 'knowledge'].join(path.sep));
}

/** 与 teacher-case-import/case-snapshot 同一算法：documents sha256 聚合哈希截 16 位。
 *  readTeacherCaseData 同步路径需独立计算本地版本指纹，用于会话绑定版本一致性校验。 */
function computeLocalVersion(record: TeacherCaseData): string {
  const shas = record.documents.map((doc) => doc.sha256).sort();
  return createHash('sha256').update(shas.join('\n')).digest('hex').slice(0, 16);
}

export function readTeacherCaseData(caseId: string, version?: string | null): TeacherCaseData | null {
  const sourceId = getTeacherSourceId(caseId);
  if (!TEACHER_CASE_CATALOG.some((item) => item.id === sourceId && item.folder)) return null;
  try {
    const file = path.join(getKnowledgeRoot(), 'teaching-cases', `${sourceId}.json`);
    const record = recordSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    if (record.caseId !== sourceId) return null;
    // 本地文件存在但版本已绑定：本地当前版本与绑定版本一致才直接使用本地完整事实；
    // 不一致（本地内容已修订）时优先恢复绑定版本的进程内缓存快照（同事实集合），
    // 缓存无该版本（重启后过期/未预热）则返回 null（资料不足），
    // 绝不返回新版本地数据换患者事实——与 ENOENT 分支同一防漂移语义。
    if (!version || computeLocalVersion(record) === version) return record;
    const pinned = getCachedSnapshot(sourceId, version);
    if (!pinned) return null;
    const parsed = recordSchema.safeParse(pinned);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // 本地 teaching-cases 快照缺失（部署环境 knowledge/ 不入库）：
      // 回退到进程内知识库召回快照（由 ensureCaseSnapshot 预热），保证真实来源、不补造事实。
      // 会话已绑定版本时仅命中该版本（sourceId@version / 裸键版本一致），
      // 版本不一致返回 null（资料不足），不回退漂移数据换患者。
      const snapshot = getCachedSnapshot(sourceId, version);
      if (!snapshot) return null;
      const parsed = recordSchema.safeParse(snapshot);
      return parsed.success ? parsed.data : null;
    }
    throw new Error('CASE_SOURCE_INVALID');
  }
}
