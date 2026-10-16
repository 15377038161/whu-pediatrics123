import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/request-auth';
import { isTeacherByWhitelist } from '@/lib/case-draft-import';
import { isDatabaseConfigured } from '@/lib/supabase-client';
import { ok, fail, errorFromUnknown } from '@/lib/api-result';
import {
  CaseDocumentError,
  extractCaseDocument,
  MAX_CASE_FILE_BYTES,
  prepareCaseDocument,
} from '@/lib/case-document';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'teacher');
    if (!user.accessToken) throw new Error('AUTH_REQUIRED');
    if (!isDatabaseConfigured())
      return fail(
        {
          code: 'DATABASE_NOT_CONFIGURED',
          message: '数据库暂不可用，请稍后重试。',
          retryable: true,
        },
        undefined,
        503,
      );
    if (!(await isTeacherByWhitelist(user.accessToken)))
      throw new Error('FORBIDDEN');
    const length = Number(request.headers.get('content-length'));
    if (length > MAX_CASE_FILE_BYTES + 64 * 1024)
      throw new CaseDocumentError('上传内容超过 10 MB，请拆分为单个病例。');
    if (
      !request.headers.get('content-type')?.startsWith('multipart/form-data;')
    )
      throw new CaseDocumentError('请选择文件后重新上传。');
    // Bound chunked requests too, before the multipart parser allocates the entire body.
    const reader = request.body?.getReader();
    if (!reader) throw new CaseDocumentError('上传内容为空。');
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > MAX_CASE_FILE_BYTES + 64 * 1024) {
        await reader.cancel();
        throw new CaseDocumentError('上传内容超过 10 MB。');
      }
      chunks.push(chunk.value);
    }
    let form: FormData;
    try {
      form = await new Response(Buffer.concat(chunks), {
        headers: { 'content-type': request.headers.get('content-type')! },
      }).formData();
    } catch {
      throw new CaseDocumentError('上传未完成，请重新选择文件。');
    }
    const file = form.get('file');
    if (!(file instanceof File))
      throw new CaseDocumentError('请选择一份病例文档。');
    if (file.size > MAX_CASE_FILE_BYTES)
      throw new CaseDocumentError('文件超过 10 MB，请拆分后上传。');
    const text = await extractCaseDocument(
      file.name,
      new Uint8Array(await file.arrayBuffer()),
    );
    const response = ok(prepareCaseDocument(text, file.name));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof CaseDocumentError)
      return fail(
        { code: 'INVALID_DOCUMENT', message: error.message, retryable: false },
        undefined,
        400,
      );
    const detail = errorFromUnknown(error);
    return fail(
      detail,
      undefined,
      detail.code === 'AUTH_REQUIRED'
        ? 401
        : detail.code === 'FORBIDDEN'
          ? 403
          : 500,
    );
  }
}
