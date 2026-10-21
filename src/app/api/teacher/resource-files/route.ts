import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { listStorageFilesForPicker, resolveTeacherResourceContext } from '@/lib/learning-resource-teacher';

export const dynamic = 'force-dynamic';

/**
 * 对象存储文件清单（GET /api/teacher/resource-files）：教师端文件绑定选择器数据源。
 * 仅教师白名单可访问；返回元数据（fileName/fileId/大小/类型），不含任何访问链接；
 * 绑定后播放仍按「fileId 入库 + playback 动态取短期链接」契约执行。
 */
export async function GET(request: NextRequest) {
  try {
    await resolveTeacherResourceContext(request);
    const files = await listStorageFilesForPicker();
    return ok({ files });
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'FILE_UNAVAILABLE' ? 503 : detail.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500);
  }
}
