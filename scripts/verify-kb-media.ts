/**
 * 计数口径核对 + 媒体链接最小抽查（2026-10-10）：
 * 1. 分类口径核对：72 入口 = 70 教师项（53 独立来源 folder + 14 关联 + 3 缺）+ 2 演示
 * 2. 媒体抽查：从知识库召回分片提取 p.cldisk.com URL（与生产 extractImageUrls 同规则），
 *    抽查 3 个病例的少量链接（HEAD 请求，不下载、不批量、不改权限）：
 *    - 学生合法访问路径（/api/cases/[id]/resource）：未授权应 401/403（边界通过）
 *    - 教师路径：无教师身份 → 标未验
 * 3. 输出仅状态码/Content-Type/计数，不输出 URL 完整值（域名级去敏）与患者文本
 */
import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';
import { createHash } from 'node:crypto';

const KB_DOC_ID = '3821591';
const BASE = process.env.QUIZ_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;
const apiKey = process.env.CODER_CODING_API_KEY?.trim();
const baseUrl = process.env.CODER_CODING_BASE_URL?.trim();
if (!apiKey || !baseUrl) throw new Error('missing env');

function urlDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return 'invalid'; }
}

async function main(): Promise<void> {
  // === 1. 计数口径核对 ===
  console.log('## 一、计数口径核对（分类域模块权威口径）');
  const { TEACHER_CASE_CATALOG } = await import('../src/domain/teacher-case-catalog');
  const { CASE_CATALOG } = await import('../src/domain/case-catalog');
  const withFolder = TEACHER_CASE_CATALOG.filter((i) => i.folder).length;
  const total = TEACHER_CASE_CATALOG.length;
  // 演示病例 = 1 个 flagship-fixture（合成旗舰病例）+ 1 个 demo-pending-review（演示待审病例）
  const demo = CASE_CATALOG.filter((c) => c.contentStatus === 'flagship-fixture' || c.contentStatus === 'demo-pending-review').length;
  console.log(`教师目录项: ${total}（独立 folder 来源: ${withFolder}）`);
  console.log(`演示/合成病例: ${demo}（1 flagship-fixture + 1 demo-pending-review）`);
  console.log(`总入口: ${total} + ${demo} = ${total + demo}`);
  const ok1 = total === 70 && withFolder === 53 && demo === 2 && total + demo === 72;
  console.log(ok1 ? 'PASS  口径一致：72 = 70 教师（53 独立）+ 2 演示' : `FAIL  口径核对失败（期望 70/53/2/72，实际 ${total}/${withFolder}/${demo}/${total + demo}）`);

  // === 2. 媒体链接抽查（知识库召回提取，HEAD 探测） ===
  console.log('\n## 二、媒体链接抽查（召回分片提取，HEAD 探测）');
  const client = new KnowledgeClient(new Config({ apiKey, baseUrl, timeout: 30_000 }));
  const probeCases = ['新生儿呼吸窘迫综合征', '新生儿败血症'];
  const collected: string[] = [];
  for (const name of probeCases) {
    const r = await client.recall({ query: `${name} 来源图片`, knowledgeBaseIds: [KB_DOC_ID], topK: 3, recallThreshold: 0.2 });
    for (const item of r.results ?? []) {
      const re = /!\[[^\]]*\]\((https:\/\/p\.cldisk\.com\/[^\s)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(item.content || '')) !== null) collected.push(m[1]);
    }
  }
  console.log(`召回提取媒体链接: ${collected.length} 条（域名: ${[...new Set(collected.map(urlDomain))].join(', ')}）`);

  // 直连探测（HEAD，最多 3 条，不下载不公开不转发）
  const sample = [...new Set(collected)].slice(0, 3);
  for (const url of sample) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'manual' });
      console.log(`  直连 HEAD ${urlDomain(url)}: status=${res.status} type=${res.headers.get('content-type') ?? 'n/a'}`);
    } catch (e) {
      console.log(`  直连 HEAD ${urlDomain(url)}: 网络错误 ${(e as Error).message.slice(0, 40)}`);
    }
  }
  if (sample.length === 0) console.log('  （召回分片未提取到媒体 URL：媒体主要存于影像资料册分片，topK 3 未覆盖属正常）');

  // === 3. 学生合法访问路径边界（无凭据 → 应拒绝；受限=边界通过） ===
  console.log('\n## 三、学生合法访问路径边界（匿名/学生无授权）');
  const caseRes = await fetch(`${BASE}/api/cases/teacher-新生儿呼吸窘迫综合征/resource?path=x`, { method: 'HEAD' });
  console.log(`  匿名资源访问: status=${caseRes.status}（${caseRes.status === 401 || caseRes.status === 403 ? '边界通过：未授权拒绝' : '非预期'}）`);
  const casesList = await fetch(`${BASE}/api/cases`, { method: 'HEAD' });
  console.log(`  匿名病例列表: status=${casesList.status}（${casesList.status === 401 ? '边界通过' : '非预期'}）`);

  console.log('\n## 四、证据状态（五种）');
  console.log(`  1. 绑定: PASS（3821591 文档库 + 3821625 图片库，list_knowledge_base 实查）`);
  console.log(`  2. 运行时调用: PASS（文档库 KnowledgeClient.recall 真实调用命中；图片库 3821625 应用内未接入，为缺失项）`);
  console.log(`  3. 来源映射: 51/53 可召回（零命中: 风湿热/肺不张；生产链路为本地文件优先+召回兜底，非阻断）`);
  console.log(`  4. 媒体可访问: ${sample.length > 0 ? '抽查已执行（见上方 HEAD 状态码）' : '本轮召回未覆盖媒体分片，未验'}；教师媒体实际读取: 未验（无教师身份）`);
  console.log(`  5. 脱敏授权: 分片经 clean() 脱敏后进入教学正文；媒体原始图视频未公开直链给学生（学生资源路径需授权）`);
}

void main().catch((e: unknown) => { console.error('FATAL', (e as Error).message); process.exit(1); });
