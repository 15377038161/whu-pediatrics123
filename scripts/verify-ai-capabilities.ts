/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AI 能力实测：文本 LLM + TTS 合成（经 getAIConfig 的 CODER_CODING_* 凭据，不输出密钥）。
 * export {} 显式声明本文件为 ES 模块，避免与其它无 import 的脚本共享全局作用域导致
 * "Duplicate function implementation"（main 重名）构建失败。
 */
export {};
async function main() {
  const { Config, LLMClient } = await import('coze-coding-dev-sdk');

  // 1. 文本 LLM 实测
  const apiKey = process.env.CODER_CODING_API_KEY?.trim()
    || process.env.CODER_CODING_MODEL_API_KEY?.trim()
    || process.env.COZE_WORKLOAD_IDENTITY_API_KEY?.trim();
  const baseUrl = process.env.CODER_CODING_BASE_URL?.trim()
    || process.env.CODER_CODING_MODEL_BASE_URL?.trim()
    || process.env.COZE_INTEGRATION_BASE_URL?.trim();
  console.log(`凭据状态: apiKey=${apiKey ? '存在' : '缺失'} baseUrl=${baseUrl ? '存在' : '缺失'}`);

  const config = new Config({ ...(apiKey ? { apiKey } : {}), ...(baseUrl ? { baseUrl } : {}) });

  try {
    const llm = new LLMClient(config);
    const resp = await llm.invoke([{ role: 'user', content: '回复两个字：收到' }], { temperature: 0.1 });
    console.log(`LLM实测: 成功 content="${resp.content.slice(0, 40)}"`);
  } catch (error) {
    console.log(`LLM实测: 失败 ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
  }

  // 2. TTS 实测
  try {
    const { TTSClient } = await import('coze-coding-dev-sdk');
    const tts = new TTSClient(config);
    const resp = await tts.synthesize({
      uid: `probe-${Date.now()}`,
      text: '你好，这是语音合成测试。',
      speaker: 'zh_female_xiaohe_uranus_bigtts',
      audioFormat: 'mp3',
      sampleRate: 24000,
    });
    const audioResp = await fetch(resp.audioUri);
    const buf = Buffer.from(await audioResp.arrayBuffer());
    console.log(`TTS实测: 成功 audioUri状态=${audioResp.status} 音频字节数=${buf.length}`);
  } catch (error) {
    console.log(`TTS实测: 失败 ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
  }

  // 3. ASR 能力核验（仅类型，不做长音频调用）
  try {
    const sdk = await import('coze-coding-dev-sdk');
    console.log(`ASR能力: ASRClient=${typeof sdk.ASRClient}（SDK含recognize方法）`);
  } catch (error) {
    console.log(`ASR能力: 检查失败 ${String(error)}`.slice(0, 150));
  }
}

main().catch((e) => { console.error('脚本失败:', e); process.exit(1); });
