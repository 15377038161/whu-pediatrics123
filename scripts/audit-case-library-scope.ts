// 首页病例库全流程审核 · 第一阶段范围对账（任务书 v1.1 第 3 节）
// 只读交叉核对：TEACHER_CASE_CATALOG（教师目录）/ TEACHER_CASE_LINKS（别名亚型映射）/
// CASE_PUBLIC_IDS（稳定公开 UUID）/ TEACHER_PUBLIC_ENTRIES（首页教师条目）/ admission-summaries.json
// （首页展示摘要）/ docs/case-readiness-register.json（就绪账本，degraded 复用上次生成结果）/
// docs/case-snapshot-versions.json（真实库只读快照 2026-10-21）。
// 输出：outputs/case-library-review/20261021/scope.json（私有，含教师可见名称）+ 控制台脱敏汇总。
// 本脚本不连接数据库、不修改任何文件（除输出目录）、不判断内容质量：语义核验覆盖率另行登记。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';
import { CASE_PUBLIC_IDS } from '@/lib/case-identity';
import { TEACHER_PUBLIC_ENTRIES } from '@/domain/case-catalog';
import admissionSummaries from '@/domain/admission-summaries.json';

interface RegisterRow {
  publicCaseId: string;
  sourceCaseId: string | null;
  relation: 'independent' | 'alias' | 'subtype' | 'no_source';
  catalogStatus: string;
  sourcePath: string | null;
  published: boolean;
  publishedVersion: string | null;
  historicalVersions: string[];
  ageKnown: string | null;
  sexKnown: string;
  readiness: Record<string, string>;
  e2eResult: string | null;
  ledgerMarker: string;
}

interface ScopeRow {
  publicCaseId: string;
  sourceCaseId: string | null;
  name: string; // 教师目录名（教师可见，不进学生客户端）
  category: string;
  sourcePath: string | null;
  onStudentHome: boolean; // 首页展示（TEACHER_PUBLIC_ENTRIES 在册）
  homeTitleKind: 'admission-summary' | 'neutral-catalog'; // 首页标题形态
  relation: 'independent' | 'alias' | 'subtype' | 'no_source';
  runtimeVersion: string | null; // 运行版本（账本口径 = 快照 + NRDS 人工 override）
  published: boolean;
  mediaCount: number;
  documentCount: number;
  catalogStatus: string; // 教师目录 status（当前代码）
  publicContentStatus: string; // 首页 contentStatus（当前代码）
  registerCatalogStatus: string; // 账本记录 status（degraded 可能漂移）
  readiness: Record<string, string>;
  e2eResult: string | null;
  ledgerMarker: string;
  discrepancies: string[]; // 当前代码目录 vs 首页条目 vs 账本 的不一致
}

function main(): void {
  const root = process.cwd();
  const outDir = path.join(root, 'outputs', 'case-library-review', '20261021');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const register = JSON.parse(readFileSync(path.join(root, 'docs', 'case-readiness-register.json'), 'utf8')) as {
    rows: RegisterRow[];
  };
  const snapshot = JSON.parse(readFileSync(path.join(root, 'docs', 'case-snapshot-versions.json'), 'utf8')) as {
    versions: { caseId: string; version: string }[];
    publication: { caseId: string; published: boolean }[];
  };
  const summaries = admissionSummaries as Record<string, { age: string; sex: string; complaint: string }>;

  // 目录 → 首页 双向映射
  const publicEntryByUuid = new Map(TEACHER_PUBLIC_ENTRIES.map((e) => [e.id, e]));
  const uuidByTeacherId = new Map(Object.entries(CASE_PUBLIC_IDS));
  const teacherIdByUuid = new Map(Object.entries(CASE_PUBLIC_IDS).map(([tid, uuid]) => [uuid, tid]));
  const registerByTeacherId = new Map(register.rows.map((r) => [r.publicCaseId, r])); // 账本 publicCaseId = teacher-id 口径
  const versionsByCase = new Map<string, string[]>();
  for (const v of snapshot.versions) {
    const list = versionsByCase.get(v.caseId) ?? [];
    list.push(v.version);
    versionsByCase.set(v.caseId, list);
  }
  const publicationByCase = new Map(snapshot.publication.map((p) => [p.caseId, p.published]));

  const rows: ScopeRow[] = [];
  const globalDiscrepancies: string[] = [];

  // 1) 数量对账
  const counts = {
    teacherCatalog: TEACHER_CASE_CATALOG.length,
    publicEntries: TEACHER_PUBLIC_ENTRIES.length,
    identityMap: Object.keys(CASE_PUBLIC_IDS).length,
    registerRows: register.rows.length,
  };
  if (new Set(Object.values(counts)).size !== 1) {
    globalDiscrepancies.push(`四源数量不一致：${JSON.stringify(counts)}`);
  }

  for (const item of TEACHER_CASE_CATALOG) {
    const link = TEACHER_CASE_LINKS[item.id];
    const relation: ScopeRow['relation'] = link ? link.relation : item.folder ? 'independent' : 'no_source';
    const sourceCaseId = link ? link.sourceId : relation === 'independent' ? item.id : null;
    const uuid = uuidByTeacherId.get(item.id) ?? null;
    const publicEntry = uuid ? publicEntryByUuid.get(uuid) ?? null : null;
    const reg = registerByTeacherId.get(item.id) ?? null;

    const discrepancies: string[] = [];
    if (!uuid) discrepancies.push('identity-map-missing：目录条目无稳定公开 UUID（学生端不可达）');
    if (uuid && !publicEntry) discrepancies.push('home-entry-missing：有 UUID 但不在首页 TEACHER_PUBLIC_ENTRIES');
    if (publicEntry && publicEntry.sourceRelation !== (link ? link.relation : null)) {
      discrepancies.push(`relation-drift：首页=${publicEntry.sourceRelation} 目录推导=${relation}`);
    }
    if (publicEntry && publicEntry.category !== item.category) {
      discrepancies.push(`category-drift：首页=${publicEntry.category} 目录=${item.category}`);
    }
    if (publicEntry && (publicEntry.mediaCount !== item.mediaCount || publicEntry.documentCount !== item.documentCount)) {
      discrepancies.push(
        `material-count-drift：首页媒体/文档=${publicEntry.mediaCount}/${publicEntry.documentCount} 目录=${item.mediaCount}/${item.documentCount}`,
      );
    }
    // contentStatus 映射：目录 status → 首页 contentStatus 前缀
    if (publicEntry) {
      const expectedPrefix = item.status === 'materials-indexed' ? 'teacher-materials-indexed' : `teacher-${item.status}`;
      if (publicEntry.contentStatus !== expectedPrefix) {
        discrepancies.push(`content-status-drift：首页=${publicEntry.contentStatus} 目录=${item.status}`);
      }
    }
    if (!reg) {
      discrepancies.push('register-row-missing：账本无此目录条目行');
    } else {
      if (reg.sourceCaseId !== sourceCaseId) {
        discrepancies.push(`source-drift：账本 source=${reg.sourceCaseId} 代码推导=${sourceCaseId}`);
      }
      if (reg.relation !== relation) discrepancies.push(`relation-drift-register：账本=${reg.relation} 代码=${relation}`);
      if (reg.catalogStatus !== item.status) {
        discrepancies.push(`catalog-status-drift：账本=${reg.catalogStatus} 目录=${item.status}（degraded 账本为上次生成结果，此处为漂移证据）`);
      }
      if (reg.sourcePath !== item.folder) {
        discrepancies.push(`source-path-drift：账本=${reg.sourcePath} 目录=${item.folder}`);
      }
    }

    // 发布状态：以快照为准重算（无行=发布）
    const published = publicationByCase.has(item.id) ? Boolean(publicationByCase.get(item.id)) : true;
    if (reg && reg.published !== published) {
      discrepancies.push(`published-drift：账本=${reg.published} 快照=${published}`);
    }
    // 运行版本：快照可含多版本（NRDS 等双版本）；账本当前版本应为快照版本之一（NRDS 多版本以人工 override 为当前，见 audit-case-readiness.ts）
    const snapshotVersions = versionsByCase.get(sourceCaseId ?? item.id) ?? [];
    const runtimeVersion = reg?.publishedVersion ?? snapshotVersions[0] ?? null;
    if (reg && reg.publishedVersion && !snapshotVersions.includes(reg.publishedVersion)) {
      discrepancies.push(`version-drift：账本当前=${reg.publishedVersion} 不在快照版本集=[${snapshotVersions.join(', ')}]（快照滞后或版本漂移，需逐例核对）`);
    }

    const hasSummary = uuid ? summaries[uuid] !== undefined : false;
    rows.push({
      publicCaseId: uuid ?? `MISSING-UUID:${item.id}`,
      sourceCaseId,
      name: item.name,
      category: item.category,
      sourcePath: item.folder,
      onStudentHome: publicEntry !== null,
      homeTitleKind: hasSummary ? 'admission-summary' : 'neutral-catalog',
      relation,
      runtimeVersion,
      published,
      mediaCount: item.mediaCount,
      documentCount: item.documentCount,
      catalogStatus: item.status,
      publicContentStatus: publicEntry?.contentStatus ?? 'not-on-home',
      registerCatalogStatus: reg?.catalogStatus ?? 'register-row-missing',
      readiness: reg?.readiness ?? {},
      e2eResult: reg?.e2eResult ?? null,
      ledgerMarker: reg?.ledgerMarker ?? '',
      discrepancies,
    });
  }

  // 反向：首页条目/UUID 里目录没有的
  for (const [uuid, entry] of publicEntryByUuid) {
    const tid = teacherIdByUuid.get(uuid);
    if (!tid) {
      globalDiscrepancies.push(`home-entry-no-identity：首页条目 ${uuid} 无 identity 反查（teacher-id 未知）`);
    } else if (!TEACHER_CASE_CATALOG.some((c) => c.id === tid)) {
      globalDiscrepancies.push(`home-entry-no-catalog：首页条目 ${uuid}（${tid}）不在教师目录`);
    }
    void entry;
  }
  // identity 映射里目录没有的
  for (const tid of uuidByTeacherId.keys()) {
    if (!TEACHER_CASE_CATALOG.some((c) => c.id === tid)) {
      globalDiscrepancies.push(`identity-no-catalog：identity 注册 ${tid} 不在教师目录`);
    }
  }
  // 账本里目录没有的
  for (const r of register.rows) {
    if (!TEACHER_CASE_CATALOG.some((c) => c.id === r.publicCaseId)) {
      globalDiscrepancies.push(`register-no-catalog：账本行 ${r.publicCaseId} 不在教师目录（历史残留）`);
    }
  }

  // 汇总（脱敏：仅公开 UUID 与计数，不输出病种名）
  const by = <T extends string>(vals: T[]): Record<string, number> => {
    const acc: Record<string, number> = {};
    for (const v of vals) acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  };
  const summary = {
    generatedAt: new Date().toISOString(),
    dataSource: '静态代码目录 + 入库账本 + 入库快照（未连接数据库；运行时准入以 eligibleAdmissions 实测为准）',
    counts,
  caseCatalogTotal: TEACHER_PUBLIC_ENTRIES.length + 2, // + 2 个合成前缀条目（flagship-fixture 1 + demo-pending-review 1，见 case-catalog.ts）
    relation: by(rows.map((r) => r.relation)),
    catalogStatus: by(rows.map((r) => r.catalogStatus)),
    publicContentStatus: by(rows.map((r) => r.publicContentStatus)),
    registerCatalogStatus: by(rows.map((r) => r.registerCatalogStatus)),
    onStudentHome: by(rows.map((r) => String(r.onStudentHome))),
    homeTitleKind: by(rows.map((r) => r.homeTitleKind)),
    published: by(rows.map((r) => String(r.published))),
    readinessHistory: by(rows.map((r) => r.readiness.history ?? 'unknown')),
    e2eResult: by(rows.map((r) => r.e2eResult ?? 'null')),
    mediaCountTotal: rows.reduce((s, r) => s + r.mediaCount, 0),
    documentCountTotal: rows.reduce((s, r) => s + r.documentCount, 0),
    rowsWithDiscrepancies: rows.filter((r) => r.discrepancies.length > 0).length,
    globalDiscrepancies,
    // 语义核验口径（任务书第 11 节）：本盘点只做登记对账，未阅读任何材料内容。
    semanticVerificationCoverage: '0%（材料原件不在沙箱；本阶段仅目录计数对账，未逐份查看/播放）',
  };

  writeFileSync(path.join(outDir, 'scope.json'), `${JSON.stringify({ _meta: summary, rows }, null, 2)}\n`, 'utf8');

  // 控制台脱敏输出（不含教师病种名）
  console.log(JSON.stringify({ summary, rowDiscrepancyPublicIds: rows.filter((r) => r.discrepancies.length > 0).map((r) => ({ publicCaseId: r.publicCaseId, discrepancies: r.discrepancies })) }, null, 2));
}

main();
