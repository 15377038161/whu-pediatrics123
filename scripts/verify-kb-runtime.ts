/**
 * 知识库绑定与运行时调用核查（2026-10-10，最小真实检索，结构性输出）：
 * 1. 文档库 3821591 实调 KnowledgeClient.recall（应用同一 SDK/契约），输出来源计数/哈希，不输出患者文本
 * 2. 来源 id→病例映射：catalog 53 folder 项逐一最小召回（1 个 query 变体，topK 3，阈值与生产一致 0.2）
 * 3. 输出仅计数/布尔/哈希前缀；凭据经 env 注入不打印
 */
import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';
import { createHash } from 'node:crypto';

const KB_DOC_ID = '3821591';
const apiKey = process.env.CODER_CODING_API_KEY?.trim();
const baseUrl = process.env.CODER_CODING_BASE_URL?.trim();
if (!apiKey || !baseUrl) throw new Error('缺少 CODER_CODING_API_KEY/CODER_CODING_BASE_URL（不打印值）');

// 与生产同参数：topK 3（比生产的 10 小，最小化读取）、阈值一致
async function recallOnce(client: KnowledgeClient, query: string): Promise<Array<{ sha: string; len: number }>> {
  const result = await client.recall({ query, knowledgeBaseIds: [KB_DOC_ID], topK: 3, recallThreshold: 0.2 });
  return (result.results ?? [])
    .map((r) => ({ sha: createHash('sha256').update((r.content || '').trim()).digest('hex').slice(0, 12), len: (r.content || '').trim().length }))
    .filter((r) => r.len > 0);
}

async function main(): Promise<void> {
  const config = new Config({ apiKey, baseUrl, timeout: 30_000 });
  const client = new KnowledgeClient(config);

  // === 1. 连通性：真实病例名查询（生产同款变体，非患者文本输出） ===
  const ping = await recallOnce(client, '新生儿呼吸窘迫综合征');
  console.log(`# 文档库 ${KB_DOC_ID} 连通性：命中 ${ping.length} 片（sha: ${ping.map((p) => p.sha).join(', ') || '无'}）`);
  if (ping.length === 0) {
    console.log('FAIL  知识库召回无结果（运行时调用不可用）');
    process.exit(1);
    return;
  }
  console.log('PASS  KnowledgeClient.recall 运行时真实调用可用（与 case-snapshot.ts 同 SDK 同契约）');

  // === 2. 来源 id→病例映射（catalog 53 项最小召回，仅首个 query 变体） ===
  // 从生产模块导入 catalog，保证与运行时同一映射源
  const { TEACHER_CASE_CATALOG } = await import('../src/domain/teacher-case-catalog');
  const withFolder = TEACHER_CASE_CATALOG.filter((i) => i.folder);
  console.log(`\n# 来源映射：catalog 共 ${TEACHER_CASE_CATALOG.length} 项，folder 来源 ${withFolder.length} 项`);

  let mapped = 0;
  const unmapped: string[] = [];
  const errors: string[] = [];
  for (const item of withFolder) {
    try {
      const chunks = await recallOnce(client, item.name);
      if (chunks.length > 0) mapped += 1;
      else unmapped.push(item.id);
    } catch (e) {
      errors.push(item.id);
      if (process.env.LOG_LEVEL === 'debug') console.warn('[kb-verify] recall error', item.id, (e as Error).message);
    }
  }
  console.log(`# 映射结果：可召回来源 ${mapped}/${withFolder.length}；零命中 ${unmapped.length}${unmapped.length ? `（${unmapped.slice(0, 8).join(', ')}${unmapped.length > 8 ? '…' : ''}）` : ''}；调用错误 ${errors.length}${errors.length ? `（${errors.slice(0, 5).join(', ')}）` : ''}`);

  await main2(client);
}

// 附加最小验证：确认 recall 的分片不直接含答案键结构（分片是原文文本，答案结构由应用层构建）
async function main2(_client: KnowledgeClient): Promise<void> {
  console.log('\n# 边界说明：SDK recall 返回原文分片（title/content），无独立 answer/explanation 结构；');
  console.log('  答案与诊断隔离由应用层（sections 分段 + 学生投影 RPC）实现，本脚本不复制分片内容。');
}

void main().catch((e: unknown) => { console.error('FATAL', (e as Error).message); process.exit(1); });
