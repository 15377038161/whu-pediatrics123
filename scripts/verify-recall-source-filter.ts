/* eslint-disable no-console */
/**
 * 召回来源过滤真实只读核验（零 DB 写——persistSnapshot 无教师 token 即跳过；独立进程缓存不影响 dev server）：
 * 1) NRDS/肾病综合征：真实召回候选 → 可信标题过滤 → 异源/空标题拒绝计数与标题集合断言（仅标题与计数，不输出患者内容）；
 * 2) 真实路径 ensureCaseSnapshot：NRDS 快照不含已知混入分片 sha 前缀（895454f 实证 5591f340a272）、影像册媒体保留；
 * 3) D 类 3 项缺独立来源：失败关闭返回 null（不召回、不编造）；
 * 4) 别名：解析到源病例构建（caseId=源 id），别名名不产生可信标题。
 */
import { KnowledgeClient, Config } from 'coder-coding-dev-sdk';
import { ensureCaseSnapshot, filterTrustedRecallCandidates, trustedSourceTitles } from '../src/lib/case-snapshot';

const KB = '3821591';
/** 895454f 实证的 NRDS 混入分片（先天性肌力）sha256 前 12 位——内容无关的结构性污染指纹。 */
const CONTAMINATED_SHA_PREFIX = '5591f340a272';

async function recallRaw(client: KnowledgeClient, caseName: string): Promise<Array<{ title: string | null; content: string | null }>> {
  const variants = [caseName, `${caseName} 现病史 主诉 查体`, `${caseName} 诊断 诊疗经过`, `${caseName} 来源图片`];
  const raw: Array<{ title: string | null; content: string | null }> = [];
  for (const query of variants) {
    const result = await client.recall({ query, knowledgeBaseIds: [KB], topK: 10, recallThreshold: 0.2 });
    raw.push(...result.results.map((item) => ({ title: item.title, content: item.content })));
  }
  return raw;
}

async function main(): Promise<void> {
  const apiKey = process.env.CODER_CODING_API_KEY?.trim();
  const baseUrl = process.env.CODER_CODING_BASE_URL?.trim();
  if (!apiKey || !baseUrl) throw new Error('缺少知识库环境变量（CODER_CODING_API_KEY/CODER_CODING_BASE_URL）');
  const client = new KnowledgeClient(new Config({ apiKey, baseUrl, timeout: 30_000 }));
  let pass = 0;
  let fail = 0;
  function check(name: string, ok: boolean, detail: string): void {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
    if (ok) pass += 1;
    else fail += 1;
  }

  // 1) 候选过滤核验（真实召回，仅标题与计数输出）
  const probes: Array<[string, string]> = [
    ['新生儿呼吸窘迫综合征', '先天性肌无力.txt'],
    ['肾病综合征', '病例目录与调用交接.txt'],
  ];
  for (const [name, expectExcluded] of probes) {
    const raw = await recallRaw(client, name);
    const trusted = trustedSourceTitles(name);
    const kept = filterTrustedRecallCandidates(raw, trusted);
    const keptTitles = [...new Set(kept.map((i) => (i.title ?? '').trim()))].sort();
    const emptyTitles = raw.filter((i) => !(i.title ?? '').trim()).length;
    const excludedOk = !keptTitles.includes(expectExcluded);
    const trustedOnly = keptTitles.every((t) => trusted.includes(t));
    check(`${name} 可信标题过滤`, excludedOk && trustedOnly,
      `raw=${raw.length} kept=${kept.length} rejected=${raw.length - kept.length} 空标题=${emptyTitles} kept标题=${JSON.stringify(keptTitles)} 异源「${expectExcluded}」被拒=${excludedOk}`);
  }

  // 2) 真实路径端到端：NRDS 快照构建（无 token → persistSnapshot 跳过，零 DB 写）
  const nrds = await ensureCaseSnapshot('teacher-新生儿呼吸窘迫综合征');
  const nrdsBuilt = nrds !== null;
  check('NRDS ensureCaseSnapshot 构建成功', nrdsBuilt,
    nrdsBuilt ? `version=${nrds!.meta.version} chunkCount=${nrds!.meta.chunkCount} mediaCount=${nrds!.meta.mediaCount}` : 'null');
  if (nrdsBuilt) {
    const contaminated = nrds!.data.documents.some((d) => d.sha256.startsWith(CONTAMINATED_SHA_PREFIX));
    check('NRDS 快照不含已知混入分片（sha 5591f340a272 前缀）', !contaminated,
      `documents=${nrds!.data.documents.length} 污染分片存在=${contaminated}`);
    check('NRDS 影像册媒体保留（可信来源材料）', nrds!.media.length > 0, `media=${nrds!.media.length}`);
  }

  // 3) D 类 3 项缺独立来源：失败关闭 null（不召回、不编造）
  for (const id of ['teacher-新生儿脑梗死', 'teacher-支气管肺炎', 'teacher-格林巴利综合征']) {
    const r = await ensureCaseSnapshot(id);
    check(`${id} 缺来源失败关闭`, r === null, `result=${r === null ? 'null（资料不足）' : '非null（违规构建）'}`);
  }

  // 4) 别名解析：按源病例构建或资料不足（别名名不产生可信标题，不编造）
  const alias = await ensureCaseSnapshot('teacher-毛细支气管炎');
  check('别名 teacher-毛细支气管炎 解析源病例',
    alias === null || alias.data.caseId === 'teacher-急性毛细支气管炎',
    alias === null ? 'null（源无召回命中，资料不足，未编造）' : `caseId=${alias.data.caseId}`);

  console.log(`\n==== 召回来源过滤真实只读核验：${pass}/${pass + fail} 通过 ====`);
  process.exitCode = fail === 0 ? 0 : 1;
}
void main();
