import { NextRequest, NextResponse } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { fail } from '@/lib/api-result';
import { requireUser } from '@/lib/request-auth';
import { synthesizeSpeech, type VoicePersona } from '@/lib/tts';

const ALLOWED_PERSONAS: VoicePersona[] = ['child', 'parent', 'narrator'];
const MAX_TEXT_LENGTH = 300;

export async function POST(request: NextRequest) {
  try {
    await requireUser(request, 'student');
    const body = await request.json();
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const persona = typeof body.persona === 'string' ? body.persona : 'narrator';

    if (!text) return fail({ code: 'INVALID_REQUEST', message: '播报内容不能为空。', retryable: false }, undefined, 422);
    if (text.length > MAX_TEXT_LENGTH) return fail({ code: 'INVALID_REQUEST', message: `播报内容过长（上限${MAX_TEXT_LENGTH}字）。`, retryable: false }, undefined, 422);
    if (!ALLOWED_PERSONAS.includes(persona as VoicePersona)) return fail({ code: 'INVALID_REQUEST', message: '语音角色无效。', retryable: false }, undefined, 422);

    const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const audio = await synthesizeSpeech({ text, persona: persona as VoicePersona, forwardHeaders });
    if (!audio) return fail({ code: 'TTS_UNAVAILABLE', message: '语音服务暂时不可用，请稍后重试。', retryable: true }, undefined, 502);

    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audio.byteLength.toString(),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.warn('[api/tts] error:', error instanceof Error ? error.message : error);
    return fail({ code: 'TTS_UNAVAILABLE', message: '语音服务暂时不可用。', retryable: true }, undefined, 502);
  }
}
