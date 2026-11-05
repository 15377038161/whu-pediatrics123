import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { parseRosterXlsx } from '@/lib/roster-xlsx';
import type { RosterRow } from '@/lib/class-roster';

export const dynamic = 'force-dynamic';

/**
 * 名单 .xlsx 解析（POST /api/teacher/roster-parse）：教师上传 Excel 名单，服务端解析成与粘贴/CSV 同构的行。
 *
 * 只解析、不入库：返回的行仍由前端预览后走既有 /api/classes action=import 提交，
 * 校验（表头、必填、行号提示、编号去重）全部在 parseRosterGrid 一处，避免出现第二套名单规则。
 * exceljs 只在服务端动态 import，客户端不新增任何依赖。
 */
export async function POST(request: NextRequest) {
  try {
    await requireAuth(request, 'teacher');
  } catch (error) {
    const detail = errorFromUnknown(error);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : 403);
  }
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return fail({ code: 'ROSTER_FILE_REQUIRED', message: '请选择要导入的名单文件（.xlsx）', retryable: false }, undefined, 422);
    }
    const rows: RosterRow[] = await parseRosterXlsx(new Uint8Array(await file.arrayBuffer()));
    return ok({ rows });
  } catch (error) {
    // 名单格式问题要原样回给老师（含表头缺失、行号、编号重复），不能被 errorFromUnknown 收敛成「系统暂时无法完成该操作」
    return fail(
      { code: 'ROSTER_INVALID', message: error instanceof Error ? error.message : '名单格式错误，请检查后重试', retryable: false },
      undefined,
      422,
    );
  }
}
