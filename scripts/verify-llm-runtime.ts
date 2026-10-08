/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 文本 AI 实测（项目运行时链路 invokeCozeAI → 官方 coder-coding-dev-sdk → CODER_CODING_* 凭据）。
 * export {} 显式声明本文件为 ES 模块，避免与其它无 import 的脚本共享全局作用域导致
 * "Duplicate function implementation"（main 重名）构建失败。
 */
export {};
async function main() {
  const { invokeCozeAI, describeAIConfig } = await import('../src/lib/coze-ai');
  const summary = describeAIConfig();
  console.log(`配置: source=${summary.apiKeySource} baseUrl=${summary.baseUrl} sdk=${summary.sdkVersion}`);
  try {
    const result = await invokeCozeAI({
      messages: [{ role: 'user', content: '请只回复两个字：收到' }],
      llmConfig: { temperature: 0.1 },
    });
    console.log(`invokeCozeAI实测: 成功 content="${result.content.slice(0, 40)}" attempts=${result.attempts}`);
  } catch (error) {
    console.log(`invokeCozeAI实测: 失败 ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
    process.exit(2);
  }
}

main().catch((e) => { console.error('脚本失败:', e); process.exit(1); });
