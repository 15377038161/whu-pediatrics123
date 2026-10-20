import { NextRequest } from 'next/server';
import { extractForwardHeaders } from 'coder-coding-dev-sdk';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { requireAuth } from '@/lib/request-auth';
import { AgentRepository } from '@/lib/repository';
import { synthesizeRoleAudio } from '@/lib/speech-service';
import { speechTtsSchema } from '@/lib/validation';

/** 语音失败码 → HTTP 状态映射（见 docs/SPEECH_INTEGRATION.md 路由约定）。 */
const STATUS_BY_CODE: Record<string, number> = {
  PERMISSION_DENIED: 403,
  MESSAGE_NOT_FOUND: 404,
  NOT_SPEAKABLE: 422,
  INVALID_AUDIO: 422,
  TIMEOUT: 504,
  PROVIDER_ERROR: 502,
  UNAVAILABLE: 503,
};

/**
 * 角色消息 TTS（阶段 D）：只按 messageId 取学生本人会话（getSession 已做归属校验）中
 * 已存在的角色消息合成——TTS 不能自己生成新事实，text 不由客户端传入。
 * 不能言语患儿的语义台词与纯括注消息返回 NOT_SPEAKABLE（不当婴儿台词守卫）。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, 'student');
    const parsed = speechTtsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail(
        { code: 'INVALID_REQUEST', message: '请求参数不完整，请重试。', retryable: false },
        undefined,
        422,
      );
    }
    const session = await new AgentRepository(user).getSession(parsed.data.sessionId);
    const forwardHeaders = extractForwardHeaders(Object.fromEntries(request.headers.entries()));
    const result = await synthesizeRoleAudio(session, parsed.data.messageId, forwardHeaders);
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
    console.error(`[speech] POST /api/speech/tts failed code=${detail.code}`);
    const status = detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : detail.code === 'SESSION_NOT_FOUND' ? 404 : 500;
    return fail(detail, undefined, status);
  }
}
