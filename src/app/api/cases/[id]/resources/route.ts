import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { getTeacherCaseResourceRoot } from '@/lib/teacher-case-resources';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireUser } from '@/lib/request-auth';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request, 'student');
    const { id } = await context.params;
    const root = getTeacherCaseResourceRoot(id);
    if (!root) return ok([]);
    const caseRoot = root;
    const files: Array<{ path: string; name: string; kind: 'image' | 'audio' | 'video' | 'document'; bytes: number }> = [];
    async function walk(folder: string): Promise<void> {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) {
          const kind = getResourceKind(entry.name);
          if (kind) files.push({ path: path.relative(caseRoot, full).replaceAll('\\', '/'), name: entry.name, kind, bytes: (await stat(full)).size });
        }
      }
    }
    await walk(caseRoot);
    return ok(files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN')));
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500);
  }
}

function getResourceKind(fileName: string): 'image' | 'audio' | 'video' | 'document' | null {
  const ext = path.extname(fileName).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return 'image';
  if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) return 'audio';
  if (['.mp4', '.avi', '.mov', '.webm'].includes(ext)) return 'video';
  if (['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xlsx'].includes(ext)) return 'document';
  return null;
}
