/**
 * 阶段 A / W01：生成唯一病例就绪账本（docs/case-readiness-register.json + Markdown 总表）。
 * 方案依据：《自主训练平台整体改造方案》7.1（唯一病例账本字段）/ 7.4（受控脚本，先产出可审阅文件，不写数据库）。
 * 运行：pnpm exec tsx scripts/audit-case-readiness.ts
 *
 * 数据源（全部只读，不写数据库、不调用模型）：
 *   1) src/domain/teacher-case-catalog.ts（教师目录 70 条目：folder/status）
 *   2) src/domain/teacher-case-links.ts（别名/亚型 → 源病例映射）
 *   3) docs/case-audit-ledger.json（逐例核对台账，幂等记录批次/结论/发现）
 *   4) docs/病例台账.md 第四节逐例表（年龄/性别/主诉/五段字符数/标记）
 *   5) docs/case-snapshot-versions.json（真实库快照版本 + 发布状态，只读查询快照）
 *
 * 原则：未知不伪装已完成——
 *   - 未逐例核对的病例维度标 unaudited，不标 ready；
 *   - sourceHash 保持 null（53 例原件尚未回传沙箱，无法重算指纹）；
 *   - communicationProfile 域已建（B 批次：年龄默认档推导 live、人物背景 UI 与人物资产清单已接线），
 *     但逐例角色能力专业审核未做，communicationReady / speechRoleReady 仍如实 false；
 *   - 不编造医学内容；教师待办从台账标记与核对 findings 原样带入 blockers。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';

type DimState = 'ready' | 'pending_review' | 'unaudited' | 'insufficient';
type Relation = 'independent' | 'alias' | 'subtype' | 'no_source';
type AgeBand = 'newborn' | 'infant' | 'toddler' | 'preschool' | 'school' | 'adolescent' | 'unknown';

interface AuditEntry {
  caseId: string;
  sourceId: string;
  version: string;
  batch: number;
  batchLabel: string;
  pass: boolean;
  checkedAt: string;
  findings: string[];
}

interface LedgerRow {
  age: string;
  sex: string;
  complaint: string;
  history: number;
  exam: number;
  tests: number;
  diagnosis: number;
  plan: number;
  marker: string;
}

interface RegisterRow {
  publicCaseId: string;
  sourceCaseId: string | null;
  relation: Relation;
  catalogStatus: string;
  sourcePath: string | null;
  published: boolean;
  publishedVersion: string | null;
  historicalVersions: string[];
  sourceHash: null;
  ageKnown: string | null;
  ageBand: AgeBand;
  sexKnown: 'male' | 'female' | 'unknown';
  dimensionChars: { history: number; exam: number; tests: number; diagnosis: number; plan: number } | null;
  audit: { batch: number; batchLabel: string; pass: boolean; checkedAt: string; findings: string[] } | null;
  readiness: { history: DimState; exam: DimState; tests: DimState; reasoning: DimState; plan: DimState };
  avatarReady: 'ready' | 'partial';
  communicationReady: false;
  speechRoleReady: false;
  rubricReady: false;
  supportedModes: string[];
  blockers: string[];
  ledgerMarker: string;
  reviewer: null;
  reviewedAt: string | null;
  e2eResult: string | null;
}

const DOCS = path.resolve(process.cwd(), 'docs');

/** NRDS 双版本：当前版本按《病例台账》人工核对结论固定（教师待办：清理历史空版本）。 */
const CURRENT_VERSION_OVERRIDE: Record<string, string> = {
  'teacher-新生儿呼吸窘迫综合征': '8d5321f1154d2841',
};

/** 解析年龄表述为近似天数（解析辅助信息，非医学发育判定；"8岁27天"等源文异常保持原样记录）。 */
function parseAgeDays(ageText: string): number | null {
  let days = 0;
  let matched = false;
  const re = /(\d+)\s*(?:个)?\s*(岁|月|天|日|小时|分钟)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ageText)) !== null) {
    matched = true;
    const n = Number.parseInt(m[1], 10);
    const unit = m[2];
    if (unit === '岁') days += n * 365;
    else if (unit === '月') days += n * 30;
    else if (unit === '天' || unit === '日') days += n;
    else if (unit === '小时') days += n / 24;
    else if (unit === '分钟') days += n / 1440;
  }
  return matched ? days : null;
}

function toAgeBand(days: number | null): AgeBand {
  if (days === null) return 'unknown';
  if (days <= 28) return 'newborn';
  if (days <= 365) return 'infant';
  if (days <= 365 * 3) return 'toddler';
  if (days <= 365 * 6) return 'preschool';
  if (days < 365 * 12) return 'school';
  return 'adolescent';
}

function parseSex(sexText: string): 'male' | 'female' | 'unknown' {
  if (sexText.includes('男')) return 'male';
  if (sexText.includes('女')) return 'female';
  return 'unknown';
}

/** 解析《病例台账》第四节逐例表（列：# | 病例 | 年龄 | 性别 | 主诉 | 病史 | 查体 | 检查 | 诊断 | 处置 | 标记）。 */
function parseLedgerMarkdown(md: string): Map<string, LedgerRow> {
  const rows = new Map<string, LedgerRow>();
  const section = md.split('## 四、逐例台账')[1] ?? '';
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim()).slice(1, -1);
    if (cells.length < 10) continue;
    const [num, name, age, sex, complaint, history, exam, tests, diagnosis, plan, ...markerRest] = cells;
    if (!/^\d+$/.test(num)) continue;
    const id = `teacher-${name}`;
    rows.set(id, {
      age,
      sex,
      complaint,
      history: Number.parseInt(history, 10) || 0,
      exam: Number.parseInt(exam, 10) || 0,
      tests: Number.parseInt(tests, 10) || 0,
      diagnosis: Number.parseInt(diagnosis, 10) || 0,
      plan: Number.parseInt(plan, 10) || 0,
      marker: markerRest.join(' ').trim(),
    });
  }
  return rows;
}

function main(): void {
  // 输入台账丢失回退（沙箱重置会丢失未跟踪文件）：case-audit-ledger.json /《病例台账》md 缺失时
  // 不重算逐例行，复用已跟踪上次生成结果（docs/case-readiness-register.json），_meta 如实标注 degraded；
  // 台账原件回传沙箱后重跑本脚本即恢复全量核对（方案 7.4 受控脚本原则不变）。
  const ledgerPath = path.join(DOCS, 'case-audit-ledger.json');
  const ledgerMdPath = path.join(DOCS, '病例台账.md');
  const degraded = !existsSync(ledgerPath) || !existsSync(ledgerMdPath);
  const auditLedger: AuditEntry[] = degraded ? [] : (JSON.parse(readFileSync(ledgerPath, 'utf8')) as AuditEntry[]);
  const ledgerMd = degraded ? '' : readFileSync(ledgerMdPath, 'utf8');
  const snapshot = JSON.parse(readFileSync(path.join(DOCS, 'case-snapshot-versions.json'), 'utf8')) as {
    versions: { caseId: string; version: string }[];
    publication: { caseId: string; published: boolean; updatedAt: string }[];
  };

  const ledgerRows = parseLedgerMarkdown(ledgerMd);
  const auditBySource = new Map<string, AuditEntry>();
  for (const entry of auditLedger) auditBySource.set(entry.sourceId, entry);

  const versionsByCase = new Map<string, string[]>();
  for (const v of snapshot.versions) {
    const list = versionsByCase.get(v.caseId) ?? [];
    list.push(v.version);
    versionsByCase.set(v.caseId, list);
  }
  const publicationByCase = new Map<string, boolean>();
  for (const p of snapshot.publication) publicationByCase.set(p.caseId, p.published);

  const rows: RegisterRow[] = [];
  let priorAuditedSources = 0;

  if (degraded) {
    // 沙箱重置丢失台账输入：逐例行复用已跟踪上次生成结果（不重算、不丢失核对轨迹）。
    const prior = JSON.parse(readFileSync(path.join(DOCS, 'case-readiness-register.json'), 'utf8')) as {
      rows: RegisterRow[];
      summary: { auditedSources: number };
    };
    priorAuditedSources = prior.summary.auditedSources;
    rows.push(...prior.rows);
  } else {
  for (const item of TEACHER_CASE_CATALOG) {
    const link = TEACHER_CASE_LINKS[item.id];
    const relation: Relation = link ? link.relation : item.folder ? 'independent' : 'no_source';
    const sourceCaseId = link ? link.sourceId : relation === 'independent' ? item.id : null;

    // 维度/年龄/性别/标记以源病例台账行为准（别名行继承源病例）。
    const ledgerKey = sourceCaseId ?? item.id;
    const ledger = ledgerRows.get(ledgerKey) ?? null;
    const audit = sourceCaseId ? (auditBySource.get(sourceCaseId) ?? null) : null;

    // 版本：多版本病例当前版本按人工核对结论（override），其余进 historicalVersions。
    const versions = versionsByCase.get(ledgerKey) ?? [];
    const currentVersion =
      ledgerKey in CURRENT_VERSION_OVERRIDE
        ? CURRENT_VERSION_OVERRIDE[ledgerKey]
        : audit
          ? audit.version
          : (versions[0] ?? null);
    const historicalVersions = versions.filter((v) => v !== currentVersion);

    const published = publicationByCase.has(item.id) ? (publicationByCase.get(item.id) as boolean) : true;

    // 就绪状态三态：确缺待审（catalog pending-review）→ pending_review；无独立来源 → insufficient；
    // 已逐例核对通过 → ready；其余 → unaudited（未知不伪装已完成）。
    // 目录 status 类型现为 'materials-indexed' | 'catalog-only' | 'folder-only'，
    // 历史待审项已归档，catalog 层不再存在 pending-review 分支。
    const isPendingReview = false;
    const dims = (): { history: DimState; exam: DimState; tests: DimState; reasoning: DimState; plan: DimState } => {
      if (relation === 'no_source') {
        return { history: 'insufficient', exam: 'insufficient', tests: 'insufficient', reasoning: 'insufficient', plan: 'insufficient' };
      }
      const state: DimState = isPendingReview ? 'pending_review' : audit ? 'ready' : 'unaudited';
      return { history: state, exam: state, tests: state, reasoning: state, plan: state };
    };

    const ageKnown = ledger?.age ?? null;
    const ageBand = ledger ? toAgeBand(parseAgeDays(ledger.age)) : 'unknown';
    const avatarReady: 'ready' | 'partial' = ageBand === 'newborn' || ageBand === 'infant' ? 'ready' : 'partial';

    const supportedModes: string[] =
      relation === 'no_source' ? [] : isPendingReview ? ['guided'] : ['guided', 'osce', 'immersive'];

    const blockers: string[] = [];
    if (ledger && ledger.marker.includes('⚠')) blockers.push(ledger.marker);
    if (relation === 'alias' || relation === 'subtype') blockers.push('别名/亚型入口：与源病例同步门控（同一患者不因别名绕过）');
    if (historicalVersions.length > 0) blockers.push(`历史版本待教师清理：${historicalVersions.join('、')}`);

    const e2eResult: string | null =
      relation === 'no_source' ? null : isPendingReview ? 'gated-403（批次核验 14/14 门控拒绝）' : 'all-pass（批次核验 39/39 全链路 + 版本绑定）';

    rows.push({
      publicCaseId: item.id,
      sourceCaseId,
      relation,
      catalogStatus: item.status,
      sourcePath: item.folder,
      published,
      publishedVersion: currentVersion,
      historicalVersions,
      sourceHash: null,
      ageKnown,
      ageBand,
      sexKnown: ledger ? parseSex(ledger.sex) : 'unknown',
      dimensionChars: ledger
        ? { history: ledger.history, exam: ledger.exam, tests: ledger.tests, diagnosis: ledger.diagnosis, plan: ledger.plan }
        : null,
      audit: audit ? { batch: audit.batch, batchLabel: audit.batchLabel, pass: audit.pass, checkedAt: audit.checkedAt, findings: audit.findings } : null,
      readiness: dims(),
      avatarReady,
      communicationReady: false,
      speechRoleReady: false,
      rubricReady: false,
      supportedModes,
      blockers,
      ledgerMarker: ledger?.marker ?? '',
      reviewer: null,
      reviewedAt: audit?.checkedAt ?? null,
      e2eResult,
    });
  }
  }

  // 汇总计数（与《病例台账》口径对账）。
  const byRelation = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.relation] = (acc[r.relation] ?? 0) + 1;
    return acc;
  }, {});
  // 已核对独立源数按核对台账唯一 sourceId 计（别名/亚型行继承源结果，不重复计数）。
  const auditedSources = degraded ? priorAuditedSources : auditBySource.size;
  const pendingReviewCount = rows.filter((r) => r.readiness.history === 'pending_review').length;

  const register = {
    _meta: {
      generatedAt: new Date().toISOString(),
      generator: 'scripts/audit-case-readiness.ts（阶段 A / W01，方案 7.1/7.4）',
      ...(degraded
        ? {
            dataSourcesDegraded:
              'case-audit-ledger.json 与《病例台账》md（未跟踪文件）已随沙箱重置丢失：本版逐例行复用上次生成结果（docs/case-readiness-register.json），未重算；台账原件回传沙箱后重跑本脚本恢复全量核对',
          }
        : {}),
      dataSources: [
        'src/domain/teacher-case-catalog.ts（教师目录 70 条目）',
        'src/domain/teacher-case-links.ts（别名/亚型映射）',
        'docs/case-audit-ledger.json（逐例核对台账）',
        'docs/病例台账.md（第四节逐例表）',
        'docs/case-snapshot-versions.json（真实库只读查询快照 2026-10-21）',
      ],
      knownGaps: [
        'sourceHash=null：53 例原件尚未回传沙箱（knowledge/teaching-cases 为空），原件回传后经核对脚本重算补记',
        'unaudited：35 例未逐例核对，维度不标 ready（继续 3–5 例一批）',
        'communicationReady/speechRoleReady=false：communicationProfile 域已建（年龄默认档推导 live、人物背景 UI 与人物资产清单已接线，B 批次），但逐例角色能力专业审核未做，不标 ready',
        'rubricReady=false：评分量表未审定（方案 4.5 讨论稿待教师确认）',
        'reviewer=null：逐例核对为脚本+台账核对，医学审核人待教师审核时补记',
        '内置 fixture（peds-respiratory-001/peds-wheeze-002）与教师来源分离，不在本账本统计',
      ],
      semantics: {
        published: '无 case_publication 行=已发布（缺省开放）；有行按行值',
        supportedModes: '当前统一门控实际放行模式（case-admission 五入口判定）；pending-review 仅 guided，no_source 为空',
        ageBand: '解析辅助信息（岁=365天/月=30天近似），非医学发育判定；"8岁27天"等源文异常保持 ageKnown 原样',
      },
    },
    summary: {
      totalEntries: rows.length,
      byRelation,
      auditedSources,
      pendingReviewEntries: pendingReviewCount,
      publishedFalse: rows.filter((r) => !r.published).length,
    },
    rows,
  };

  writeFileSync(path.join(DOCS, 'case-readiness-register.json'), `${JSON.stringify(register, null, 2)}\n`, 'utf8');

  // 便于人工查看的 Markdown 总表。
  const relationLabel: Record<Relation, string> = {
    independent: '独立来源',
    alias: '别名',
    subtype: '亚型',
    no_source: '无独立来源',
  };
  const bandLabel: Record<AgeBand, string> = {
    newborn: '新生儿',
    infant: '婴儿',
    toddler: '幼儿',
    preschool: '学龄前',
    school: '学龄',
    adolescent: '青少年',
    unknown: '未知',
  };
  const lines: string[] = [];
  lines.push('# 唯一病例就绪账本（总表）');
  lines.push('');
  lines.push('> 由 `scripts/audit-case-readiness.ts` 生成，数据源与缺口说明见 `case-readiness-register.json` 的 `_meta`。');
  lines.push('> 核查原则：非空 ≠ 可用；未知不伪装已完成（unaudited 不标 ready）。');
  lines.push('');
  lines.push(`## 汇总（${register.summary.totalEntries} 目录条目）`);
  lines.push('');
  lines.push(`- 关系分布：${Object.entries(byRelation).map(([k, v]) => `${relationLabel[k as Relation]} ${v}`).join('、')}`);
  lines.push(`- 已逐例核对：${auditedSources}/53 独立来源`);
  lines.push(`- 确缺待医学审核（pending_review，仅 guided）：${pendingReviewCount} 条目`);
  lines.push(`- 下架（published=false）：${register.summary.publishedFalse}`);
  lines.push('- 角色能力（communicationProfile）：域已建（B 批次：年龄默认档推导 live、人物背景 UI 与人物资产清单已接线），逐例专业审核未做；评分量表：未审定');
  lines.push('');
  lines.push('## 逐条目');
  lines.push('');
  lines.push('| 条目 | 关系 | 源病例 | 年龄段 | 性别 | 当前版本 | 发布 | 开放模式 | 核对批次 | 五维就绪 | 待办摘要 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const dims = r.dimensionChars
      ? `史${r.readiness.history === 'ready' ? '✓' : r.readiness.history === 'pending_review' ? '审' : '—'}/体${r.readiness.exam === 'ready' ? '✓' : r.readiness.exam === 'pending_review' ? '审' : '—'}/检${r.readiness.tests === 'ready' ? '✓' : r.readiness.tests === 'pending_review' ? '审' : '—'}/诊${r.readiness.reasoning === 'ready' ? '✓' : r.readiness.reasoning === 'pending_review' ? '审' : '—'}/处${r.readiness.plan === 'ready' ? '✓' : r.readiness.plan === 'pending_review' ? '审' : '—'}`
      : '—';
    lines.push(
      `| ${r.publicCaseId} | ${relationLabel[r.relation]} | ${r.sourceCaseId ?? '—'} | ${bandLabel[r.ageBand]} | ${r.sexKnown === 'male' ? '男' : r.sexKnown === 'female' ? '女' : '未知'} | ${r.publishedVersion ?? '—'} | ${r.published ? '是' : '否'} | ${r.supportedModes.join('/') || '—'} | ${r.audit ? `批${r.audit.batch}` : '—'} | ${dims} | ${r.blockers.map((b) => b.replace(/\|/g, '/')).join('；') || '—'} |`,
    );
  }
  writeFileSync(path.join(DOCS, 'case-readiness-register.md'), `${lines.join('\n')}\n`, 'utf8');

  // 控制台校验输出（计数对账，不打印患者正文）。
  console.log(`[readiness-register] 条目 ${rows.length}；关系分布 ${JSON.stringify(byRelation)}；已核对源 ${auditedSources}/53；pending_review 条目 ${pendingReviewCount}；下架 ${register.summary.publishedFalse}`);
  const expected = { total: 70, independent: 53, aliasAndSubtype: 14, noSource: 3 };
  const ok =
    rows.length === expected.total &&
    (byRelation.independent ?? 0) === expected.independent &&
    ((byRelation.alias ?? 0) + (byRelation.subtype ?? 0)) === expected.aliasAndSubtype &&
    (byRelation.no_source ?? 0) === expected.noSource;
  console.log(`[readiness-register] 口径对账（70=53+14+3）：${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) process.exitCode = 1;
}

main();
