import { TTSClient } from 'coze-coding-dev-sdk';
import { getAIConfig } from '@/lib/coze-ai';

export type VoicePersona = 'child' | 'parent' | 'narrator';

const SPEAKER_MAP: Record<VoicePersona, string> = {
  child: 'saturn_zh_female_keainvsheng_tob',
  parent: 'zh_female_santongyongns_saturn_bigtts',
  narrator: 'zh_female_xiaohe_uranus_bigtts',
};

const cache = new Map<string, Buffer>();
const CACHE_MAX = 64;

/**
 * 平台网关 TTS 端点未开通熔断（2026-10-09 实测取证）：
 * SDK TTSClient 请求 `${baseUrl}/api/v3/tts/unidirectional`，当前网关返回 404；
 * 同网关 LLM（modelBaseUrl /llm/v1）与搜索（/search/query）均正常，排除整体故障，
 * 判定为平台网关未开通 TTS 模型端点（官方 coder-coding-dev-sdk 1.0.0 亦无 TTS 能力）。
 * 404 属于配置性缺口而非瞬时故障，重试无意义且产生无效请求；
 * 熔断后直接走降级（返回 null → 前端回退浏览器 Web Speech 播报），
 * TTL 到期后自动放行重试，平台开通端点后无需改代码即恢复。
 */
const TTS_ENDPOINT_404_BREAKER_MS = 10 * 60 * 1000;
let tts404BreakerUntil = 0;

/** 读取 404 熔断状态（供诊断脚本/健康检查使用，不暴露内部细节）。 */
export function isTTSEndpointBroken(): boolean {
  return Date.now() < tts404BreakerUntil;
}

function extractStatusCode(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number') return statusCode;
  return undefined;
}

function cacheKey(speaker: string, text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return `${speaker}:${h}`;
}

export function personaToSpeaker(persona: VoicePersona): string {
  return SPEAKER_MAP[persona] ?? SPEAKER_MAP.narrator;
}

export async function synthesizeSpeech(opts: {
  text: string;
  persona: VoicePersona;
  forwardHeaders?: Record<string, string>;
}): Promise<Buffer | null> {
  const speaker = personaToSpeaker(opts.persona);
  const key = cacheKey(speaker, opts.text);

  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  // 404 熔断期内直接降级，不再对未开通的网关端点发起无效请求
  if (isTTSEndpointBroken()) {
    console.warn('[tts] endpoint marked unavailable (gateway 404 breaker active), degrade to browser speech');
    return null;
  }

  try {
    const client = new TTSClient(getAIConfig(), opts.forwardHeaders);
    const resp = await client.synthesize({
      uid: `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: opts.text,
      speaker,
      audioFormat: 'mp3',
      sampleRate: 24000,
    });

    const audioResp = await fetch(resp.audioUri);
    if (!audioResp.ok) throw new Error(`audio fetch failed: ${audioResp.status}`);
    const buffer = Buffer.from(await audioResp.arrayBuffer());

    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, buffer);

    return buffer;
  } catch (error) {
    const status = extractStatusCode(error);
    if (status === 404) {
      // 端点未开通（配置性缺口）：开启熔断，避免持续无效重试
      tts404BreakerUntil = Date.now() + TTS_ENDPOINT_404_BREAKER_MS;
      console.warn(`[tts] gateway returned 404 for tts endpoint (endpoint not provisioned, not a transient failure), breaker active ${TTS_ENDPOINT_404_BREAKER_MS / 60000}min; degrade to browser speech. persona=${opts.persona}`);
      return null;
    }
    console.warn(`[tts] synthesis failed (persona=${opts.persona}, status=${status ?? 'n/a'}):`, error instanceof Error ? error.message : error);
    return null;
  }
}
