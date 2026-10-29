import { NextRequest, NextResponse } from 'next/server';
import { errorFromUnknown, fail } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { requireAuth } from '@/lib/request-auth';
import { buildProfileCsv, buildStudentsCsv } from '@/lib/teacher-export-csv';

/** CSV 附件响应（usage-stats 导出同款响应头）。 */
function csvResponse(content: string, filename: string): NextResponse {
  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

/**
 * 批次5·教师分模块导出：GET /api/teacher/export?module=students（学情总表）
 * 或 ?module=profile&userId=...（学生档案：训练明细+病例进度两段）。
 * 教师鉴权；身份列脱敏（沿用 usage-stats 导出口径）；行级可见性由既有聚合方法与 RLS 保证；
 * CSV 公式注入防护由 csvEscape 统一处理。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'teacher');
    const moduleName = request.nextUrl.searchParams.get('module') ?? '';
    const stamp = new Date().toISOString().slice(0, 10);
    if (moduleName === 'students') {
      const workspace = await new AgentRepository(user).listTeacherStudents();
      return csvResponse(buildStudentsCsv(workspace.students), `student-summary-${stamp}.csv`);
    }
    if (moduleName === 'profile') {
      const userId = request.nextUrl.searchParams.get('userId') ?? '';
      if (!userId) return fail({ code: 'INVALID_REQUEST', message: '缺少 userId 参数。', retryable: false }, undefined, 422);
      const profile = await new AgentRepository(user).getStudentProfile(userId);
      return csvResponse(buildProfileCsv(profile), `student-profile-${stamp}.csv`);
    }
    return fail({ code: 'INVALID_REQUEST', message: '未知导出模块，仅支持 students/profile。', retryable: false }, undefined, 422);
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'STUDENT_NOT_FOUND' ? 404 : detail.code === 'INVALID_REQUEST' ? 422 : 500;
    return fail(detail, undefined, status);
  }
}
