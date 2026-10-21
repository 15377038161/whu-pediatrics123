/**
 * audio-pcm 纯函数回归测试（V01）：
 *  - 重采样：48kHz→16kHz 长度正确、恒幅信号插值不畸变、同采样率直通、空数据安全；
 *  - WAV 编码：44 字节 RIFF 头 + 16bit 单声道 + 采样率写入正确；
 *  - 上限常量与服务端 speechAsrSchema / speech-service 公式一致（预检与网关统一）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASR_SAMPLE_RATE,
  MAX_ASR_BASE64_LENGTH,
  concatPcmChunks,
  encodeWavBytes,
  resamplePcm,
} from '../src/lib/audio-pcm';

test('resamplePcm：48kHz → 16kHz 目标长度为源长度的 1/3', () => {
  const source = new Float32Array(4800);
  for (let i = 0; i < source.length; i += 1) source[i] = Math.sin((i / 4800) * Math.PI * 2);
  const target = resamplePcm(source, 48_000, 16_000);
  assert.equal(target.length, 1600);
});

test('resamplePcm：恒幅直流信号重采样后幅值不变（插值端点无畸变）', () => {
  const source = new Float32Array(96).fill(0.5);
  const target = resamplePcm(source, 48_000, 16_000);
  assert.equal(target.length, 32);
  for (const sample of target) assert.ok(Math.abs(sample - 0.5) < 1e-5);
});

test('resamplePcm：同采样率直通返回原数组，不引入插值误差', () => {
  const source = new Float32Array([0.1, -0.2, 0.3]);
  assert.equal(resamplePcm(source, 16_000, 16_000), source);
});

test('resamplePcm：空数据安全，返回空数组不抛错', () => {
  assert.equal(resamplePcm(new Float32Array(0), 48_000, 16_000).length, 0);
});

test('encodeWavBytes：44 字节 RIFF 头 + 单声道 16bit PCM + 采样率写入正确', () => {
  const pcm = new Float32Array([0, 0.5, -0.5, 1]);
  const buffer = encodeWavBytes(pcm, ASR_SAMPLE_RATE);
  const view = new DataView(buffer);
  const tag = (offset: number) =>
    String.fromCharCode(...Array.from({ length: 4 }, (_, i) => view.getUint8(offset + i)));
  assert.equal(buffer.byteLength, 44 + pcm.length * 2);
  assert.equal(tag(0), 'RIFF');
  assert.equal(view.getUint32(4, true), 36 + pcm.length * 2);
  assert.equal(tag(8), 'WAVE');
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 1); // 单声道
  assert.equal(view.getUint32(24, true), ASR_SAMPLE_RATE);
  assert.equal(view.getUint32(28, true), ASR_SAMPLE_RATE * 2);
  assert.equal(view.getUint16(34, true), 16); // 位深
  assert.equal(tag(36), 'data');
  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(46, true), Math.floor(0.5 * 0x7fff));
  assert.equal(view.getInt16(48, true), Math.floor(-0.5 * 0x8000));
});

test('concatPcmChunks：按顺序拼接为单段，总长度一致', () => {
  const merged = concatPcmChunks([new Float32Array([1, 2]), new Float32Array([3])], 3);
  assert.deepEqual(Array.from(merged), [1, 2, 3]);
});

test('MAX_ASR_BASE64_LENGTH 与服务端公式一致，16kHz 降采样后 120s 录音远低于上限', () => {
  assert.equal(MAX_ASR_BASE64_LENGTH, Math.ceil((10 * 1024 * 1024) / 3) * 4);
  // 120s @ 16kHz 单声道 16bit ≈ 3.84MB 原始 → base64 约 5.12MB，远低于上限（降采样目的）
  const wav120sBytes = 44 + 16_000 * 120 * 2;
  const base64Length = Math.ceil(wav120sBytes / 3) * 4;
  assert.ok(base64Length < MAX_ASR_BASE64_LENGTH);
});
