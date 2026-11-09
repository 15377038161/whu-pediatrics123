'use client';

import { authedFetch, AuthedApiError } from '@/lib/authed-api';
import { ASR_SAMPLE_RATE, concatPcmChunks, encodeWavBytes, resamplePcm } from '@/lib/audio-pcm';
import type { SpeechCapabilities, VoiceRecordingResult } from '@/domain/speech-contract';
import { UNAVAILABLE_SPEECH_CAPABILITIES, isSpeechCapabilities } from '@/domain/speech-contract';

export async function fetchSpeechCapabilities(): Promise<SpeechCapabilities> {
  try {
    const data = await authedFetch<unknown>('/api/speech/capabilities');
    return isSpeechCapabilities(data) ? data : { ...UNAVAILABLE_SPEECH_CAPABILITIES };
  } catch {
    return { ...UNAVAILABLE_SPEECH_CAPABILITIES };
  }
}

export class MicPermissionError extends Error {
  constructor(message = '麦克风不可用，请在浏览器中允许麦克风权限后重试。') {
    super(message);
    this.name = 'MicPermissionError';
  }
}

export interface WavRecording {
  blob: Blob;
  durationMs: number;
}

export interface WavRecorder {
  stop(): Promise<WavRecording>;
  cancel(): void;
  durationMs(): number;
  onLimitReached: null | (() => void);
  onInterrupted: null | (() => void);
}

export const MAX_RECORDING_MS = 20_000;

/** One user gesture owns one recorder. Every exit releases the microphone and audio graph. */
export async function startWavRecording(
  maxDurationMs: number = MAX_RECORDING_MS,
  onLevel?: (level: number) => void,
): Promise<WavRecorder> {
  if (!window.isSecureContext) throw new MicPermissionError('当前页面不是安全连接，浏览器不允许录音。请通过HTTPS或本机localhost打开。');
  const policy=(document as Document & {permissionsPolicy?:{allowsFeature(name:string):boolean};featurePolicy?:{allowsFeature(name:string):boolean}});
  if((policy.permissionsPolicy??policy.featurePolicy)?.allowsFeature('microphone')===false)throw new MicPermissionError('当前内嵌预览不允许麦克风。请在独立浏览器标签打开同一HTTPS页面再试；仅开启站点权限无法解除内嵌限制。');
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicPermissionError('当前浏览器无法访问麦克风，请使用文字输入。');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) {
      throw new MicPermissionError('浏览器未允许本次录音。若站点权限已开启，请检查系统麦克风隐私权限及内嵌预览限制，并确认授权的是当前域名。');
    }
    if (error instanceof DOMException && ['NotFoundError', 'DevicesNotFoundError'].includes(error.name)) {
      throw new MicPermissionError('未检测到可用的录音设备，请连接麦克风或使用文字输入。');
    }
    throw new MicPermissionError('无法启动录音，请检查麦克风是否被其他应用占用。');
  }
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((track) => track.stop());
    throw new MicPermissionError('当前浏览器不支持音频采集，请使用文字输入。');
  }
  const context = new AudioCtx();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let totalSamples = 0;
  let stopped = false;
  let limitFired = false;
  let limitTimer = 0;
  const cleanup = () => {
    window.clearTimeout(limitTimer);
    processor.onaudioprocess = null;
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    void context.close().catch(() => undefined);
  };
  const recorder: WavRecorder = {
    onLimitReached: null,
    onInterrupted: null,
    durationMs: () => Math.round((totalSamples / context.sampleRate) * 1000),
    cancel: () => {
      if (stopped) return;
      stopped = true;
      cleanup();
    },
    stop: () => new Promise<WavRecording>((resolve) => {
      if (stopped) { resolve({ blob: new Blob(), durationMs: 0 }); return; }
      stopped = true;
      const durationMs = recorder.durationMs();
      const sampleRate = context.sampleRate;
      cleanup();
      const pcm = resamplePcm(concatPcmChunks(chunks, totalSamples), sampleRate, ASR_SAMPLE_RATE);
      resolve({ blob: new Blob([encodeWavBytes(pcm, ASR_SAMPLE_RATE)], { type: 'audio/wav' }), durationMs });
    }),
  };
  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    totalSamples += input.length;
    let sum = 0;
    for (let index = 0; index < input.length; index += 1) sum += input[index] * input[index];
    onLevel?.(Math.min(1, Math.sqrt(sum / Math.max(1, input.length)) * 4));
    if (!limitFired && totalSamples / context.sampleRate * 1000 >= maxDurationMs) {
      limitFired = true;
      recorder.onLimitReached?.();
    }
  };
  stream.getAudioTracks().forEach((track) => {
    track.onended = () => { if (!stopped) recorder.onInterrupted?.(); };
  });
  source.connect(processor);
  processor.connect(context.destination);
  try { await context.resume(); } catch {
    recorder.cancel();
    throw new MicPermissionError('录音启动失败，请重新按住说话，或使用文字输入。');
  }
  limitTimer = window.setTimeout(() => {
    if (!limitFired) { limitFired = true; recorder.onLimitReached?.(); }
  }, maxDurationMs + 500);
  return recorder;
}

function friendlySpeechError(cause: unknown): Error {
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return new Error('语音识别已取消，原有输入内容未改变。');
  }
  if (cause instanceof AuthedApiError) {
    if (cause.code === 'AUTH_REQUIRED') return cause;
    if (/^HTTP \d+$/.test(cause.message) || cause.code === 'TIMEOUT') {
      return new Error('语音服务暂时不可用，请稍后重试，或改用文字输入。');
    }
    return new Error(cause.message);
  }
  return new Error('语音上传失败，请检查网络后重试，或改用文字输入。');
}

/** ASR and real-recording storage share one request; text remains usable when storage degrades. */
export async function requestVoiceTurn(
  sessionId: string,
  recording: WavRecording,
  signal?: AbortSignal,
): Promise<VoiceRecordingResult> {
  if (recording.blob.size > 10 * 1024 * 1024) throw new Error('录音过长，请缩短后重新录音。');
  const body = new FormData();
  body.append('audio', recording.blob, 'question.wav');
  body.append('durationMs', String(recording.durationMs));
  try {
    return await authedFetch<VoiceRecordingResult>(
      `/api/sessions/${sessionId}/voice`, { method: 'POST', body, signal },
    );
  } catch (cause) {
    throw friendlySpeechError(cause);
  }
}

export async function requestMessageAudio(sessionId: string, messageId: string): Promise<{ audioUrl: string }> {
  return authedFetch<{ audioUrl: string }>('/api/speech/tts', {
    method: 'POST', body: JSON.stringify({ sessionId, messageId }),
  });
}

export async function requestStudentAudio(sessionId: string, messageId: string): Promise<{ audioUrl: string }> {
  return authedFetch<{ audioUrl: string }>(`/api/sessions/${sessionId}/voice?messageId=${encodeURIComponent(messageId)}`);
}
