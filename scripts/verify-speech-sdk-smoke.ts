/**
 * 阶段 D 补验（D-验收-01）：平台 SDK 真实 TTS / ASR 各自调用的冒烟证据固化。
 *
 * 与 docs/SPEECH_INTEGRATION.md 验收表的口径一致：
 *  - 本脚本只证明「服务端 SDK 调用链路真实可用」（TTS 合成 + ASR 识别回灌）；
 *    不证明真实麦克风/手机采集，也不证明受鉴权业务路由（另见路由验收）。
 *  - 输出纪律：不打印签名 URL、令牌或患者原文；只记录 SDK 版本、音频格式、
 *    字节数、识别是否符合预期、每步成败与耗时。整体退出码：全部成功 0，任一步失败 1。
 */
export {};

const EXPECTED_KEYWORDS = ['语音', '核验'];

async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  const startedAt = Date.now();
  try {
    await fn();
    console.log(`[PASS] ${name} (${Date.now() - startedAt}ms)`);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`[FAIL] ${name} (${Date.now() - startedAt}ms): ${detail.slice(0, 160)}`);
    return false;
  }
}

async function main() {
  const { TTSClient, ASRClient, AudioClient, Config } = await import('coder-coding-dev-sdk');
  const { readFileSync } = await import('node:fs');
  const sdkVersion = (() => {
    try {
      const pkg = JSON.parse(readFileSync('node_modules/coder-coding-dev-sdk/package.json', 'utf8')) as { version?: string };
      return pkg.version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  })();
  console.log(`SDK版本=${sdkVersion}`);

  let synthesized: Buffer | null = null;
  let synthesizedFormat = '';
  const results: Array<[string, boolean]> = [];

  results.push(['listVoices', await step('AudioClient.listVoices（音色可达性探测，不代表 ASR/TTS 可用）', async () => {
    const voices = await new AudioClient(new Config()).listVoices();
    if (!Array.isArray(voices) || voices.length === 0) throw new Error('音色列表为空');
    console.log(`  音色数=${voices.length} 供应商=${[...new Set(voices.map((v) => v.provider))].join(',')}`);
  })]);

  results.push(['tts', await step('TTSClient.synthesize（真实合成，mp3/24kHz）', async () => {
    const response = await new TTSClient(new Config()).synthesize({
      text: '语音链路核验，第一句。',
      speaker: 'coder:female:canan',
      audioFormat: 'mp3',
      sampleRate: 24000,
    });
    console.log(`  合成响应 audioSize=${response.audioSize}(B) audioUrl=已脱敏不输出`);
    const audioResp = await fetch(response.audioUrl);
    if (!audioResp.ok) throw new Error(`签名 URL 下载失败 HTTP ${audioResp.status}`);
    const buf = Buffer.from(await audioResp.arrayBuffer());
    if (buf.length === 0) throw new Error('下载音频为空');
    synthesized = buf;
    synthesizedFormat = 'mp3';
    console.log(`  下载字节数=${buf.length}(B) 格式=${synthesizedFormat}`);
  })]);

  results.push(['asr', await step('ASRClient.recognize（真实识别，base64 直传）', async () => {
    if (!synthesized) throw new Error('缺少上一步合成音频，跳过识别');
    const result = await new ASRClient(new Config()).recognize({
      base64Data: synthesized.toString('base64'),
      format: synthesizedFormat,
    });
    const matched = EXPECTED_KEYWORDS.every((kw) => result.text.includes(kw));
    console.log(`  识别文本长度=${result.text.length} 关键词符合=${matched} 识别文本=脱敏不输出`);
    if (!matched) throw new Error('识别结果未包含预期关键词');
  })]);

  const failed = results.filter(([, ok]) => !ok).map(([name]) => name);
  console.log(`汇总: ${results.map(([n, ok]) => `${n}=${ok ? 'PASS' : 'FAIL'}`).join(' ')}`);
  if (failed.length > 0) {
    console.error(`冒烟失败步骤: ${failed.join(',')}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('脚本失败:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
