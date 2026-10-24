/**
 * 云端事实固化（第二次沙箱恢复后）：对 53 个有独立来源的教师病例，
 * 经 ensureCaseSnapshot（运行时同路径：可信来源标题精确匹配、失败关闭）做 KB 召回，
 * 把云端一侧事实全文 + 版本指纹 + 媒体清单落盘。
 *
 * 目的：pack-20261023 丢失待重传期间，先固定云端现状；pack 到位后逐例比对
 * （缺失作私有候选接入；已存在保留云端新增字段增量合并，不覆盖 testRelease/media/版本）。
 *
 * 只读：无 accessToken 调用，ensureCaseSnapshot 跳过 DB 持久化；不写云端。
 * 输出（outputs/，Git 忽略；内容为私有临床教学事实，禁止入 git/public）：
 *  - case-library-review/20261024/cloud-snapshot/<caseId>.json（全文快照）
 *  - case-library-review/20261024/cloud-snapshot-ledger.md（版本台账）
 *
 * 用法：pnpm exec tsx outputs/local-handoff-20261023/audit/cloud-snapshot.mts [caseId]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureCaseSnapshot, isKnowledgeConfigured } from '@/lib/case-snapshot';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'outputs/case-library-review/20261024/cloud-snapshot');
mkdirSync(OUT_DIR, { recursive: true });

if (!isKnowledgeConfigured()) {
  console.error('CODER_CODING_API_KEY/CODER_CODING_BASE_URL 未配置，无法召回');
  process.exit(1);
}

const withFolder = TEACHER_CASE_CATALOG.filter((c) => c.folder);
const onlyCase = process.argv[2];
const targets = onlyCase ? withFolder.filter((c) => c.id === onlyCase) : withFolder;
console.log(`targets: ${targets.length}`);

const rows: string[] = [];
let ok = 0; let failed = 0;
for (const item of targets) {
  try {
    const snap = await ensureCaseSnapshot(item.id);
    if (!snap) {
      failed += 1;
      rows.push(`| ${item.id} | 召回为空 | — | — | — | — | — |`);
      console.log(`[cloud-snapshot] ${item.id}: 召回为空`);
      continue;
    }
    ok += 1;
    const payload = {
      caseId: item.id,
      capturedAt: new Date().toISOString(),
      captureMode: 'kb_recall_via_ensureCaseSnapshot_readonly',
      meta: snap.meta,
      media: snap.media,
      data: snap.data,
    };
    writeFileSync(path.join(OUT_DIR, `${item.id}.json`), JSON.stringify(payload, null, 2));
    const d = snap.data;
    rows.push(`| ${item.id} | v=\`${snap.meta.version.slice(0, 12)}\` | 片=${snap.meta.chunkCount} | 媒=${snap.meta.mediaCount} | ${d.age}/${d.sex} | 史${d.sections.history.length} 体${d.sections.exam.length} 检${d.sections.tests.length} 诊${d.sections.diagnosis.length} 治${d.sections.plan.length} |`);
    console.log(`[cloud-snapshot] ${item.id}: ok v=${snap.meta.version.slice(0, 12)} chunks=${snap.meta.chunkCount} media=${snap.meta.mediaCount}`);
  } catch (error) {
    failed += 1;
    rows.push(`| ${item.id} | 异常 | ${(error as Error).message.slice(0, 60)} | — | — | — |`);
    console.warn(`[cloud-snapshot] ${item.id}: ERROR ${(error as Error).message}`);
  }
}

const ledger = `# 云端事实固化台账（KB 召回快照，2026-10-24）

- 路径：ensureCaseSnapshot（运行时同路径，可信来源标题精确匹配、失败关闭）；只读，不写云端/DB
- 范围：catalog 中 53 个有独立来源（folder）教师病例
- 汇总：成功 ${ok} / 失败 ${failed}
- 用途：pack-20261023 重传后逐例与候选比对（缺失作私有候选接入；已存在保留云端新增字段增量合并，不覆盖 testRelease/testMedia/examMedia/版本）

| 病例 | 版本指纹 | 分片 | 媒体 | 年龄/性别 | 各段长度（史/体/检/诊/治） |
|------|----------|------|------|-----------|----------------------------|
${rows.join('\n')}
`;
writeFileSync(path.join(ROOT, 'outputs/case-library-review/20261024/cloud-snapshot-ledger.md'), ledger);
console.log(`done: ok=${ok} failed=${failed}`);
