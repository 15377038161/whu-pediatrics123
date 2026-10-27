import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import simulations from '@/domain/teaching-simulations.json';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';
import { getCachedSnapshot } from '@/lib/case-snapshot';
import { computeCaseDataVersion } from '@/lib/case-data-version';

export const recordSchema = z.object({
  caseId: z.string(), sourceName: z.string(), sourceDocument: z.string(),
  age: z.string(), sex: z.string(), complaint: z.string(),
  teachingSimulation: z.literal(true).optional(),
  sections: z.object({ history: z.string(), exam: z.string(), tests: z.string(), diagnosis: z.string(), plan: z.string() }),
  vitals: z.object({ temperature: z.number().nullable(), heartRate: z.number().nullable(), respiratoryRate: z.number().nullable(), spo2: z.number().nullable() }),
  documents: z.array(z.object({ source: z.string(), text: z.string(), sha256: z.string() })),
  /** 分时点事实释放元数据（可选）：按 testId（source-test-N）声明该检查结果的最早回报阶段与延迟说明；
   *  缺省不限制（开单即回报，向后兼容既有教师病例 JSON）。用于外送/分时段回报类检查（如 NK 细胞活性外送次日回报）。 */
  testRelease: z.array(z.object({
    testId: z.string(),
    availableFromStage: z.enum(['triage', 'history', 'exam', 'tests', 'assessment', 'plan', 'communication', 'report']).optional(),
    resultDelayNote: z.string().optional(),
  })).optional(),
  /** 病例媒体绑定元数据（可选）：按 testId（source-test-N）/examId（source-exam-<toolId>-<bodyPartId>）声明
   *  结果释放时随事件挂载的媒体图；fileId 为对象存储登记标识（URL 仅经服务端签名链接解析，不入库不持久化）。
   *  原图按已确认的教师授权及实际病例/操作用途接入；AI教学示意单独标识，
   *  不冒充真实患者影像或影像识别证据，不伪造视觉/医学审核结论。 */
  testMedia: z.array(z.object({
    testId: z.string(),
    media: z.array(z.object({ fileId: z.string(), kind: z.literal('image'), caption: z.string() })),
  })).optional(),
  examMedia: z.array(z.object({
    examId: z.string(),
    media: z.array(z.object({ fileId: z.string(), kind: z.literal('image'), caption: z.string() })),
  })).optional(),
});
export type TeacherCaseData = z.infer<typeof recordSchema>;

export function getTeacherSourceId(caseId: string): string {
  const decoded = decodeURIComponent(caseId);
  return TEACHER_CASE_LINKS[decoded]?.sourceId ?? decoded;
}

export function getKnowledgeRoot(): string {
  return path.resolve(process.env.PEDIATRICS_KNOWLEDGE_ROOT || [process.cwd(), 'knowledge'].join(path.sep));
}

export function readTeacherCaseData(caseId: string, version?: string | null, sessionId?: string | null): TeacherCaseData | null {
  const sourceId = getTeacherSourceId(caseId);
  if (!TEACHER_CASE_CATALOG.some((item) => item.id === sourceId)) return null;
  try {
    const file = path.join(getKnowledgeRoot(), 'teaching-cases', `${sourceId}.json`);
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const simulation = simulations.find(item => item.caseId === sourceId);
      if (!simulation) throw error;
      raw = simulation;
    }
    const record = recordSchema.parse(raw);
    // A catalogue-only entry is usable only with an explicit synthetic source.
    if (!TEACHER_CASE_CATALOG.some(item => item.id === sourceId && item.folder) && !record.teachingSimulation) return null;
    if (record.caseId !== sourceId) return null;
    // 本地文件存在但版本已绑定：本地当前版本与绑定版本一致才直接使用本地完整事实；
    // 不一致（本地内容已修订）时优先恢复绑定版本的进程内缓存快照（同事实集合），
    // 缓存无该版本（重启后过期/未预热）则返回 null（资料不足），
    // 绝不返回新版本地数据换患者事实——与 ENOENT 分支同一防漂移语义。
    if (!version || computeCaseDataVersion(record) === version) return record;
    const pinned = getCachedSnapshot(sourceId, version, sessionId);
    if (!pinned) return null;
    const parsed = recordSchema.safeParse(pinned);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // 本地 teaching-cases 快照缺失（部署环境 knowledge/ 不入库）：
      // 回退到进程内知识库召回快照（由 ensureCaseSnapshot 预热），保证真实来源、不补造事实。
      // 会话已绑定版本时仅命中该版本（含会话作用域键），版本不一致返回 null（资料不足），
      // 不回退漂移数据换患者。
      const snapshot = getCachedSnapshot(sourceId, version, sessionId);
      if (!snapshot) return null;
      const parsed = recordSchema.safeParse(snapshot);
      return parsed.success ? parsed.data : null;
    }
    throw new Error('CASE_SOURCE_INVALID');
  }
}
