import { NextRequest } from 'next/server';
import { errorFromUnknown, fail, ok } from '@/lib/api-result';
import { AgentRepository } from '@/lib/repository';
import { platformForwardHeaders } from '@/lib/platform-forward-headers';
import { requireAuth } from '@/lib/request-auth';
import { transcribeRecording } from '@/lib/speech-service';
import { getStudentVoiceLink, storeStudentVoice } from '@/lib/student-voice';

export const runtime = 'nodejs';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const invalid = (message: string) => ({ code: 'INVALID_RECORDING', message, retryable: false });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request, 'student');
    const { id } = await params;
    const session = await new AgentRepository(user).getSession(id);
    if (session.userId !== user.id) {
      return fail({ code: 'PERMISSION_DENIED', message: '语音输入仅限本人会话。', retryable: false }, undefined, 403);
    }
    const form = await request.formData();
    const audio = form.get('audio');
    const durationMs = Number(form.get('durationMs'));
    if (!(audio instanceof File) || audio.size < 44 || audio.size > MAX_AUDIO_BYTES
      || !['audio/wav', 'audio/wave', 'audio/x-wav'].includes(audio.type)
      || !Number.isInteger(durationMs) || durationMs < 250 || durationMs > 20_000) {
      return fail(invalid('录音格式或时长无效，请重新按住说话。'), undefined, 422);
    }
    const bytes = Buffer.from(await audio.arrayBuffer());
    if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WAVE') {
      return fail(invalid('录音文件无效，请重新录制。'), undefined, 422);
    }
    const result = await transcribeRecording(
      { base64Data: bytes.toString('base64'), format: 'wav' },
      platformForwardHeaders(request.headers, user.accessToken),
    );
    if (!result.ok) return fail(result.error, undefined, result.error.code === 'TIMEOUT' ? 504 : 502);
    if (!result.data.text.trim()) {
      return fail({ code: 'EMPTY_TRANSCRIPT', message: '没有识别到清晰语音，请重新按住说话，或改用文字输入。', retryable: true }, undefined, 422);
    }
    let audioFileId: string | null = null;
    let storageWarning: string | undefined;
    try {
      audioFileId = await storeStudentVoice(id, audio);
    } catch {
      storageWarning = '语音已转成文字，但录音暂时无法保存；本次将按文字消息发送。';
    }
    return ok({ text: result.data.text, audioFileId, audioDurationMs: durationMs, storageWarning });
  } catch (cause) {
    const detail = errorFromUnknown(cause);
    console.error(`[voice] upload/transcribe failed code=${detail.code}`);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 500);
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request, 'student');
    const { id } = await params;
    const session = await new AgentRepository(user).getSession(id);
    if (session.userId !== user.id) {
      return fail({ code: 'PERMISSION_DENIED', message: '录音播放仅限本人会话。', retryable: false }, undefined, 403);
    }
    const messageId = request.nextUrl.searchParams.get('messageId') ?? '';
    try {
      return ok({ audioUrl: await getStudentVoiceLink(session, messageId) });
    } catch {
      return fail({ code: 'VOICE_NOT_FOUND', message: '录音不存在或已失效，仍可阅读语音转写。', retryable: true }, undefined, 404);
    }
  } catch (cause) {
    const detail = errorFromUnknown(cause);
    return fail(detail, undefined, detail.code === 'AUTH_REQUIRED' ? 401 : detail.code === 'FORBIDDEN' ? 403 : 404);
  }
}
