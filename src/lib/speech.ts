'use client';

/**
 * 客户端语音链（阶段 D，方案第 6 章）：麦克风 WAV 采集 + 语音 API 封装。
 * 依据 docs/SPEECH_INTEGRATION.md 的最小链路实现：
 *   麦克风（浏览器 WAV 采集）→ base64 上传 /api/speech/asr → 学生确认/编辑转写
 *   → 既有 /api/agent/turn 事件发送（由工作台完成）→ /api/speech/tts → 签名 URL 队列播放
 *
 * 契约约束（speech-contract.ts）：
 *  - 录音按轮采集，base64 直传识别，不落地对象存储；
 *  - 未确认的转写不作为答、不自动发送（确认/编辑在组件层完成）；
 *  - 不自动连录（状态机由组件按 VOICE_TURN_TRANSITIONS 驱动）。
 */

import { authedFetch, AuthedApiError } from '@/lib/authed-api';
import { ASR_SAMPLE_RATE, MAX_ASR_BASE64_LENGTH, concatPcmChunks, encodeWavBytes, resamplePcm } from '@/lib/audio-pcm';
import type { SpeechCapabilities } from '@/domain/speech-contract';
import { UNAVAILABLE_SPEECH_CAPABILITIES, isSpeechCapabilities } from '@/domain/speech-contract';

/** 能力探测：探测失败按 unavailable 返回（前端据此隐藏语音入口，不抛错给 UI）。 */
export async function fetchSpeechCapabilities(): Promise<SpeechCapabilities> {
  try {
    const data = await authedFetch<unknown>('/api/speech/capabilities');
    if (!isSpeechCapabilities(data)) return { ...UNAVAILABLE_SPEECH_CAPABILITIES };
    return data;
  } catch {
    return { ...UNAVAILABLE_SPEECH_CAPABILITIES };
  }
}

/** 麦克风授权被拒（浏览器权限拒绝/无设备）。 */
export class MicPermissionError extends Error {
  constructor(message = '麦克风不可用，请在浏览器中允许麦克风权限后重试。') {
    super(message);
    this.name = 'MicPermissionError';
  }
}

export interface WavRecorder {
  /** 结束录音并产出 WAV Blob（自动写入 44 字节 RIFF 头，16bit PCM 单声道）。 */
  stop(): Promise<Blob>;
  /** 放弃本段录音（释放资源，不产出数据）。 */
  cancel(): void;
  /** 已录制毫秒数。 */
  durationMs(): number;
  /** 达到时长上限时触发一次的回调（组件据此自动停录，仍需用户确认转写）。 */
  onLimitReached: null | (() => void);
}

/** 单轮录音时长上限：防止误录产生超长音频（ASR 上限远高于此）。 */
export const MAX_RECORDING_MS = 120_000;

/** 开始 WAV 录音：getUserMedia + Web Audio 采集（跨浏览器一致产出 wav 格式，ASR 直收）。 */
export async function startWavRecording(maxDurationMs: number = MAX_RECORDING_MS): Promise<WavRecorder> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
      throw new MicPermissionError();
    }
    throw new MicPermissionError('无法访问麦克风，请检查设备后重试。');
  }
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((track) => track.stop());
    throw new MicPermissionError('当前浏览器不支持音频采集，请使用文字输入。');
  }
  const context = new AudioCtx();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor 在各浏览器仍可用且无需额外 worklet 文件；块大小 4096 降低回调频率。
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let totalSamples = 0;
  let stopped = false;
  let limitFired = false;
  let limitTimer = 0;
  const recorder: WavRecorder = {
    onLimitReached: null,
    durationMs: () => Math.round((totalSamples / context.sampleRate) * 1000),
    cancel: () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(limitTimer);
      processor.disconnect();
      source.disconnect();
      void context.close();
      stream.getTracks().forEach((track) => track.stop());
    },
    stop: () =>
      new Promise<Blob>((resolve) => {
        if (stopped) {
          resolve(new Blob());
          return;
        }
        stopped = true;
        window.clearTimeout(limitTimer);
        // 断开前 flush 当前块，保证最后一帧数据进入 chunks。
        processor.disconnect();
        source.disconnect();
        const sampleRate = context.sampleRate;
        void context.close();
        stream.getTracks().forEach((track) => track.stop());
        // 上传前统一降采样到 16kHz 单声道（V01）：120s 录音的 base64 体从 ~15MB（48kHz）
        // 降到 ~5MB，避免大体 POST 被网关拒绝/超时；durationMs 仍按原始采样率计。
        const pcm = resamplePcm(concatPcmChunks(chunks, totalSamples), sampleRate, ASR_SAMPLE_RATE);
        resolve(new Blob([encodeWavBytes(pcm, ASR_SAMPLE_RATE)], { type: 'audio/wav' }));
      }),
  };
  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    totalSamples += input.length;
    if (!limitFired && totalSamples / context.sampleRate * 1000 >= maxDurationMs) {
      limitFired = true;
      recorder.onLimitReached?.();
    }
  };
  source.connect(processor);
  processor.connect(context.destination);
  limitTimer = window.setTimeout(() => {
    if (!limitFired) {
      limitFired = true;
      recorder.onLimitReached?.();
    }
  }, maxDurationMs + 500);
  return recorder;
}

/** Float32 块 → WAV 的编码与 16kHz 降采样已抽至 src/lib/audio-pcm.ts（纯函数，可单测）。 */

/** Blob → base64（不加 data: 前缀，服务端 ASRClient 直收 base64Data）。 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('音频读取失败，请重试。'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('音频读取失败，请重试。'));
        return;
      }
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * ASR 失败统一映射为可恢复的友好提示（V01）：网关/代理层返回非 JSON 响应（如 503）时
 * authedFetch 抛 INVALID_RESPONSE（message 形如 "HTTP 503"）——绝不把裸状态码透给前台，
 * 统一改为「可重试或改用文字输入」的提示；服务端 JSON 信封内的 message 本身已是友好文案，原样保留。
 */
function friendlyAsrError(cause: unknown): Error {
  if (cause instanceof AuthedApiError) {
    if (cause.code === 'AUTH_REQUIRED') return cause;
    if (/^HTTP \d+$/.test(cause.message)) {
      return new Error('语音服务暂时不可用，请稍后重试，或改用文字输入。');
    }
    return new Error(cause.message);
  }
  return new Error('语音上传失败，请检查网络后重试，或改用文字输入。');
}

/** ASR 转写：上传 WAV（16kHz 降采样后）→ 返回待确认转写文本（未确认前不作为答）。
 *  上传前预检 base64 上限（与服务端同一公式），超限直接友好失败，不上传必败请求。 */
export async function requestTranscription(audio: Blob): Promise<string> {
  const base64Data = await blobToBase64(audio);
  if (base64Data.length > MAX_ASR_BASE64_LENGTH) {
    throw new Error('录音过长（超过 10MB），请缩短后重新录音，或改用文字输入。');
  }
  try {
    const data = await authedFetch<{ text: string }>('/api/speech/asr', {
      method: 'POST',
      body: JSON.stringify({ base64Data, format: 'wav' }),
    });
    return data.text;
  } catch (cause) {
    throw friendlyAsrError(cause);
  }
}

/** 角色消息 TTS：按 messageId 取已校验消息的签名音频 URL。
 *  SDK 契约未暴露签名 URL 有效期，播放失败时由调用方重新请求合成。 */
export async function requestMessageAudio(sessionId: string, messageId: string): Promise<{ audioUrl: string }> {
  return authedFetch<{ audioUrl: string }>('/api/speech/tts', {
    method: 'POST',
    body: JSON.stringify({ sessionId, messageId }),
  });
}
