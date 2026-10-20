import { NextRequest } from 'next/server';
import { extractForwardHeaders } from 'coder-coding-dev-sdk';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { transcribeRecording } from '@/lib/speech-service';
import { speechAsrSchema } from '@/lib/validation';

/** 语音失败码 → HTTP 状态映射（见 docs/SPEECH_INTEGRATION.md 路由约定）。 */
const STATUS_BY_CODE: Record<string, number> = {
  PERMISSION_DENIED: 403,
  INVALID_AUDIO: 422,
  TIMEOUT: 504,
  PROVIDER_ERROR: 502,
  UNAVAILABLE: 503,
};

/**
 * ASR 转写（阶段 D）：base64 直传识别（录音不落地对象存储）。
 * 返回的转写是"待确认草稿"——未确认前不作为答、不自动发送；确认/编辑在客户端完成，
 * 发送复用既有 /api/agent/turn 的 ASK_QUESTION / SEND_COMMUNICATION 事件。
 */
export async function POST(request: NextRequest) {
  try {
    await requireAuth(request, 'student');
    const parsed = speechAsrSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail(
        { code: 'INVALID_AUDIO', message: '录音数据无效，请重新录音。', retryable: false },
        undefined,
        422,
      );
    }
    const forwardHeaders = extractForwardHeaders(Object.fromEntries(request.headers.entries()));
    const result = await transcribeRecording(parsed.data, forwardHeaders);
    if (!result.ok) {
      return fail(
        { code: result.error.code, message: result.error.message, retryable: result.error.retryable },
        undefined,
        STATUS_BY_CODE[result.error.code] ?? 502,
      );
    }
    return ok(result.data);
  } catch (error) {
    const detail = errorFromUnknown(error);
    console.error(`[speech] POST /api/speech/asr failed code=${detail.code}`);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : 500;
    return fail(detail, undefined, status);
  }
}
