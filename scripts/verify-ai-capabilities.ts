/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * AI 能力实测：文本 LLM + ASR 能力核验（经 getAIConfig 的 CODER_CODING_* 凭据，不输出密钥）。
 * TTS 已由用户取消（2026-10-09），相关实测移除。
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

  // 2. ASR 状态核验（仅记录契约与实测定性，不做语音调用）
  //    口径（2026-10-09）：ASR 已取消交付。旧 coze-coding-dev-sdk 的 ASRClient 用 CODER_CODING_* 凭据
  //    实测调用返回 404——该 404 仅说明当前接入方式不可用，不推断平台全部语音能力。
  //    官方 coder-coding-dev-sdk 无语音模块；平台插件/任务流清单为空。
  try {
    const sdk = await import('coze-coding-dev-sdk');
    console.log(`ASR状态: 旧SDK含ASRClient=${typeof sdk.ASRClient}（类型存在）；此前实测调用 404（当前接入不可用）`);
    console.log('ASR状态: 官方 coder-coding-dev-sdk 无语音模块；ASR/TTS 均已取消交付（用户指令 2026-10-09）');
  } catch (error) {
    console.log(`ASR状态: 检查失败 ${String(error)}`.slice(0, 150));
  }
}
main().catch((e) => { console.error('脚本失败:', e); process.exit(1); });
