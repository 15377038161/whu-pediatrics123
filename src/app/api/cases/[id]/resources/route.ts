import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { getTeacherCaseResourceRoot } from '@/lib/teacher-case-resources';
import { ensureCaseSnapshot } from '@/lib/case-snapshot';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireUser } from '@/lib/request-auth';

export interface CaseResourceEntry {
  path: string;
  name: string;
  kind: 'image' | 'audio' | 'video' | 'document';
  bytes: number;
  /** 知识库来源媒体的外链（本地文件缺失时提供） */
  url?: string;
}

const MAX_KB_MEDIA = 60;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request, 'student');
    const { id } = await context.params;
    const root = getTeacherCaseResourceRoot(id);
    const files: CaseResourceEntry[] = [];
    if (root) {
      const caseRoot = root;
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
    }
    // 知识库原图外链：真实患者影像未经脱敏审核，仅教师可验证访问；学生侧不返回原始 URL。
    if (user.role !== 'teacher') return ok(files);
    const snapshot = await ensureCaseSnapshot(id);
    if (snapshot) {
      snapshot.media.slice(0, MAX_KB_MEDIA).forEach((item, index) => {
        files.push({ path: `kb-media/${index + 1}`, name: `来源影像 ${index + 1}（知识库）`, kind: 'image', bytes: 0, url: item.url });
      });
    }
    return ok(files);
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
