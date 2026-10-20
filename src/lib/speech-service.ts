/**
 * 语音服务（阶段 D，方案第 6 章）：平台 TTS/ASR 的服务端封装。
 * 依据 docs/SPEECH_INTEGRATION.md 的核验结论实现，铁律：
 *  1. coder-coding-dev-sdk 仅在服务端调用（密钥与配额在平台侧），本模块只被 API Route 引入。
 *  2. 能力启用状态只来自真实探测（AudioClient.listVoices），探测失败按 unavailable 返回。
 *  3. TTS 文本只取学生本人会话中已存在的角色消息（调用方传入 SessionState），
 *     本模块不合成新事实；纯括注与非可言语患儿消息返回 NOT_SPEAKABLE。
 *  4. 音色映射稳定（同一角色同一病例同一音色），映射音色不可用时回退默认音色。
 */
import { ASRClient, AudioClient, Config, TTSClient } from 'coder-coding-dev-sdk';
import type { VoiceInfo } from 'coder-coding-dev-sdk';
import { getCase } from '@/domain/case';
import { canChildSpeak, resolveCommunicationProfile } from '@/domain/communication-profile';
import type { AgentMessage, SessionState } from '@/domain/agent';
import type {
  AsrRequest,
  AsrResponse,
  SpeechCapabilities,
  SpeechFailure,
  SpeechResult,
  TtsResponse,
  VoiceTurnState,
} from '@/domain/speech-contract';
import { UNAVAILABLE_SPEECH_CAPABILITIES } from '@/domain/speech-contract';

/** 角色稳定音色映射（docs/SPEECH_INTEGRATION.md）：成年配音演播的角色音，非克隆真实儿童声音。 */
export const ROLE_VOICES = {
  childFemale: 'coder:female:cute',
  childMale: 'coder:male:cheerful',
  parent: 'coder:female:canan',
  tutor: 'coder:male:default',
} as const;
const FALLBACK_VOICE = 'coder:female:default';

/** 平台签名音频 URL 的有效期（默认 24 小时）；过期后播放器需重新合成。 */
export const TTS_AUDIO_URL_TTL_MS = 24 * 60 * 60 * 1000;

/** base64 直传上限：原始音频 ≤ 10MB（base64 膨胀 4/3）。 */
const MAX_BASE64_LENGTH = Math.ceil((10 * 1024 * 1024) / 3) * 4;

/** 音色探测缓存：避免每次页面加载都打平台接口；失败结果不缓存（下次探测可恢复）。 */
const voiceCache = { at: 0, voices: null as VoiceInfo[] | null, ok: false };
const VOICE_CACHE_TTL_MS = 60_000;

function failure(code: SpeechFailure['code'], message: string, retryable: boolean): SpeechFailure {
  return { code, message, retryable };
}

function mapProviderError(scope: string, error: unknown): SpeechFailure {
  const detail = error instanceof Error ? error.message : String(error);
  if (/timeout|超时| aborted/i.test(detail)) {
    return failure('TIMEOUT', '语音服务响应超时，请稍后重试。', true);
  }
  return failure('PROVIDER_ERROR', `语音服务暂时不可用（${scope}），请稍后重试。`, true);
}

async function listVoicesCached(forwardHeaders?: Record<string, string>): Promise<VoiceInfo[] | null> {
  const fresh = Date.now() - voiceCache.at < VOICE_CACHE_TTL_MS;
  if (fresh && voiceCache.voices) return voiceCache.voices;
  if (fresh && !voiceCache.ok) return null;
  try {
    const voices = await new AudioClient(new Config(), forwardHeaders).listVoices();
    voiceCache.at = Date.now();
    voiceCache.voices = voices;
    voiceCache.ok = true;
    return voices;
  } catch {
    voiceCache.at = Date.now();
    voiceCache.voices = null;
    voiceCache.ok = false;
    return null;
  }
}

/** 能力探测（/api/speech/capabilities）：音色列表非空视为语音供应商可用（TTS/ASR 同族路由）；
 *  探测失败如实返回 unavailable，前端据此隐藏语音入口。 */
export async function probeSpeechCapabilities(forwardHeaders?: Record<string, string>): Promise<SpeechCapabilities> {
  const voices = await listVoicesCached(forwardHeaders);
  if (!voices || voices.length === 0) return { ...UNAVAILABLE_SPEECH_CAPABILITIES };
  return { asr: 'turn-based', tts: 'turn-based', voiceCount: voices.length };
}

/** ASR 转写（/api/speech/asr）：base64 直传识别，录音不落地对象存储。 */
export async function transcribeRecording(
  input: AsrRequest,
  forwardHeaders?: Record<string, string>,
): Promise<SpeechResult<AsrResponse>> {
  if (input.base64Data.length > MAX_BASE64_LENGTH) {
    return { ok: false, error: failure('INVALID_AUDIO', '录音过长（超过 10MB），请缩短后重试。', false) };
  }
  try {
    const result = await new ASRClient(new Config(), forwardHeaders).recognize({
      base64Data: input.base64Data,
      format: input.format,
    });
    return { ok: true, data: { text: result.text } };
  } catch (error) {
    return { ok: false, error: mapProviderError('asr', error) };
  }
}

/** 可播报角色：学生本人发言（学生已看到自己的文字）与系统导航不进入角色播报。 */
function isSpeakableActor(actor: AgentMessage['actor']): boolean {
  return actor === 'child' || actor === 'parent' || actor === 'tutor';
}

/** 纯括注消息（非言语舞台提示，如“（哭闹不安）”）不合成语音（方案 8.4）。 */
function isPureParenthetical(text: string): boolean {
  return /^（[^（）]*）$/.test(text.trim());
}

/** 解析角色音色：同一角色同一病例稳定；映射音色不可用回退默认，再不可用取第一个可用音色。 */
async function resolveRoleVoice(
  message: AgentMessage,
  session: SessionState,
  forwardHeaders?: Record<string, string>,
): Promise<string> {
  let preferred: string;
  if (message.actor === 'child') {
    const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
    preferred = pediatricCase.sex.includes('女') ? ROLE_VOICES.childFemale : ROLE_VOICES.childMale;
  } else if (message.actor === 'parent') {
    preferred = ROLE_VOICES.parent;
  } else {
    preferred = ROLE_VOICES.tutor;
  }
  const voices = await listVoicesCached(forwardHeaders);
  if (!voices || voices.length === 0) return preferred;
  const ids = new Set(voices.map((voice) => voice.voiceId));
  if (ids.has(preferred)) return preferred;
  if (ids.has(FALLBACK_VOICE)) return FALLBACK_VOICE;
  return voices[0].voiceId;
}

/** TTS 合成（/api/speech/tts）：只取学生本人会话中已存在的角色消息；守卫顺序：
 *  消息存在 → 角色可播报 → 非纯括注 → 患儿可言语 → 按角色音色合成。 */
export async function synthesizeRoleAudio(
  session: SessionState,
  messageId: string,
  forwardHeaders?: Record<string, string>,
): Promise<SpeechResult<TtsResponse>> {
  const target = session.messages.find((item) => item.id === messageId);
  if (!target) {
    return { ok: false, error: failure('MESSAGE_NOT_FOUND', '会话中不存在这条消息，无法播放。', false) };
  }
  if (!isSpeakableActor(target.actor)) {
    return { ok: false, error: failure('NOT_SPEAKABLE', '该消息不参与角色播报。', false) };
  }
  if (isPureParenthetical(target.content)) {
    return { ok: false, error: failure('NOT_SPEAKABLE', '括注是非言语提示，不播报为语音。', false) };
  }
  if (target.actor === 'child') {
    const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
    if (!canChildSpeak(resolveCommunicationProfile(session.caseId, pediatricCase.age))) {
      return { ok: false, error: failure('NOT_SPEAKABLE', '该病例患儿不能言语，由家长代答，不播报患儿语音。', false) };
    }
  }
  try {
    const speaker = await resolveRoleVoice(target, session, forwardHeaders);
    const response = await new TTSClient(new Config(), forwardHeaders).synthesize({
      text: target.content,
      speaker,
      audioFormat: 'mp3',
      sampleRate: 24000,
    });
    return {
      ok: true,
      data: { audioUrl: response.audioUrl, expiresAt: new Date(Date.now() + TTS_AUDIO_URL_TTL_MS).toISOString() },
    };
  } catch (error) {
    return { ok: false, error: mapProviderError('tts', error) };
  }
}

/** 测试注入缝：重置音色探测缓存（仅测试使用，业务代码不调用）。 */
export function __resetVoiceCacheForTests(): void {
  voiceCache.at = 0;
  voiceCache.voices = null;
  voiceCache.ok = false;
}

export type { VoiceTurnState };
