import { NextRequest } from 'next/server';
import { errorFromUnknown, fail } from '@/lib/api-result';
import { invokeCozeAI } from '@/lib/coze-ai';
import {platformForwardHeaders} from '@/lib/platform-forward-headers';
import { buildNoteReviewMessages, NOTE_REVIEW_PROMPT_VERSION, parseNoteReview, type StandardSectionsInput } from '@/lib/note-ai-review';
import { buildReleasedEvidenceSummary } from '@/lib/note-evidence';
import { projectReportForRole } from '@/lib/report-projection';
import { AgentRepository } from '@/lib/repository';
import { requireAuth } from '@/lib/request-auth';
import { readTeacherCaseData } from '@/lib/teacher-case-data';

/**
 * 批次6·AI 辅助审阅（仅提交本人可发起）：SSE 流式返回生成过程（前端打字机渲染），
 * 流结束后服务端解析并校验结构，成功回填 ready / 失败回填 failed（不影响提交与教师查看）。
 *
 * 边界（CASE_WORKFLOW_AND_NOTE_WRITING.md 第4节第3/4/5条）：
 * - 证据摘要取自学生版报告投影（不含答案参照）；标准病历仅作服务端上下文，绝不随 SSE 下发；
 * - AI 建议引用学生已写内容或本例已获得证据，不编造检查结果/临床结论；按固定五维给出病历书写评分，评分不进入临床总分/积分/选关，不改历史成绩；
 * - 服务异常 → failed，前端提示但不降级提交。标准病历缺资料时仅跳过漏采对照，仍可审。
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try {
    user = await requireAuth(request);
  } catch (error) {
    return fail(errorFromUnknown(error), undefined, 401);
  }
  const repo = new AgentRepository(user);

  // 流开始前完成全部预取与校验：失败以普通 JSON 返回，前端无需读流即可拿到错误语义
  let messages: ReturnType<typeof buildNoteReviewMessages>;
  try {
    const note = await repo.getNote(id);
    if (!note) return fail({ code: 'NOTE_NOT_FOUND', message: '未找到该病历记录（或不在你的可见范围内）。', retryable: false }, undefined, 404);
    if (note.userId !== user.id) return fail({ code: 'FORBIDDEN', message: 'AI 审阅仅提交本人可发起。', retryable: false }, undefined, 403);
    const session = await repo.getSession(note.sessionId);
    const reportId = session.reportId;
    if (!reportId) return fail({ code: 'NOTE_REVIEW_UNAVAILABLE', message: '本次训练尚未生成报告，AI 审阅需要接诊证据，请先完成训练。', retryable: false }, undefined, 422);
    const report = await repo.getReport(reportId);
    if (!report) return fail({ code: 'NOTE_REVIEW_UNAVAILABLE', message: '本次训练尚未生成报告，AI 审阅需要接诊证据，请先完成训练。', retryable: false }, undefined, 422);
    const standard = readTeacherCaseData(note.caseId, note.caseVersion, note.sessionId);
    const standardSections: StandardSectionsInput = standard
      ? { history: standard.sections.history, exam: standard.sections.exam, tests: standard.sections.tests, diagnosis: standard.sections.diagnosis, plan: standard.sections.plan }
      : { history: '', exam: '', tests: '', diagnosis: '', plan: '' };
    messages = buildNoteReviewMessages({
      content: note.content,
      evidence: buildReleasedEvidenceSummary(projectReportForRole(report, 'student')),
      standardSections,
    });
  } catch (error) {
    const detail = errorFromUnknown(error);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'NOTE_NOT_FOUND' ? 404 : detail.code === 'NOTE_REVIEW_UNAVAILABLE' || detail.code === 'SESSION_NOT_FOUND' ? 422 : 500;
    return fail(detail, undefined, status);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

      try {
        const result=await invokeCozeAI({messages,forwardHeaders:platformForwardHeaders(request.headers,user.accessToken),
          llmConfig:{model:process.env.COZE_AI_REPORT_MODEL?.trim()||'doubao-seed-1-8-251228',thinking:'enabled',temperature:0.3,maxTokens:6000},
          timeoutMs:90000,maxAttempts:1});
        const fullText=result.content;
        const review = parseNoteReview(fullText);
        if (review) {
          await repo.updateNoteReview(id, 'ready', review, NOTE_REVIEW_PROMPT_VERSION);
          send({ done: true, status: 'ready' });
        } else {
          await repo.updateNoteReview(id, 'failed', null, NOTE_REVIEW_PROMPT_VERSION);
          send({ done: true, status: 'failed', message: 'AI 意见未通过结构校验，本次审阅不产生结论。' });
        }
      } catch (error) {
        await repo.updateNoteReview(id, 'failed', null, NOTE_REVIEW_PROMPT_VERSION).catch(() => undefined);
        send({ done: true, status: 'failed', message: 'AI 审阅暂时不可用，不影响病历提交与教师查看。' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
