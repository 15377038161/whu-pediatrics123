/* 图片库 3821625 检索契约只读探针（零 DB 写、零账号操作）：
 * 实测 KnowledgeClient.recall 对图片知识库（type=10）的返回形态：
 * 条数 / title 形态 / content 是否含图片 URL / URL 域名与扩展名分布 / 文本长度分布。
 * 只输出形态与计数，不输出患者正文。
 */
import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';

const KB_IMAGE_ID = '3821625';

async function probe(query: string): Promise<void> {
  const client = new KnowledgeClient(new Config());
  const result = await client.recall({ query, knowledgeBaseIds: [KB_IMAGE_ID], topK: 10, recallThreshold: 0.2 });
  const items = result.results ?? [];
  console.log(`query=${query} 命中=${items.length}`);
  let urlCount = 0;
  const domains = new Map<string, number>();
  const exts = new Map<string, number>();
  const titleForms = new Map<string, number>();
  const contentLens: number[] = [];
  for (const item of items) {
    const title = item.title ?? '';
    titleForms.set(title.endsWith('.pdf') ? 'pdf标题' : title.endsWith('.txt') ? 'txt标题' : title ? '其他标题' : '空标题', (titleForms.get(title) ?? 0) + 1);
    const content = item.content ?? '';
    contentLens.push(content.length);
    const urls = content.match(/https?:\/\/[^\s)"'）】]+/g) ?? [];
    if (urls.length > 0) urlCount += 1;
    for (const u of urls.slice(0, 3)) {
      try {
        const host = new URL(u).host;
        domains.set(host, (domains.get(host) ?? 0) + 1);
        const m = u.match(/\.(png|jpe?g|webp|gif|pdf|mp4)(?:[?#]|$)/i);
        const extKey = m?.[1]?.toLowerCase() ?? '无扩展名';
        exts.set(extKey, (exts.get(extKey) ?? 0) + 1);
      } catch { /* 忽略非法 URL */ }
    }
  }
  console.log(`  标题形态=${JSON.stringify([...titleForms])} 含URL条目=${urlCount}/${items.length} content长度[min~max]=${contentLens.length ? Math.min(...contentLens) + '~' + Math.max(...contentLens) : 'n/a'}`);
  console.log(`  URL域名=${JSON.stringify([...domains])} 扩展名=${JSON.stringify([...exts])}`);
}

async function main(): Promise<void> {
  await probe('胸部影像 X线');
  await probe('川崎病 冠状动脉');
  await probe('新生儿呼吸窘迫综合征 胸片');
}
main().catch((e) => { console.error('FATAL ' + (e instanceof Error ? e.message.split('\n')[0] : e)); process.exit(1); });
