import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { noteRevisionIndexMap, projectNoteForRole } from '@/lib/note-projection';
import { AgentRepository } from '@/lib/repository';
import { requireAuth } from '@/lib/request-auth';

/**
 * 批次6·教师查看学生病历提交列表（只读；RLS 行级把关 +
 * class_period 时间锚点按归属期间收紧；路由层教师鉴权）。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request, 'teacher');
    const { id } = await context.params;
    const records = await new AgentRepository(user).listStudentNotes(id);
    const revisionIndex = noteRevisionIndexMap(records);
    return ok(records.map((record) => projectNoteForRole(record, user.role, revisionIndex.get(record.id))));
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500;
    return fail(detail, undefined, status);
  }
}
