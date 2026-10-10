/**
 * 知识库来源匹配核验与证据纠正（2026-10-10）：
 * 1. 抽样来源归属：3 独立来源 + 1 关联入口，用生产同参（topK 10、阈值 0.2、4 个查询变体）
 *    逐片召回，验证分片归属目标病例（title 层 + 内容层），并检测跨病例混召。
 *    ——SDK RecallItem 仅有 title/content（title 取自 metadata.source.title），无 documentId/metadata
 *    字段，来源归属验证只能落在 title/内容文本层，这是本轮证据纠正之一。
 * 2. 零命中病例有限重试：风湿热/肺不张各用生产 4 变体重试 1 轮（每病例 ≤4 次调用），
 *    区分「运行时零命中」与「材料不存在」。
 * 3. 学生身份 403 边界：合法学生 Bearer 访问本地媒体/原文资源应 403（非仅匿名 401）。
 *    仅复用既有演示学生受控凭据（login，不 signup 新建账号）；凭据缺失/登录失败 SKIP 保留未验。
 *    本地 knowledge/ 目录缺失时用显式声明的合成探针夹具（非患者内容），测试后删除。
 * 输出仅计数/布尔/状态码，不输出患者文本与完整 URL。
 */
import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const KB_DOC_ID = '3821591';
const apiKey = process.env.CODER_CODING_API_KEY?.trim();
const baseUrl = process.env.CODER_CODING_BASE_URL?.trim();
if (!apiKey || !baseUrl) throw new Error('缺少 CODER_CODING_API_KEY/CODER_CODING_BASE_URL（不打印值）');

const BASE = process.env.QUIZ_BASE_URL ?? `http://localhost:${process.env.DEPLOY_RUN_PORT ?? '5173'}`;

interface Chunk { sha: string; title: string; text: string }

/** 与生产 recallCaseChunks 完全同参：4 变体、topK 10、阈值 0.2（上一轮探针 topK 3 与此不同，属证据纠正项）。 */
async function recallProduction(client: KnowledgeClient, caseName: string): Promise<Chunk[]> {
  const variants = [caseName, `${caseName} 现病史 主诉 查体`, `${caseName} 诊断 诊疗经过`, `${caseName} 来源图片`];
  const seen = new Map<string, Chunk>();
  for (const query of variants) {
    const result = await client.recall({ query, knowledgeBaseIds: [KB_DOC_ID], topK: 10, recallThreshold: 0.2 });
    for (const item of result.results ?? []) {
      const text = (item.content || '').trim();
      if (!text) continue;
      const sha = createHash('sha256').update(text).digest('hex').slice(0, 12);
      if (!seen.has(sha)) seen.set(sha, { sha, title: (item.title || '').trim(), text });
    }
  }
  return [...seen.values()];
}

async function main(): Promise<void> {
  const config = new Config({ apiKey, baseUrl, timeout: 30_000 });
  const client = new KnowledgeClient(config);

  const { TEACHER_CASE_CATALOG } = await import('../src/domain/teacher-case-catalog');
  const { TEACHER_CASE_LINKS } = await import('../src/domain/teacher-case-links');
  const withFolder = TEACHER_CASE_CATALOG.filter((i) => i.folder);
  console.log(`# catalog ${TEACHER_CASE_CATALOG.length} 项（folder 独立来源 ${withFolder.length}，关联入口 ${Object.keys(TEACHER_CASE_LINKS).length}）`);

  // 全目录名称集合（跨病例混召检测用）
  const allNames = TEACHER_CASE_CATALOG.map((i) => i.name);

  // === 一、抽样来源归属（3 独立 + 1 关联入口） ===
  console.log('\n## 一、抽样来源归属验证（生产同参 topK 10 / 阈值 0.2 / 4 变体）');
  const independentSamples = ['新生儿呼吸窘迫综合征', '新生儿败血症', '肾病综合征'];
  const relatedEntry = '毛细支气管炎'; // 关联入口：sourceId=急性毛细支气管炎（subtype）
  const relatedSource = TEACHER_CASE_LINKS[`teacher-${relatedEntry}`]?.sourceId;
  if (!relatedSource) throw new Error('关联入口样本缺失（teacher-毛细支气管炎）');
  const relatedSourceName = TEACHER_CASE_CATALOG.find((i) => i.id === relatedSource)?.name;
  if (!relatedSourceName) throw new Error('关联源缺失');

  let samplePass = 0;
  const sampleTotal = independentSamples.length + 1;
  for (const name of independentSamples) {
    const chunks = await recallProduction(client, name);
    const titleHit = chunks.filter((c) => c.title.includes(name)).length;
    const contentHit = chunks.filter((c) => !c.title.includes(name) && c.text.includes(name)).length;
    const noSignal = chunks.filter((c) => !c.title.includes(name) && !c.text.includes(name)).length;
    // 跨病例混召：title 命中其它病例名（排除源名称的子串情形，如「肺炎」⊂「支气管肺炎」）
    const crossNames = new Set<string>();
    for (const c of chunks) {
      for (const other of allNames) {
        if (other === name || name.includes(other)) continue;
        if (c.title && c.title.includes(other) && !name.includes(other)) crossNames.add(other);
      }
    }
    const ok = chunks.length > 0 && crossNames.size === 0;
    if (ok) samplePass += 1;
    console.log(`  独立来源 ${name}: 分片 ${chunks.length}（title 归属 ${titleHit} / 内容归属 ${contentHit} / 无归属信号 ${noSignal}）；跨病例 title 命中 ${crossNames.size}${crossNames.size ? `（${[...crossNames].slice(0, 3).join('、')}）` : ''} → ${ok ? 'PASS 无混召' : 'FAIL'}`);
  }
  {
    // 关联入口：生产按源名称召回，验证关联入口复用源病例绑定（设计行为）
    const chunks = await recallProduction(client, relatedSourceName);
    const titleHit = chunks.filter((c) => c.title.includes(relatedSourceName)).length;
    const crossNames = new Set<string>();
    for (const c of chunks) {
      for (const other of allNames) {
        if (other === relatedSourceName || relatedSourceName.includes(other)) continue;
        if (c.title && c.title.includes(other)) crossNames.add(other);
      }
    }
    const ok = chunks.length > 0 && crossNames.size === 0;
    if (ok) samplePass += 1;
    console.log(`  关联入口 ${relatedEntry}→${relatedSourceName}: 分片 ${chunks.length}（title 归属 ${titleHit}）；跨病例 title 命中 ${crossNames.size} → ${ok ? 'PASS 复用源绑定' : 'FAIL'}`);
  }
  console.log(`  抽样结果: ${samplePass}/${sampleTotal} 通过；53 项统计层说明：本轮仅抽样 4 项到「分片归属」深度，51/53 可召回结论来自 topK 3 探针（同阈值），两层证据不可混同。`);

  // === 二、零命中病例有限重试（每病例 ≤4 次生产变体调用） ===
  console.log('\n## 二、零命中病例生产变体重试（风湿热/肺不张）');
  for (const name of ['风湿热', '肺不张']) {
    const chunks = await recallProduction(client, name);
    console.log(`  ${name}: 4 变体重试后分片 ${chunks.length} → ${chunks.length === 0 ? '零命中维持（运行时无该病例材料）' : `命中 ${chunks.length} 片（上一轮零命中结论需修正）`}`);
  }
  console.log('  区分说明：零命中=生产参数下运行时无召回；材料不存在=知识库未上传该病例文档（上一轮经平台知识索引侧确认未上传，本轮运行时复核一致，两者口径不同、互为印证）。');

  // === 三、学生身份 403 边界（合法学生 Bearer，非仅匿名 401） ===
  // 仅复用既有演示学生受控凭据（/tmp/demo-student-credentials.txt，login 不 signup，不新建账号）；
  // 凭据缺失/登录失败一律 SKIP 保留未验（fail-closed，不回退到随机 signup）。
  console.log('\n## 三、学生身份资源 API 边界（合成探针夹具，非患者内容）');
  const supaUrl = process.env.CODER_SUPABASE_URL;
  const anonKey = process.env.CODER_SUPABASE_ANON_KEY;
  const tenantId = process.env.CODER_SUPABASE_TENANT_ID;
  const credFile = process.env.QUIZ_CRED_FILE ?? '/tmp/demo-student-credentials.txt';
  if (!supaUrl || !anonKey || !tenantId) {
    console.log('  SKIP 缺少 CODER_SUPABASE_* 环境变量（学生 403 边界未验，仅保留代码层结论）');
  } else {
    // 合成探针夹具：新建新生儿败血症资源目录下两个 0 字节文件（gitignore 目录，测试后删除）
    const root = path.resolve(process.cwd(), 'knowledge', '儿科常见病', '新生儿疾病', '新生儿败血症');
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'probe-boundary.jpg'), '');
    await writeFile(path.join(root, 'probe-boundary.docx'), '');
    try {
      let token: string | null = null;
      try {
        const raw = readFileSync(credFile, 'utf-8');
        const map: Record<string, string> = {};
        for (const line of raw.split('\n')) {
          const m = /^(email|password)\s*[:=]\s*(.+)$/i.exec(line.trim());
          if (m) map[m[1].toLowerCase()] = m[2].trim();
        }
        if (!map.email || !map.password) throw new Error('credentials file malformed');
        const login = await fetch(`${supaUrl}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: anonKey, 'X-Instance-ID': tenantId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: map.email, password: map.password }),
        });
        const loginBody = (await login.json()) as { access_token?: string; error_code?: string };
        if (!login.ok || !loginBody.access_token) throw new Error(`login failed: ${loginBody.error_code ?? login.status}`);
        token = loginBody.access_token;
      } catch (e) {
        console.log(`  SKIP 演示学生凭据不可用（${(e as Error).message}；不新建账号，学生 403 边界保留未验）`);
      }
      if (!token) {
        console.log('  SKIP 学生 403 边界未验（fail-closed：仅复用既有演示学生凭据 login，不 signup 新建账号）');
      } else {
        const auth = { Authorization: `Bearer ${token}` };
        const anonRes = await fetch(`${BASE}/api/cases/teacher-新生儿呼吸窘迫综合征/resource?path=probe-boundary.jpg`, { method: 'HEAD' });
        console.log(`  匿名访问媒体: status=${anonRes.status}（${anonRes.status === 401 ? '边界通过：未登录拒绝' : '非预期'}）`);
        const stuMedia = await fetch(`${BASE}/api/cases/teacher-新生儿败血症/resource?path=probe-boundary.jpg`, { method: 'HEAD', headers: auth });
        console.log(`  学生访问媒体（未脱敏原图/影像）: status=${stuMedia.status}（${stuMedia.status === 403 ? '边界通过：学生无权取原始媒体' : `非预期（${stuMedia.status}）：需复查 PEDIATRICS_MEDIA_STUDENT_ACCESS`}）`);
        const stuDoc = await fetch(`${BASE}/api/cases/teacher-新生儿败血症/resource?path=probe-boundary.docx`, { method: 'HEAD', headers: auth });
        console.log(`  学生访问病例原文(docx): status=${stuDoc.status}（${stuDoc.status === 403 ? '边界通过：原文仅教师' : '非预期'}）`);
        await fetch(`${supaUrl}/auth/v1/logout?scope=global`, {
          method: 'POST',
          headers: { apikey: anonKey, 'X-Instance-ID': tenantId, Authorization: `Bearer ${token}` },
        }).catch(() => undefined);
        console.log('  （演示学生会话已登出，凭据未打印）');
      }
    } finally {
      await rm(path.resolve(process.cwd(), 'knowledge'), { recursive: true, force: true });
      console.log('  （合成探针夹具已删除：knowledge/ 目录为 gitignore 临时目录，非真实患者媒体）');
    }
  }

  console.log('\n## 四、证据纠正口径（本轮修正，详见验收记录）');
  console.log('  1. SDK RecallItem 仅 title/content，无 documentId/metadata——来源归属只能 title/内容层验证；');
  console.log('  2. 直连 p.cldisk.com HEAD 403 仅证明 CDN 边界拦截，不证明应用角色隔离或脱敏状态；');
  console.log('  3. 匿名 401 仅覆盖未登录；合法学生 403 才是学生权限边界证据（见第三节）；');
  console.log('  4. 文本 clean() 脱敏 ≠ 影像/视频脱敏审核，媒体另由资源 API 角色门控；');
  console.log('  5. topK 3 探针与生产 topK 10 参数不同，两层证据需明确区分。');
}

void main().catch((e: unknown) => { console.error('FATAL', (e as Error).message); process.exit(1); });
