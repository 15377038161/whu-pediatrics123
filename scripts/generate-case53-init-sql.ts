/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 53 份受控审核病例 → 逐例幂等初始化 SQL 生成器（不直接写库）。
 *
 * 职责：
 * 1. 逐例读取 knowledge/teaching-cases/*.json，recordSchema 校验 + 文件名/caseId 一致性 + catalog 在册校验；
 * 2. 版本指纹与教师导入通道使用同一完整内容算法，媒体/释放绑定参与版本；
 * 3. 生成"逐例"幂等 SQL（单例事务：INSERT ... ON CONFLICT (case_id,version) DO NOTHING）到 /tmp（不进 Git），
 *    经平台管理工具（db_execute）执行——不伪造教师 JWT、不走匿名写接口、不导出 service-role；
 * 4. 完整事实写入 facts+answers 逐例配对；DO NOTHING 不覆盖 DB 既有记录与历史版本；
 *    绝不以召回片段替代完整 53 例。
 * 5. 不触碰 case_publication 表（教师下架决定不受初始化影响）。
 *
 * 输出：
 * - 参数指定的私有新目录（默认 output/case53-init-时间戳），不覆盖既有包；SQL含私有原文，禁止粘贴到聊天/日志。
 * - cases/NN-<caseId>-<version>.sql：租户/迁移守卫、逐例事务及同版本内容复核。
 * - manifest.json：序号/caseId/版本/字节数/SQL指纹，无患者正文。
 */
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import type { TeacherCaseData } from '../src/lib/teacher-case-data';

/** Shared payload builders keep the operator path identical to the teacher/RLS import path. */
export async function buildCaseInitialization(record: TeacherCaseData) {
  const { computeImportVersion, buildFactsPayloadForInit, buildBindingConfigForInit } = await import('../src/lib/teacher-case-import');
  const version = computeImportVersion(record);
  const facts = JSON.stringify(buildFactsPayloadForInit(record));
  const documents = JSON.stringify(record.documents);
  const bindings = JSON.stringify(buildBindingConfigForInit(record));
  const raw = JSON.stringify(record);
  const verifyTag = `$case_init_verify_${createHash('sha256').update(raw).digest('hex').slice(0,16)}$`;
  if (raw.includes(verifyTag)) throw new Error('CASE_INIT_UNSAFE_DELIMITER');
  const q = (value: string, cast?: string): string => {
    const chars = Array.from(value), parts: string[] = [];
    for (let i = 0; i < chars.length; i += 2000) parts.push(`'${chars.slice(i, i + 2000).join('').replace(/'/g, "''")}'`);
    const expression = parts.length > 1 ? `(${parts.join(' ||\n')})` : parts[0] ?? "''";
    return cast ? `(${expression})::${cast}` : expression;
  };
  const caseId = q(record.caseId), caseVersion = q(version);
  const sql = `BEGIN;
DO $case_init_guard$
BEGIN
  IF current_schema() IS DISTINCT FROM 'tenant_034d7076-1314-b75d-22cb-f4fa3740fd07_schema' THEN
    RAISE EXCEPTION 'CASE_INIT_TARGET_TENANT_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='case_snapshot_answers' AND column_name='binding_config') THEN
    RAISE EXCEPTION 'CASE_INIT_PRIVATE_BINDING_MIGRATION_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname IN ('case_snapshot_facts','case_snapshot_answers') AND c.relrowsecurity) <> 2 THEN
    RAISE EXCEPTION 'CASE_INIT_RLS_REQUIRED';
  END IF;
END;
$case_init_guard$;
INSERT INTO case_snapshot_facts (case_id,version,source_name,facts)
VALUES (${caseId},${caseVersion},${q(record.sourceName)},${q(facts,'jsonb')}) ON CONFLICT (case_id,version) DO NOTHING;
INSERT INTO case_snapshot_answers (case_id,version,diagnosis,plan,documents,media,binding_config)
VALUES (${caseId},${caseVersion},${q(record.sections.diagnosis)},${q(record.sections.plan)},${q(documents,'jsonb')},'[]'::jsonb,${q(bindings,'jsonb')}) ON CONFLICT (case_id,version) DO NOTHING;
DO ${verifyTag}
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM case_snapshot_facts f JOIN case_snapshot_answers a USING(case_id,version)
    WHERE f.case_id=${caseId} AND f.version=${caseVersion}
      AND f.source_name IS NOT DISTINCT FROM ${q(record.sourceName)} AND f.facts IS NOT DISTINCT FROM ${q(facts,'jsonb')}
      AND a.diagnosis IS NOT DISTINCT FROM ${q(record.sections.diagnosis)} AND a.plan IS NOT DISTINCT FROM ${q(record.sections.plan)}
      AND a.documents IS NOT DISTINCT FROM ${q(documents,'jsonb')} AND a.media IS NOT DISTINCT FROM '[]'::jsonb
      AND a.binding_config IS NOT DISTINCT FROM ${q(bindings,'jsonb')}
  ) THEN RAISE EXCEPTION 'CASE_INIT_EXISTING_CONTENT_MISMATCH'; END IF;
END;
${verifyTag};
COMMIT;
`;
  return { version, sql, factsBytes: Buffer.byteLength(facts), documentsBytes: Buffer.byteLength(documents), bindingBytes: Buffer.byteLength(bindings), sqlSha256: createHash('sha256').update(sql).digest('hex') };
}

async function main() {
  const { recordSchema, getKnowledgeRoot } = await import('../src/lib/teacher-case-data');
  const { TEACHER_CASE_CATALOG } = await import('../src/domain/teacher-case-catalog');
  const { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } = await import('node:fs');
  const output = path.resolve(process.argv[2] ?? path.join('output', `case53-init-${Date.now()}`));
  if (![path.resolve('output'),path.resolve(os.tmpdir())].some(root=>output.startsWith(root+path.sep))) throw new Error('CASE_INIT_PRIVATE_OUTPUT_REQUIRED');
  if (existsSync(output)) throw new Error('CASE_INIT_OUTPUT_EXISTS');

  const dir = path.join(getKnowledgeRoot(), 'teaching-cases');
  const files = readdirSync(dir).filter((n: string) => n.endsWith('.json')).sort();
  const catalogIds = new Set(TEACHER_CASE_CATALOG.filter((i: { folder: string | null }) => i.folder).map((i: { id: string }) => i.id));

  const manifest: Array<{ idx: string; caseId: string; version: string; factsBytes: number; documentsBytes: number; bindingBytes: number; sqlSha256: string; _sql?: string }> = [];
  const problems: Array<{ caseId: string; issue: string }> = [];

  for (const file of files) {
    const caseId = file.replace(/\.json$/, '');
    if (!catalogIds.has(caseId)) { problems.push({ caseId, issue: 'not_in_catalog' }); continue; }
    let record: unknown;
    try {
      record = recordSchema.parse(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
    } catch {
      problems.push({ caseId, issue: 'invalid_schema' });
      continue;
    }
    if ((record as { caseId: string }).caseId !== caseId) { problems.push({ caseId, issue: 'caseId_mismatch' }); continue; }
    const r = record as import('../src/lib/teacher-case-data').TeacherCaseData;
    const { sql, ...metadata } = await buildCaseInitialization(r);
    manifest.push({ idx: '', caseId, ...metadata, _sql: sql });
  }
  if (!manifest.length) throw new Error('CASE_INIT_NO_CASES');

  if (problems.length > 0) {
    console.log('[gen] VALIDATION_PROBLEMS');
    for (const p of problems) console.log(`  ${p.caseId}: ${p.issue}`);
    process.exit(1);
  }
  mkdirSync(path.join(output,'cases'), { recursive: true });

  // 按大小降序编号（大的编号靠前，便于分派时优先单独处理）
  const order = manifest.map((m, i) => ({ i, size: m.factsBytes + m.documentsBytes })).sort((a, b) => b.size - a.size);
  order.forEach((o, rank) => {
    const m = manifest[o.i] as typeof manifest[number] & { _sql?: string };
    const idx = String(rank + 1).padStart(2, '0');
    m.idx = idx;
    writeFileSync(path.join(output,'cases',`${idx}-${m.caseId}-${m.version}.sql`), m._sql as string, {mode:0o600,flag:'wx'});
    delete m._sql;
  });
  writeFileSync(path.join(output,'manifest.json'), JSON.stringify({ total: manifest.length, cases: manifest }, null, 2), {mode:0o600,flag:'wx'});
  const sizes = manifest.map((m) => m.factsBytes + m.documentsBytes);
  console.log(`[gen] OK total=${manifest.length} cases dir=${path.join(output,'cases')}`);
  console.log(`[gen] size: min=${Math.min(...sizes)} max=${Math.max(...sizes)} total=${sizes.reduce((a, b) => a + b, 0)}`);
  console.log(`[gen] smallest: ${manifest.find((m) => m.factsBytes + m.documentsBytes === Math.min(...sizes))?.caseId}`);
}

if (process.argv[1] && /generate-case53-init-sql\.(?:ts|[cm]?js)$/.test(process.argv[1])) {
  void main().catch((error:unknown)=>{console.error(error instanceof Error && /^CASE_INIT_[A-Z_]+$/.test(error.message)?error.message:'CASE_INIT_FAILED');process.exitCode=1;});
}
