import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { buildTeacherCaseIndex } from '@/lib/teacher-case-index';

/**
 * 教师端「编号+诊断+完整主诉」统一索引视图（批次 2，教师鉴权只读）。
 * 聚合在服务端完成：主诉映射（CASE_PUBLIC_IDS）不下发，条目仅含教师目录 id。
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuth(request, 'teacher');
    return ok(buildTeacherCaseIndex());
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 403);
  }
}
