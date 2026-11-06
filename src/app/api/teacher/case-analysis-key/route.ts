import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { CaseAnswerKeyRecord } from '@/domain/case-analysis';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { CaseAnalysisError, generateCaseAnswerKey, readCaseAnalysisCase } from '@/lib/case-analysis-ai';
import { getCaseAnswerKey, saveCaseAnswerKey } from '@/lib/case-answer-key-store';
import { ensureCaseSnapshot } from '@/lib/case-snapshot';
import { platformForwardHeaders } from '@/lib/platform-forward-headers';
import { requireAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  caseId: z.string().trim().min(1).max(200),
  version: z.string().regex(/^[a-f0-9]{16}$/).nullish(),
  force: z.boolean().optional(),
}).strict();

/**
 * 教师/管理员预生成标答：从原件 AI 抽取五段得分点，自动原文回校后写入 case_answer_keys。
 * 不要求教师逐条审核；force=true 时重新生成，否则已有 auto 记录直接复用。
 * 学生端不调用本路由，也读不到 key_json；学生只看到报告里的逐点结果。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'teacher');
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail({ code: 'INVALID_REQUEST', message: '请提供有效的 caseId。', retryable: false }, undefined, 422);
    }

    // 本地 knowledge/ 不入库时先从受控快照预热；失败不阻断，readCaseAnalysisCase 会给出明确错误。
    try {
      await ensureCaseSnapshot(parsed.data.caseId, { accessToken: user.accessToken, teacher: true });
    } catch {
      // 快照不可用时由下方 readCaseAnalysisCase 返回 CASE_NOT_FOUND。
    }

    let caseInput;
    try {
      caseInput = readCaseAnalysisCase(parsed.data.caseId, parsed.data.version ?? null);
    } catch (error) {
      const code = error instanceof CaseAnalysisError ? error.code : 'CASE_NOT_FOUND';
      const status = code === 'SOURCE_ANSWER_EMPTY' ? 422 : 404;
      const message = code === 'SOURCE_ANSWER_EMPTY'
        ? '本例原件没有诊断或诊疗计划内容，无法生成标答。'
        : '未找到该病例的可核验原件。';
      return fail({ code, message, retryable: false }, undefined, status);
    }

    let existing: CaseAnswerKeyRecord | null = null;
    try {
      existing = await getCaseAnswerKey(caseInput.caseId, caseInput.version);
    } catch {
      return fail({
        code: 'CASE_ANALYSIS_STORE_UNAVAILABLE',
        message: '标答表未初始化或数据库不可用，请先执行迁移 20261106090000_case_answer_keys.sql。',
        retryable: true,
      }, undefined, 503);
    }
    if (existing?.status === 'auto' && !parsed.data.force) {
      return ok({ cached: true, record: existing });
    }

    const record = await generateCaseAnswerKey(caseInput.caseId, {
      version: caseInput.version,
      forwardHeaders: platformForwardHeaders(request.headers, user.accessToken),
    });
    try {
      await saveCaseAnswerKey(record);
    } catch {
      return fail({
        code: 'CASE_ANALYSIS_SAVE_FAILED',
        message: '标答已生成但保存失败，请检查数据库迁移与 service role 配置。',
        retryable: true,
      }, undefined, 503);
    }
    return ok({ cached: false, record });
  } catch (error) {
    if (error instanceof CaseAnalysisError) {
      return fail({ code: error.code, message: '标答生成失败，请稍后重试。', retryable: true }, undefined, 503);
    }
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500;
    return fail(detail, undefined, status);
  }
}