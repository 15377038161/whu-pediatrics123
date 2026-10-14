/** TODO(语音后续接入)：只定义扩展边界，不提供实现、HTTP端点或界面入口。
 *  ASR启用前需用户明确麦克风授权；TTS启用前需确定音色、鉴权、隐私与配额。
 *  浏览器音频不得直接传到未授权服务。真实查体音效/视频不属于此契约。
 */
export const speechCapabilities = Object.freeze({ asr: 'unavailable', tts: 'unavailable' } as const);

export interface SpeechFailure {
  code: 'UNAVAILABLE' | 'PERMISSION_DENIED' | 'INVALID_AUDIO' | 'TIMEOUT' | 'PROVIDER_ERROR';
  message: string;
  retryable: boolean;
}
export type SpeechResult<T> = { ok: true; data: T } | { ok: false; error: SpeechFailure };

export interface TranscriptionInput {
  audio: Blob;
  language: string;
  signal?: AbortSignal;
}
export interface TranscriptionOutput { text: string; language: string }
export interface SynthesisInput {
  text: string;
  role: 'child' | 'parent' | 'narrator';
  language: string;
  signal?: AbortSignal;
}
export interface SynthesisOutput { audio: Blob; contentType: string }

/** 未来由明确的provider实现此接口；本轮没有默认adapter，不能返回假成功。 */
export interface SpeechAdapter {
  transcribe(input: TranscriptionInput): Promise<SpeechResult<TranscriptionOutput>>;
  synthesize(input: SynthesisInput): Promise<SpeechResult<SynthesisOutput>>;
}
