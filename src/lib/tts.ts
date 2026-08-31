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
    console.warn(`[tts] synthesis failed (persona=${opts.persona}):`, error instanceof Error ? error.message : error);
    return null;
  }
}
