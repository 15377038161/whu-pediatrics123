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

import { authedFetch } from '@/lib/authed-api';
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
        resolve(encodeWav(chunks, totalSamples, sampleRate));
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

/** Float32 块序列 → 16bit PCM 单声道 WAV Blob。 */
function encodeWav(chunks: Float32Array[], totalSamples: number, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率 = sampleRate * 声道 * 位深/8
  view.setUint16(32, 2, true); // 块对齐
  view.setUint16(34, 16, true); // 位深
  writeString(36, 'data');
  view.setUint32(40, totalSamples * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

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

/** ASR 转写：上传 WAV → 返回待确认转写文本（未确认前不作为答）。失败抛 AuthedApiError。 */
export async function requestTranscription(audio: Blob): Promise<string> {
  const base64Data = await blobToBase64(audio);
  const data = await authedFetch<{ text: string }>('/api/speech/asr', {
    method: 'POST',
    body: JSON.stringify({ base64Data, format: 'wav' }),
  });
  return data.text;
}

/** 角色消息 TTS：按 messageId 取已校验消息的签名音频 URL（默认 24 小时有效）。 */
export async function requestMessageAudio(sessionId: string, messageId: string): Promise<{ audioUrl: string; expiresAt: string }> {
  return authedFetch<{ audioUrl: string; expiresAt: string }>('/api/speech/tts', {
    method: 'POST',
    body: JSON.stringify({ sessionId, messageId }),
  });
}
