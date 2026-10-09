import { NextRequest } from 'next/server';
import { CASE_CATALOG } from '@/domain/case-catalog';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { getUnpublishedCaseIds } from '@/lib/case-publication';

export const dynamic = 'force-dynamic';

/**
 * 学生病例目录：教师已下架（case_publication published=false）的 teacher 病例
 * 不出现在目录中；教师角色全量可见（教师需看到全部病例以预览与复核）。
 * 非 teacher 病例不参与发布状态过滤。DB 不可用/查询失败时保持全量开放
 * （缺省开放语义：无行=已发布），不因状态查询故障拦截整个目录。
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (user.role === 'teacher' || !user.accessToken) return ok(CASE_CATALOG);
    try {
      const unpublished = await getUnpublishedCaseIds(user.accessToken);
      if (unpublished.size === 0) return ok(CASE_CATALOG);
      return ok(CASE_CATALOG.filter((item) => !(item.id.startsWith('teacher-') && unpublished.has(item.id))));
    } catch {
      return ok(CASE_CATALOG);
    }
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 500);
  }
}
