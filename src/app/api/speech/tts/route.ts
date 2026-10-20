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
 * 角色消息 TTS（阶段 D）：只按 messageId 取**本人**会话中已存在的角色消息合成——
 * TTS 不能自己生成新事实，text 不由客户端传入。
 * 归属边界（D-核查-02 fail-closed 修复）：getSession 的教师督导读取语义（RLS teacher_select）
 * 只授予"读"，不自动授予跨用户语音合成——本路由显式要求 session.userId === 当前用户 id，
 * 教师仅可为自己创建的本人会话合成音频（教师本人会话训练保留），为他人（学生）会话合成
 * 返回 403 PERMISSION_DENIED。教师跨用户督导语音需求留待阶段 E 明确范围后专门授权，
 * 不以宽泛 role 绕过（当前亦无可信班级范围授权服务，纯角色判定无范围限定）。
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
    // 显式本人归属限制（契约"仅本人会话已存在消息"）：督导读取语义不延伸为跨用户合成
    if (session.userId !== user.id) {
      return fail(
        { code: 'PERMISSION_DENIED', message: '语音合成仅限本人会话的消息。', retryable: false },
        undefined,
        403,
      );
    }
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
