/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 53 份受控审核病例 → 逐例幂等初始化 SQL 生成器（不直接写库）。
 *
 * 职责：
 * 1. 逐例读取 knowledge/teaching-cases/*.json，recordSchema 校验 + 文件名/caseId 一致性 + catalog 在册校验；
 * 2. 版本指纹与教师导入通道同一算法（documents sha256 聚合哈希截 16 位），保证与既有导入/恢复链路兼容；
 * 3. 生成"逐例"幂等 SQL（单例事务：INSERT ... ON CONFLICT (case_id,version) DO NOTHING）到 /tmp（不进 Git），
 *    经平台管理工具（db_execute）执行——不伪造教师 JWT、不走匿名写接口、不导出 service-role；
 * 4. 完整事实写入 facts+answers 逐例配对；DO NOTHING 不覆盖 DB 既有记录与历史版本；
 *    绝不以召回片段替代完整 53 例。
 * 5. 不触碰 case_publication 表（教师下架决定不受初始化影响）。
 *
 * 输出：
 * - /tmp/case53-init/cases/NN-<caseId>.sql：单例事务 SQL（begin; 2 inserts; commit;）
 * - /tmp/case53-init/manifest.json：去标识清单（序号/caseId/版本/facts字节数/documents字节数），供写入后逐例核验。
 */
export {};

async function main() {
  const { recordSchema, getKnowledgeRoot } = await import('../src/lib/teacher-case-data');
  const { computeImportVersion, buildFactsPayloadForInit } = await import('../src/lib/teacher-case-import');
  const { TEACHER_CASE_CATALOG } = await import('../src/domain/teacher-case-catalog');
  const { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } = await import('node:fs');
  const path = (await import('node:path')).default;

  const dir = path.join(getKnowledgeRoot(), 'teaching-cases');
  const files = readdirSync(dir).filter((n: string) => n.endsWith('.json')).sort();
  const catalogIds = new Set(TEACHER_CASE_CATALOG.filter((i: { folder: string | null }) => i.folder).map((i: { id: string }) => i.id));

  mkdirSync('/tmp/case53-init/cases', { recursive: true });
  const manifest: Array<{ idx: string; caseId: string; version: string; factsBytes: number; documentsBytes: number }> = [];
  const problems: Array<{ caseId: string; issue: string }> = [];
  const caseIds: string[] = [];

  for (const file of files) {
    const caseId = file.replace(/\.json$/, '');
    if (!catalogIds.has(caseId)) { problems.push({ caseId, issue: 'not_in_catalog' }); continue; }
    let record: unknown;
    try {
      record = recordSchema.parse(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
    } catch (error) {
      problems.push({ caseId, issue: `invalid_schema: ${(error as Error).message.slice(0, 120)}` });
      continue;
    }
    if ((record as { caseId: string }).caseId !== caseId) { problems.push({ caseId, issue: 'caseId_mismatch' }); continue; }
    const r = record as import('../src/lib/teacher-case-data').TeacherCaseData;
    const version = computeImportVersion(r);
    const factsJson = JSON.stringify(buildFactsPayloadForInit(r));
    const documentsJson = JSON.stringify(r.documents);
    // 字面量包装：超长字符串按 2000 字符切段用 || 拼接（内容逐字不变，仅换物理行），保证 read_file 可分页读取
    const qWrapped = (s: string, cast?: string): string => {
      const parts: string[] = [];
      for (let i = 0; i < s.length; i += 2000) parts.push(`'${s.slice(i, i + 2000).replace(/'/g, "''")}'`);
      const expr = parts.length === 1 ? parts[0] : `(${parts.join(' ||\n')})`;
      return cast ? `(${expr})::${cast}` : expr;
    };
    const sql = [
      'begin;',
      `insert into case_snapshot_facts (case_id, version, source_name, facts) values ('${caseId.replace(/'/g, "''")}', '${version}', ${qWrapped(r.sourceName)}, ${qWrapped(factsJson, 'jsonb')}) on conflict (case_id, version) do nothing;`,
      `insert into case_snapshot_answers (case_id, version, diagnosis, plan, documents, media) values ('${caseId.replace(/'/g, "''")}', '${version}', ${qWrapped(r.sections.diagnosis)}, ${qWrapped(r.sections.plan)}, ${qWrapped(documentsJson, 'jsonb')}, '[]'::jsonb) on conflict (case_id, version) do nothing;`,
      'commit;',
    ].join('\n') + '\n';
    caseIds.push(caseId);
    manifest.push({ idx: '', caseId, version, factsBytes: Buffer.byteLength(factsJson), documentsBytes: Buffer.byteLength(documentsJson) });
    // 先按 caseId 暂存，最后统一编号写文件（编号 = 写入顺序，与 manifest.idx 一致）
    (manifest[manifest.length - 1] as { _sql?: string })._sql = sql;
  }

  if (problems.length > 0) {
    console.log('[gen] VALIDATION_PROBLEMS');
    for (const p of problems) console.log(`  ${p.caseId}: ${p.issue}`);
    process.exit(1);
  }

  // 按大小降序编号（大的编号靠前，便于分派时优先单独处理）
  const order = manifest.map((m, i) => ({ i, size: m.factsBytes + m.documentsBytes })).sort((a, b) => b.size - a.size);
  order.forEach((o, rank) => {
    const m = manifest[o.i] as typeof manifest[number] & { _sql?: string };
    const idx = String(rank + 1).padStart(2, '0');
    m.idx = idx;
    writeFileSync(`/tmp/case53-init/cases/${idx}-${m.caseId}.sql`, m._sql as string);
    delete m._sql;
  });
  writeFileSync('/tmp/case53-init/manifest.json', JSON.stringify({ total: manifest.length, cases: manifest }, null, 2));
  const sizes = manifest.map((m) => m.factsBytes + m.documentsBytes);
  console.log(`[gen] OK total=${manifest.length} cases dir=/tmp/case53-init/cases`);
  console.log(`[gen] size: min=${Math.min(...sizes)} max=${Math.max(...sizes)} total=${sizes.reduce((a, b) => a + b, 0)}`);
  console.log(`[gen] smallest: ${manifest.find((m) => m.factsBytes + m.documentsBytes === Math.min(...sizes))?.caseId}`);
}

void main();
