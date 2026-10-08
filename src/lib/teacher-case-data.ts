import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';
import { getCachedSnapshot } from '@/lib/case-snapshot';

const recordSchema = z.object({
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

export function readTeacherCaseData(caseId: string): TeacherCaseData | null {
  const sourceId = getTeacherSourceId(caseId);
  if (!TEACHER_CASE_CATALOG.some((item) => item.id === sourceId && item.folder)) return null;
  try {
    const file = path.join(getKnowledgeRoot(), 'teaching-cases', `${sourceId}.json`);
    const record = recordSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    if (record.caseId === sourceId) return record;
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // 本地 teaching-cases 快照缺失（部署环境 knowledge/ 不入库）：
      // 回退到进程内知识库召回快照（由 ensureCaseSnapshot 预热），保证真实来源、不补造事实。
      const snapshot = getCachedSnapshot(sourceId);
      if (!snapshot) return null;
      const parsed = recordSchema.safeParse(snapshot);
      return parsed.success ? parsed.data : null;
    }
    throw new Error('CASE_SOURCE_INVALID');
  }
}
