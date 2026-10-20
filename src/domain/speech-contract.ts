/**
 * 语音契约（阶段 D，方案第 6 章）：平台真实能力为**轮次式语音**（录音→识别→确认→发送→播报），
 * 非实时流式。核验证据与边界见 docs/SPEECH_INTEGRATION.md。
 *
 * 契约铁律：
 *  1. 启用状态只来自服务端 /api/speech/capabilities 真实探测（listVoices），
 *     前端常量不决定可用性；探测失败按 unavailable 处理并隐藏语音入口。
 *  2. 学生语音轮必须经过「确认/编辑」：未确认的 ASR 转写不作为答、不自动发送。
 *  3. 不自动连录：一轮结束回到 idle，下一轮录音必须由用户显式开始。
 *  4. 不能言语患儿（childCapable=false）不播报语义台词；纯括注消息不进入语音合成（NOT_SPEAKABLE）。
 *  5. 本文件只包含纯类型与纯函数，不发起网络请求、不持有密钥；真实调用全部在服务端路由。
 */
export type SpeechMode = 'unavailable' | 'turn-based';

export interface SpeechCapabilities {
  asr: SpeechMode;
  tts: SpeechMode;
  /** 服务端探测到的可用音色数（用于诊断展示，不用于前端能力判定）。 */
  voiceCount: number;
}

/** 前端默认态：能力未知/未探测时按不可用处理，隐藏语音入口。 */
export const UNAVAILABLE_SPEECH_CAPABILITIES: Readonly<SpeechCapabilities> = Object.freeze({
  asr: 'unavailable',
  tts: 'unavailable',
  voiceCount: 0,
} as const);

/** /api/speech/capabilities 响应形状守卫：畸形响应按 unavailable 处理，不抛错给 UI。 */
export function isSpeechCapabilities(value: unknown): value is SpeechCapabilities {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<SpeechCapabilities>;
  return (
    (v.asr === 'unavailable' || v.asr === 'turn-based') &&
    (v.tts === 'unavailable' || v.tts === 'turn-based') &&
    typeof v.voiceCount === 'number' &&
    Number.isFinite(v.voiceCount) &&
    v.voiceCount >= 0
  );
}

export interface SpeechFailure {
  code:
    | 'UNAVAILABLE'
    | 'PERMISSION_DENIED' /** 麦克风授权被拒或服务端会话归属校验失败 */
    | 'INVALID_AUDIO'
    | 'TIMEOUT'
    | 'PROVIDER_ERROR'
    | 'MESSAGE_NOT_FOUND' /** 会话中不存在该消息（或非角色消息） */
    | 'NOT_SPEAKABLE' /** 纯括注/不能言语患儿消息，契约禁止合成 */
    | 'AUDIO_EXPIRED'; /** 签名音频 URL 已过期（默认 24h），需重新合成 */
  message: string;
  retryable: boolean;
}
export type SpeechResult<T> = { ok: true; data: T } | { ok: false; error: SpeechFailure };

/** 服务端 ASR 可接受的音频格式（平台 ASRClient 契约）。 */
export type SpeechAudioFormat = 'wav' | 'mp3' | 'ogg_opus' | 'm4a';

/** POST /api/speech/asr 请求：base64 直传，录音不落地对象存储。 */
export interface AsrRequest {
  base64Data: string;
  format: SpeechAudioFormat;
}
export interface AsrResponse {
  text: string;
}

/** POST /api/speech/tts 请求：只按 messageId 取学生本人会话中已存在的角色消息，
 *  TTS 不能自行生成新事实（text 不由客户端传入）。 */
export interface TtsRequest {
  sessionId: string;
  messageId: string;
}
export interface TtsResponse {
  audioUrl: string;
  /** 签名 URL 过期时间（ISO 8601），播放器过期后重新请求。 */
  expiresAt: string;
}

/** 消息语音元数据（方案第 11 章记录扩展）：
 *  语音提问经确认发送后记录 ASR 原文与是否编辑；评分只看确认后的语义内容。 */
export interface SpeechTurnMeta {
  inputMode: 'voice';
  asrRawText: string;
  transcriptEdited: boolean;
}

/** 由确认/编辑结果推导语音轮元数据（纯函数）：编辑过 = 确认文本与 ASR 原文不一致。 */
export function resolveSpeechTurnMeta(asrRawText: string, confirmedText: string): SpeechTurnMeta {
  return {
    inputMode: 'voice',
    asrRawText,
    transcriptEdited: confirmedText.trim() !== asrRawText.trim(),
  };
}

/** 语音轮状态机（纯转移表，无副作用）：
 *  idle → recording（用户开始录音）
 *  recording → transcribing（用户结束录音）| idle（取消）
 *  transcribing → confirming | failed
 *  confirming → sending（用户确认发送；确认态内含编辑转写）| idle（放弃）
 *  sending → idle（一轮完成；**无 sending → recording 边**，不自动连录）| confirming（发送失败，保留确认草稿可重试）
 *  failed → recording（用户重试）| idle
 */
export type VoiceTurnState = 'idle' | 'recording' | 'transcribing' | 'confirming' | 'sending' | 'failed';

export const VOICE_TURN_TRANSITIONS: Readonly<Record<VoiceTurnState, readonly VoiceTurnState[]>> = Object.freeze({
  idle: ['recording'],
  recording: ['transcribing', 'idle'],
  transcribing: ['confirming', 'failed'],
  confirming: ['sending', 'idle'],
  sending: ['idle', 'confirming'],
  failed: ['recording', 'idle'],
} as const);

export function canTransitionVoiceTurn(from: VoiceTurnState, to: VoiceTurnState): boolean {
  return VOICE_TURN_TRANSITIONS[from].includes(to);
}
