/**
 * 召回覆盖缺失根因探针（只读）：
 * 云端审计发现 48 例快照中 43 例 exam 段为空、44 例 tests 段为空。
 * 本探针对代表性病例绕过可信标题过滤直查 KB，区分三种根因：
 *   (b)  查体/辅检分片在 KB 且标题可信，但相似度/topK 未召回 → 代码侧可修
 *   (a') 分片在 KB 但标题元数据缺失/不可信 → 教师补登标题（同 5 例空召回）
 *   (a)  KB 根本没有该病例的查体/辅检内容 → 教师补传来源文档
 * 不修改任何运行时行为。
 *
 * 用法：pnpm exec tsx scripts/case-audit/probe-recall-coverage.mts
 */
import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';
import { KB_DOC_ID, trustedSourceTitles } from '@/lib/case-snapshot';

const CASES = ['急性喉炎', '特发性血小板减少性紫癜', '川崎病'];

const client = new KnowledgeClient(new Config({
  apiKey: process.env.CODER_CODING_API_KEY!.trim(),
  baseUrl: process.env.CODER_CODING_BASE_URL!.trim(),
  timeout: 30_000,
}));

const EXAM_KW = /查体|体格检查|T\s*[:：]?\s*3\d|咽部|心率|呼吸音|啰音/;
const TEST_KW = /10\^9|10\^12|g\/L|mmol|辅检|辅助检查|血常规/;

for (const name of CASES) {
  console.log(`\n=== ${name}（可信标题：${trustedSourceTitles(name).join(' / ')}）===`);
  const trusted = new Set(trustedSourceTitles(name));
  const queries = [name, `${name} 查体 体格检查`, `${name} 血常规 辅助检查 辅检`, `${name} 现病史 主诉`];
  const seen = new Map<string, { trusted: boolean; hits: string[]; score: number }>();
  for (const query of queries) {
    try {
      const result = await client.recall({ query, knowledgeBaseIds: [KB_DOC_ID], topK: 10, recallThreshold: 0.2 });
      for (const item of result.results) {
        const content = item.content ?? '';
        const key = content.slice(0, 60);
        const title = (item.title ?? '').trim();
        const hits: string[] = [];
        if (EXAM_KW.test(content)) hits.push('查体');
        if (TEST_KW.test(content)) hits.push('辅检');
        if (content.includes(name)) hits.push('病名');
        const prev = seen.get(key);
        const score = typeof item.score === 'number' ? item.score : -1;
        if (!prev || hits.length > prev.hits.length) {
          seen.set(key, { trusted: trusted.has(title), hits: [...new Set([...(prev?.hits ?? []), ...hits])], score });
        }
      }
    } catch (error) {
      console.log(`  查询异常[${query.slice(0, 16)}]: ${(error as Error).message.slice(0, 80)}`);
    }
  }
  const chunks = [...seen.entries()];
  const examChunks = chunks.filter(([, v]) => v.hits.includes('查体'));
  const testChunks = chunks.filter(([, v]) => v.hits.includes('辅检'));
  console.log(`  去重分片 ${chunks.length} 条；含查体痕迹 ${examChunks.length} 条（可信 ${examChunks.filter(([, v]) => v.trusted).length}）；含辅检痕迹 ${testChunks.length} 条（可信 ${testChunks.filter(([, v]) => v.trusted).length}）`);
  for (const [key, v] of chunks.slice(0, 12)) {
    console.log(`    [${v.trusted ? '可信' : '不可信'}|${v.score.toFixed(2)}|${v.hits.join('+') || '无痕迹'}] ${key.replace(/\s+/g, ' ')}`);
  }
  const examTrusted = examChunks.filter(([, v]) => v.trusted).length;
  const examAll = examChunks.length;
  if (examAll > 0 && examTrusted > 0) console.log('  → 根因 (b)：查体分片在 KB 且标题可信，召回未覆盖 → 代码侧可修');
  else if (examAll > 0) console.log("  → 根因 (a')：查体分片在 KB 但标题不可信/缺失 → 教师补登标题");
  else console.log('  → 根因 (a)：KB 无该病例查体内容 → 教师补传来源文档');
}
