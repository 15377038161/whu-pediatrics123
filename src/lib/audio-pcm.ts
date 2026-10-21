/**
 * 音频 PCM 纯函数（阶段 D，V01 修复）：录音块重采样与 WAV 编码。
 *
 * 本模块只含纯函数与常量，无浏览器/网络依赖，可被客户端与单测共同引用：
 *  - 客户端录音以浏览器 AudioContext 原生采样率（常见 44.1/48kHz）采集，
 *    上传前统一线性插值降采样到 16kHz 单声道（语音 ASR 足够），把 120s 录音的
 *    base64 上传体从 ~15MB 降到 ~5MB，避免大体 POST 被网关拒绝/超时（V01 取证结论）；
 *  - MAX_ASR_BASE64_LENGTH 与服务端 speechAsrSchema / speech-service 的上限保持同一公式，
 *    客户端预检超限直接给友好错误，不上传必败请求。
 */

/** ASR 目标采样率（16kHz 单声道 16bit PCM 是语音识别的通行规格）。 */
export const ASR_SAMPLE_RATE = 16_000;

/** 服务端 ASR base64 上限（原始音频 ≤ 10MB，base64 膨胀 4/3）——与服务端公式一致。 */
export const MAX_ASR_BASE64_LENGTH = Math.ceil((10 * 1024 * 1024) / 3) * 4;

/** Float32 块序列按原采样率拼接为单段。 */
export function concatPcmChunks(chunks: readonly Float32Array[], totalSamples: number): Float32Array {
  const data = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}

/**
 * 线性插值重采样（fromRate → toRate）。语音识别场景线性插值足够；
 * fromRate === toRate 或空数据时原样返回（不引入无谓插值误差）。
 */
export function resamplePcm(
  pcm: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || pcm.length === 0) return pcm;
  const targetCount = Math.max(1, Math.round((pcm.length * toRate) / fromRate));
  const output = new Float32Array(targetCount);
  for (let i = 0; i < targetCount; i += 1) {
    const pos = (i * fromRate) / toRate;
    const index = Math.floor(pos);
    const frac = pos - index;
    const a = pcm[index] ?? 0;
    const b = pcm[index + 1] ?? a;
    output[i] = a + (b - a) * frac;
  }
  return output;
}

/** Float32 PCM → 16bit 单声道 WAV Blob 容器字节（ArrayBuffer）。
 *  写入 44 字节 RIFF 头；调用方负责包装为 Blob（浏览器）或用于断言（测试）。 */
export function encodeWavBytes(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
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
  view.setUint32(40, pcm.length * 2, true);
  let offset = 44;
  for (let i = 0; i < pcm.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
