import path from 'node:path';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { getKnowledgeRoot, getTeacherSourceId } from '@/lib/teacher-case-data';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

const catalog = new Map(TEACHER_CASE_CATALOG.map((item) => [item.id, item]));

export function getTeacherCaseResourceRoot(caseId: string): string | null {
  let decodedId: string;
  try {
    decodedId = decodeURIComponent(caseId);
  } catch {
    return null;
  }
  const item = catalog.get(getTeacherSourceId(decodedId));
  if (!item?.folder) return null;
  if (!item.folder.startsWith('knowledge/')) return null;
  const knowledgeRoot = getKnowledgeRoot();
  const root = path.normalize([knowledgeRoot, ...item.folder.split('/').slice(1)].join(path.sep));
  if (!root.startsWith(`${knowledgeRoot}${path.sep}`)) return null;
  return root;
}

export function getPlayableTeacherResource(caseId: string, relative: string): string | null {
  if (!['.avi', '.mov'].includes(path.extname(relative).toLowerCase())) return null;
  const hash = createHash('sha256').update(relative.replaceAll('\\', '/')).digest('hex');
  const file = path.join(getKnowledgeRoot(), 'teaching-media', getTeacherSourceId(caseId), `${hash}.mp4`);
  return existsSync(file) ? file : null;
}
