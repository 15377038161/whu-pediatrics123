import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { projectNoteForRole } from '@/lib/note-projection';
import { AgentRepository } from '@/lib/repository';
import { requireAuth } from '@/lib/request-auth';

/**
 * 批次6·病历提交详情：本人或教师可读（RLS 行级把关可见性），
 * 投影按角色收紧（教师含病例绑定与 AI 意见；学生不含 caseId/caseVersion）。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const record = await new AgentRepository(user).getNote(id);
    if (!record) return fail({ code: 'NOTE_NOT_FOUND', message: '未找到该病历记录（或不在你的可见范围内）。', retryable: false }, undefined, 404);
    return ok(projectNoteForRole(record, user.role));
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500;
    return fail(detail, undefined, status);
  }
}
