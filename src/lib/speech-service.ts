/**
 * 语音服务（阶段 D，方案第 6 章）：平台 TTS/ASR 的服务端封装。
 * 依据 docs/SPEECH_INTEGRATION.md 的核验结论实现，铁律：
 *  1. coder-coding-dev-sdk 仅在服务端调用（密钥与配额在平台侧），本模块只被 API Route 引入。
 *  2. 能力启用状态只来自真实最小调用探测（listVoices + 短句 TTS 合成 + 回灌 ASR 识别），
 *     listVoices 不用于推断 ASR/TTS 可用；探测失败按 unavailable 返回。
 *  3. TTS 文本只取学生本人会话中已存在的角色消息（调用方传入 SessionState），
 *     本模块不合成新事实；纯括注与非可言语患儿消息返回 NOT_SPEAKABLE。
 *  4. 音色映射稳定（同一角色同一病例同一音色），映射音色不可用时回退默认音色。
 */
import { ASRClient, AudioClient, AudioDefaults, Config, TTSClient } from 'coder-coding-dev-sdk';
import type { VoiceInfo } from 'coder-coding-dev-sdk';
import { getCase } from '@/domain/case';
import { canChildSpeak } from '@/domain/communication-profile';
import { resolveAuditedCommunicationProfile } from '@/lib/communication-profile-overrides';
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

/**
 * 角色稳定音色映射（docs/SPEECH_INTEGRATION.md）：成年配音演播的角色音，非克隆真实儿童声音。
 * 家长音色按病例已知照护者性别选择（CommunicationProfile.caregiverGender）；
 * 未知时明确回退平台默认音色（AudioDefaults.SPEAKER）并记日志，不装作已知身份。
 */
export const ROLE_VOICES = {
  childFemale: 'coder:female:cute',
  childMale: 'coder:male:cheerful',
  parentFemale: 'coder:female:canan',
  parentMale: 'coder:male:elegant',
  tutor: 'coder:male:default',
} as const;
const FALLBACK_VOICE = AudioDefaults.SPEAKER;

/** 家长音色偏好（纯函数，供回归测试）：已知性别选对应音色；未知明确回退平台默认音色。 */
export function resolveParentVoicePreference(caregiverGender: 'female' | 'male' | 'unknown'): string {
  if (caregiverGender === 'female') return ROLE_VOICES.parentFemale;
  if (caregiverGender === 'male') return ROLE_VOICES.parentMale;
  return FALLBACK_VOICE;
}

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

/** 能力探测执行器：默认为平台 SDK 真实调用；测试注入替身只验证分发逻辑，
 *  真实供应商链路由 scripts/verify-speech-sdk-smoke.ts 冒烟覆盖。 */
export interface SpeechProbeDeps {
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(text: string, speaker: string): Promise<{ audioUrl: string; audioSize: number }>;
  downloadAudio(url: string): Promise<Buffer>;
  recognize(base64Data: string, format: string): Promise<{ text: string }>;
}

function sdkProbeDeps(forwardHeaders?: Record<string, string>): SpeechProbeDeps {
  return {
    listVoices: () => new AudioClient(new Config(), forwardHeaders).listVoices(),
    synthesize: (text, speaker) =>
      new TTSClient(new Config(), forwardHeaders).synthesize({ text, speaker, audioFormat: 'mp3', sampleRate: 24000 }),
    downloadAudio: async (url) => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`探测音频下载失败 HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    },
    recognize: (base64Data, format) =>
      new ASRClient(new Config(), forwardHeaders).recognize({ base64Data, format }),
  };
}

/** 探测缓存：成功结果 60s 内共享（探测含真实最小 TTS/ASR 调用，避免每次页面加载消耗配额）；
 *  失败结果短暂缓存 5s（防连环探测），之后可恢复重试。 */
const capabilitiesCache = { at: 0, result: null as SpeechCapabilities | null };
const CAPABILITIES_OK_TTL_MS = 60_000;
const CAPABILITIES_FAIL_TTL_MS = 5_000;

/** 探测文本：中性核验语句，不含患者数据。 */
const PROBE_TEXT = '语音能力核验。';

/**
 * 能力探测（/api/speech/capabilities）：listVoices 只证明音色列表可达，不能推断 ASR/TTS 可用；
 * ASR/TTS 可用性分别经真实最小调用验证（合成短句 → 回灌识别）。ASR 探测依赖 TTS 探测音频，
 * TTS 失败时 ASR 无法验证，同样按 unavailable 处理——不宣称未经验证的可用。
 * 任一环节失败对应能力如实 unavailable，前端据此隐藏语音入口。
 */
export async function probeSpeechCapabilities(
  forwardHeaders?: Record<string, string>,
  deps: SpeechProbeDeps = sdkProbeDeps(forwardHeaders),
): Promise<SpeechCapabilities> {
  const cached = capabilitiesCache.result;
  if (cached) {
    const ttl = cached.asr === 'turn-based' && cached.tts === 'turn-based'
      ? CAPABILITIES_OK_TTL_MS
      : CAPABILITIES_FAIL_TTL_MS;
    if (Date.now() - capabilitiesCache.at < ttl) return { ...cached };
  }
  let voiceCount = 0;
  try {
    voiceCount = (await deps.listVoices()).length;
  } catch {
    voiceCount = 0;
  }
  let ttsOk = false;
  let asrOk = false;
  try {
    const synth = await deps.synthesize(PROBE_TEXT, FALLBACK_VOICE);
    const audio = await deps.downloadAudio(synth.audioUrl);
    ttsOk = true;
    try {
      await deps.recognize(audio.toString('base64'), 'mp3');
      asrOk = true;
    } catch {
      asrOk = false;
    }
  } catch {
    ttsOk = false;
    asrOk = false;
  }
  const result: SpeechCapabilities = {
    asr: asrOk ? 'turn-based' : 'unavailable',
    tts: ttsOk ? 'turn-based' : 'unavailable',
    voiceCount,
  };
  capabilitiesCache.at = Date.now();
  capabilitiesCache.result = result;
  return { ...result };
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
  const pediatricCase = getCase(session.caseId, session.sourceSnapshotVersion, session.id);
  if (message.actor === 'child') {
    preferred = pediatricCase.sex.includes('女') ? ROLE_VOICES.childFemale : ROLE_VOICES.childMale;
  } else if (message.actor === 'parent') {
    const profile = resolveAuditedCommunicationProfile(session.caseId, pediatricCase.age);
    if (profile.caregiverGender === 'unknown') {
      console.debug('[speech] 病例照护者性别未知，家长音色明确回退平台默认音色（不装作已知身份）');
    }
    preferred = resolveParentVoicePreference(profile.caregiverGender);
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
    if (!canChildSpeak(resolveAuditedCommunicationProfile(session.caseId, pediatricCase.age))) {
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
      data: { audioUrl: response.audioUrl },
    };
  } catch (error) {
    return { ok: false, error: mapProviderError('tts', error) };
  }
}

/** 测试注入缝：重置音色/能力探测缓存（仅测试使用，业务代码不调用）。 */
export function __resetVoiceCacheForTests(): void {
  voiceCache.at = 0;
  voiceCache.voices = null;
  voiceCache.ok = false;
  capabilitiesCache.at = 0;
  capabilitiesCache.result = null;
}

export type { VoiceTurnState };
