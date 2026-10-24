/**
 * 5 例云端召回为空诊断探针（只读）：
 * 对 cloud-snapshot 全量固化中召回为空的病例，绕过可信标题过滤，
 * 直接查看 KB 原始召回返回了哪些标题——区分两种根因：
 *   A) KB 有该病例材料但标题与 catalog name 不一致（→ 教师统一标题或登记映射）
 *   B) KB 根本没有该病例材料（→ 教师补传来源文档）
 * 不修改任何运行时行为（app 的失败关闭逻辑保持原样）。
 *
 * 用法：pnpm exec tsx scripts/case-audit/probe-empty-recalls.mts
 */
import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';
import { KB_DOC_ID, trustedSourceTitles } from '@/lib/case-snapshot';

const CASES = [
  '新生儿rh溶血性黄疸',
  '过敏性紫癜',
  '矮小症',
  '急性毛细支气管炎',
  '传染性单核细胞增多症',
];

const client = new KnowledgeClient(new Config({
  apiKey: process.env.CODER_CODING_API_KEY!.trim(),
  baseUrl: process.env.CODER_CODING_BASE_URL!.trim(),
  timeout: 30_000,
}));

for (const name of CASES) {
  console.log(`\n=== ${name}（可信标题：${trustedSourceTitles(name).join(' / ')}）===`);
  const variants = [name, `${name} 现病史 主诉 查体`, `${name} 来源图片`];
  const titles = new Map<string, number>();
  let rawCount = 0;
  for (const query of variants) {
    try {
      const result = await client.recall({ query, knowledgeBaseIds: [KB_DOC_ID], topK: 10, recallThreshold: 0.2 });
      for (const item of result.results) {
        rawCount += 1;
        const t = (item.title ?? '(无标题)').trim();
        titles.set(t, (titles.get(t) ?? 0) + 1);
      }
    } catch (error) {
      console.log(`  查询异常[${query.slice(0, 20)}]: ${(error as Error).message.slice(0, 80)}`);
    }
  }
  console.log(`  原始召回 ${rawCount} 条，涉及标题 ${titles.size} 个：`);
  for (const [t, n] of [...titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${n}× ${t || '(空标题)'}`);
  }
  if (titles.size === 0) console.log('    （KB 无任何相关分片 → 根因 B：来源未上传）');
  // 根因判定：无标题分片内容是否含病名（含=材料在 KB 但标题元数据缺失；不含=材料可能不属本病例）
  const emptyTitleChunks: string[] = [];
  for (const query of variants) {
    try {
      const result = await client.recall({ query, knowledgeBaseIds: [KB_DOC_ID], topK: 10, recallThreshold: 0.2 });
      for (const item of result.results) {
        if (!(item.title ?? '').trim() && item.content) emptyTitleChunks.push(item.content);
      }
    } catch { /* 查询异常已在上方记录 */ }
  }
  const hit = emptyTitleChunks.filter((c) => c.includes(name));
  console.log(`  根因判定：无标题分片 ${emptyTitleChunks.length} 条，内容含病名 ${hit.length} 条`);
  if (hit.length > 0) {
    console.log(`  → 根因 A'：材料在 KB 但分片标题元数据缺失（失败关闭拒收正确）；教师补登标题后可召回`);
    console.log(`    样本：${hit[0].replace(/\s+/g, ' ').slice(0, 100)}`);
  } else if (emptyTitleChunks.length > 0) {
    console.log(`  → 无标题分片不含本病例名，材料归属不可证；需教师人工核对 KB 元数据`);
  } else {
    console.log(`  → 根因 B：来源未上传，需教师补传`);
  }
}
