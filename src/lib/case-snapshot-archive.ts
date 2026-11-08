import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {zipSync,strToU8} from 'fflate';
import { CASE_INDEX_NUMBER, TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '@/domain/teacher-case-links';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { publicCaseId } from '@/lib/case-identity';
import { getKnowledgeRoot, recordSchema, type TeacherCaseData } from '@/lib/teacher-case-data';

/**
 * Controlled recovery of the fixed source package from teacher-visible snapshots.
 *
 * Security boundaries:
 * - The caller supplies no case text, paths, versions or hashes. Rows come from the
 *   authenticated teacher's RLS-visible snapshot tables.
 * - A reconstructed record is written only when its recomputed content fingerprint
 *   equals the version stored in BOTH facts and answers rows.
 * - Current files are never replaced by a different verified version. Conflicting
 *   local content aborts the package rebuild instead of overwriting it.
 * - No patient text is returned; responses contain IDs, versions and counters only.
 */

export interface SnapshotFactsRow {
  case_id: string;
  version: string;
  facts: unknown;
  created_at?: string | null;
}

export interface SnapshotAnswersRow {
  case_id: string;
  version: string;
  diagnosis: unknown;
  plan: unknown;
  documents: unknown;
  binding_config: unknown;
  created_at?: string | null;
}

export interface ReconstructedCaseSnapshot {
  record: TeacherCaseData;
  version: string;
  createdAt: string;
}

/** Current versions whose new-session binding was already verified before this recovery. */
export const VERIFIED_CURRENT_VERSIONS: Readonly<Record<string, string>> = {
  'teacher-异物吸入性窒息': '7838e2aa1c4c53af',
  'teacher-中枢性尿崩症': '8399007092abff43',
  'teacher-噬血细胞综合征': '0fcd716cf9d311cb',
  'teacher-特发性血小板减少性紫癜': 'b8c5c9b92a3f6f21',
  'teacher-蚕豆病': '7b11b44563484343',
};

function invalidSnapshot(): Error {
  return new Error('CASE_SNAPSHOT_RECORD_INVALID');
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidSnapshot();
  return value as Record<string, unknown>;
}

function requiredText(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw invalidSnapshot();
  return value;
}

function optionalBinding(source: Record<string, unknown>, key: string): unknown {
  const value = source[key];
  return value === undefined || value === null ? undefined : value;
}

/** Rebuild the exact record shape that was fingerprinted when the snapshot was written. */
export function reconstructCaseSnapshot(
  factsRow: SnapshotFactsRow,
  answersRow: SnapshotAnswersRow,
): ReconstructedCaseSnapshot {
  if (factsRow.case_id !== answersRow.case_id || factsRow.version !== answersRow.version) {
    throw new Error('CASE_SNAPSHOT_VERSION_MISMATCH');
  }
  const facts = asObject(factsRow.facts);
  const sections = asObject(facts.sections);
  const binding = answersRow.binding_config === null || answersRow.binding_config === undefined
    ? null
    : asObject(answersRow.binding_config);
  if (!Array.isArray(answersRow.documents)) throw invalidSnapshot();

  const candidate: Record<string, unknown> = {
    caseId: requiredText(facts, 'caseId'),
    sourceName: requiredText(facts, 'sourceName'),
    sourceDocument: requiredText(facts, 'sourceDocument'),
    age: requiredText(facts, 'age'),
    sex: requiredText(facts, 'sex'),
    complaint: requiredText(facts, 'complaint'),
    sections: {
      history: requiredText(sections, 'history'),
      exam: requiredText(sections, 'exam'),
      tests: requiredText(sections, 'tests'),
      diagnosis: typeof answersRow.diagnosis === 'string' ? answersRow.diagnosis : '',
      plan: typeof answersRow.plan === 'string' ? answersRow.plan : '',
    },
    vitals: facts.vitals,
    documents: answersRow.documents,
  };
  if (facts.teachingSimulation === true) candidate.teachingSimulation = true;
  if (binding) {
    for (const key of ['testRelease', 'testMedia', 'examRules', 'testDefinitions', 'examMedia'] as const) {
      const value = optionalBinding(binding, key);
      if (value !== undefined) candidate[key] = value;
    }
  }

  const record = recordSchema.parse(candidate);
  if (record.caseId !== factsRow.case_id) throw new Error('CASE_SNAPSHOT_VERSION_MISMATCH');
  const version = computeCaseDataVersion(record);
  if (version !== factsRow.version) throw new Error('CASE_SNAPSHOT_VERSION_MISMATCH');
  return { record, version, createdAt: factsRow.created_at ?? '' };
}

export interface ControlledManifest {
  status: 'candidate';
  entries: Array<{
    seq: string;
    entryId: string;
    publicEntryId: string;
    sourceId: string;
    relation: 'source' | 'alias' | 'subtype';
  }>;
  sha256: Record<string, string>;
}

/** Rebuild the deterministic 67-entry manifest without inventing catalogue entries. */
export function buildControlledCaseManifest(currentHashes: ReadonlyMap<string, string>): ControlledManifest {
  const ordered = [...TEACHER_CASE_CATALOG].sort((left, right) =>
    (CASE_INDEX_NUMBER[left.id] ?? Number.MAX_SAFE_INTEGER) - (CASE_INDEX_NUMBER[right.id] ?? Number.MAX_SAFE_INTEGER),
  );
  const sourceIds = new Set(TEACHER_CASE_CATALOG.filter((item) => item.folder).map((item) => item.id));
  const entries = ordered.map((item) => {
    const link = TEACHER_CASE_LINKS[item.id];
    const sourceId = link?.sourceId ?? item.id;
    return {
      seq: String(CASE_INDEX_NUMBER[item.id] ?? ''),
      entryId: item.id,
      publicEntryId: publicCaseId(item.id),
      sourceId,
      relation: link?.relation ?? 'source' as const,
    };
  });
  if (
    entries.length !== 67
    || entries.some((entry) => !/^\d+$/.test(entry.seq) || !sourceIds.has(entry.sourceId))
    || new Set(entries.map((entry) => entry.entryId)).size !== entries.length
    || new Set(entries.map((entry) => entry.publicEntryId)).size !== entries.length
    || new Set(entries.map((entry) => entry.seq)).size !== entries.length
  ) {
    throw new Error('CASE_PACKAGE_MANIFEST_INVALID');
  }
  const sha256: Record<string, string> = {};
  for (const item of TEACHER_CASE_CATALOG.filter((entry) => entry.folder)) {
    const digest = currentHashes.get(item.id);
    if (!digest || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('CASE_PACKAGE_SOURCE_HASH_MISSING');
    sha256[`knowledge/teaching-cases/${item.id}.json`] = digest;
  }
  return { status: 'candidate', entries, sha256 };
}

export interface RestoreCaseResult {
  caseId: string;
  currentVersion: string | null;
  verifiedVersions: string[];
  action: 'written' | 'unchanged' | 'conflict' | 'missing';
}

export interface RestorePackageResult {
  complete: boolean;
  package: {
    entryCount: number;
    sourceCount: number;
    aliasCount: number;
    subtypeCount: number;
    fingerprint: string | null;
  };
  snapshots: {
    facts: number;
    answers: number;
    verified: number;
    rejected: number;
  };
  files: {
    archiveWritten: number;
    archiveUnchanged: number;
    currentWritten: number;
    currentUnchanged: number;
  };
  missing: string[];
  conflicts: string[];
  warnings: string[];
  cases: RestoreCaseResult[];
}

/** Only rows visible to the authenticated teacher may be passed here; no filesystem or arbitrary path export. */
export function exportRestoredCaseSources(factsRows:SnapshotFactsRow[],answersRows:SnapshotAnswersRow[],result:RestorePackageResult){
  const allowed=new Set(TEACHER_CASE_CATALOG.filter(item=>item.folder).map(item=>item.id));
  if(!result.complete||result.cases.length!==allowed.size||new Set(result.cases.map(item=>item.caseId)).size!==allowed.size)throw new Error('CASE_SOURCE_EXPORT_INCOMPLETE');
  const files:Record<string,Uint8Array>={};
  const currentHashes=new Map<string,string>();
  let totalBytes=0,versionCount=0;
  function add(name:string,record:TeacherCaseData){
    const bytes=strToU8(JSON.stringify(record,null,2));totalBytes+=bytes.byteLength;
    if(totalBytes>64_000_000)throw new Error('CASE_SOURCE_EXPORT_TOO_LARGE');
    files[name]=bytes;
    return createHash('sha256').update(bytes).digest('hex');
  }
  for(const item of result.cases){
    if(!allowed.has(item.caseId)||/[\\/]|\.\./.test(item.caseId)||!item.currentVersion||!item.verifiedVersions.includes(item.currentVersion))throw new Error('CASE_SOURCE_EXPORT_INCOMPLETE');
    for(const version of item.verifiedVersions){
      const facts=factsRows.filter(row=>row.case_id===item.caseId&&row.version===version);
      const answers=answersRows.filter(row=>row.case_id===item.caseId&&row.version===version);
      if(facts.length!==1||answers.length!==1)throw new Error('CASE_SOURCE_EXPORT_VERSION_INVALID');
      const verified=reconstructCaseSnapshot(facts[0],answers[0]);
      add(`teaching-case-versions/${item.caseId}/${verified.version}.json`,verified.record);versionCount++;
      if(version===item.currentVersion)currentHashes.set(item.caseId,add(`teaching-cases/${item.caseId}.json`,verified.record));
    }
  }
  const manifest=buildControlledCaseManifest(currentHashes);
  files['case-package-manifest.json']=strToU8(JSON.stringify(manifest,null,2));
  files['source-export-manifest.json']=strToU8(JSON.stringify({schemaVersion:1,sourceCount:currentHashes.size,versionCount,databaseMutation:'none',files:Object.entries(files).map(([name,bytes])=>({path:name,bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')}))},null,2));
  const bytes=zipSync(files,{level:6});
  return {bytes,sourceCount:currentHashes.size,versionCount,sha256:createHash('sha256').update(bytes).digest('hex')};
}

interface RestoreOptions {
  root?: string;
  activeVersions?: Readonly<Record<string, string>>;
  /** Server-side test/verified override; never populated from client input. */
  preferredVersions?: Readonly<Record<string, string>>;
  now?: Date;
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, file);
}

async function readCurrentVersion(file: string): Promise<{ raw: string; version: string } | null> {
  try {
    const raw = await readFile(file, 'utf8');
    const record = recordSchema.parse(JSON.parse(raw));
    return { raw, version: computeCaseDataVersion(record) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('CASE_SOURCE_INVALID');
  }
}

/**
 * Write only verified snapshots. Archive files for every verified version are written
 * first; current files and the manifest are finalized only when all 53 sources resolve.
 */
export async function restoreControlledCaseSources(
  factsRows: SnapshotFactsRow[],
  answersRows: SnapshotAnswersRow[],
  options: RestoreOptions = {},
): Promise<RestorePackageResult> {
  const root = path.resolve(options.root ?? getKnowledgeRoot());
  const sourceItems = TEACHER_CASE_CATALOG.filter((item) => item.folder);
  const sourceIds = new Set(sourceItems.map((item) => item.id));
  const answers = new Map(answersRows.map((row) => [`${row.case_id}\0${row.version}`, row]));
  const verifiedByCase = new Map<string, ReconstructedCaseSnapshot[]>();
  let rejected = 0;

  for (const factsRow of factsRows) {
    if (!sourceIds.has(factsRow.case_id)) continue;
    const answer = answers.get(`${factsRow.case_id}\0${factsRow.version}`);
    if (!answer) {
      rejected += 1;
      continue;
    }
    try {
      const rebuilt = reconstructCaseSnapshot(factsRow, answer);
      const list = verifiedByCase.get(rebuilt.record.caseId) ?? [];
      list.push(rebuilt);
      verifiedByCase.set(rebuilt.record.caseId, list);
    } catch {
      rejected += 1;
    }
  }

  for (const versions of verifiedByCase.values()) {
    versions.sort((left, right) => left.version.localeCompare(right.version));
  }

  let archiveWritten = 0;
  let archiveUnchanged = 0;
  for (const [caseId, versions] of verifiedByCase) {
    for (const { record, version } of versions) {
      const file = path.join(root, 'teaching-case-versions', caseId, `${version}.json`);
      const existing = await readCurrentVersion(file);
      if (existing?.version === version) {
        archiveUnchanged += 1;
        continue;
      }
      await writeAtomic(file, JSON.stringify(record));
      archiveWritten += 1;
    }
  }

  const currentHashes = new Map<string, string>();
  const plans: Array<{
    caseId: string;
    target: ReconstructedCaseSnapshot | null;
    action: RestoreCaseResult['action'];
    raw?: string;
    record?: TeacherCaseData;
  }> = [];
  const missing: string[] = [];
  const conflicts: string[] = [];
  const warnings: string[] = [];

  for (const item of sourceItems) {
    const versions = verifiedByCase.get(item.id) ?? [];
    const available = new Set(versions.map((version) => version.version));
    const active = options.activeVersions?.[item.id];
    const known = options.preferredVersions?.[item.id] ?? VERIFIED_CURRENT_VERSIONS[item.id];
    const latest = [...versions].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.version.localeCompare(left.version),
    )[0]?.version ?? null;
    let targetVersion: string | null = null;
    if (active && available.has(active)) targetVersion = active;
    else if (known) targetVersion = known;
    else {
      if (active) warnings.push(`${item.id}:active-version-unverified; using latest verified version`);
      targetVersion = latest;
    }

    if (!targetVersion) {
      missing.push(item.id);
      plans.push({ caseId: item.id, target: null, action: 'missing' });
      continue;
    }
    if (!available.has(targetVersion)) {
      conflicts.push(`${item.id}:${known ? 'planned' : 'active'}-version-not-in-verified-snapshots`);
      plans.push({ caseId: item.id, target: null, action: 'conflict' });
      continue;
    }
    const target = versions.find((version) => version.version === targetVersion) ?? null;
    if (!target) {
      missing.push(item.id);
      plans.push({ caseId: item.id, target: null, action: 'missing' });
      continue;
    }
    const file = path.join(root, 'teaching-cases', `${item.id}.json`);
    let existing: { raw: string; version: string } | null = null;
    try {
      existing = await readCurrentVersion(file);
    } catch {
      conflicts.push(`${item.id}:current-file-invalid`);
      plans.push({ caseId: item.id, target, action: 'conflict' });
      continue;
    }
    if (existing && existing.version !== target.version) {
      conflicts.push(`${item.id}:current-version-differs`);
      plans.push({ caseId: item.id, target, action: 'conflict' });
      continue;
    }
    const raw = existing?.raw ?? JSON.stringify(target.record);
    currentHashes.set(item.id, createHash('sha256').update(raw).digest('hex'));
    plans.push({
      caseId: item.id,
      target,
      action: existing ? 'unchanged' : 'written',
      raw,
      record: target.record,
    });
  }

  const complete = missing.length === 0 && conflicts.length === 0 && currentHashes.size === sourceItems.length;
  let currentWritten = 0;
  let currentUnchanged = 0;
  if (complete) {
    for (const plan of plans) {
      if (!plan.raw) continue;
      if (plan.action === 'unchanged') {
        currentUnchanged += 1;
        continue;
      }
      await writeAtomic(path.join(root, 'teaching-cases', `${plan.caseId}.json`), plan.raw);
      currentWritten += 1;
    }
  }

  let fingerprint: string | null = null;
  if (complete) {
    const manifest = buildControlledCaseManifest(currentHashes);
    const rawManifest = JSON.stringify(manifest, null, 2);
    const { parseControlledCasePackageManifest } = await import('@/lib/controlled-case-package');
    parseControlledCasePackageManifest(manifest);
    await writeAtomic(path.join(root, 'case-package-manifest.json'), rawManifest);
    fingerprint = createHash('sha256').update(rawManifest).digest('hex');

    const auditDir = path.join(root, 'source-recovery-audits');
    const audit = {
      generatedAt: (options.now ?? new Date()).toISOString(),
      policy: {
        source: 'teacher-visible case_snapshot_facts + case_snapshot_answers',
        verification: 'recomputed case-content-v2 fingerprint equals both stored row versions',
        overwrite: 'only absent current files; different verified current versions are reported as conflicts',
        activeVersion: 'prefer the exact active version only when its snapshot is verifiable; otherwise keep the binding unchanged and select the latest verified version',
        databaseMutation: 'none',
      },
      warnings,
      package: {
        fingerprint,
        entryCount: manifest.entries.length,
        sourceCount: sourceItems.length,
        aliasCount: manifest.entries.filter((entry) => entry.relation === 'alias').length,
        subtypeCount: manifest.entries.filter((entry) => entry.relation === 'subtype').length,
      },
      snapshots: {
        facts: factsRows.length,
        answers: answersRows.length,
        verified: [...verifiedByCase.values()].reduce((total, versions) => total + versions.length, 0),
        rejected,
      },
      cases: plans
        .map((plan) => ({
          caseId: plan.caseId,
          currentVersion: plan.target?.version ?? null,
          verifiedVersions: (verifiedByCase.get(plan.caseId) ?? []).map((version) => version.version),
          action: plan.action,
        }))
        .sort((left, right) => left.caseId.localeCompare(right.caseId)),
    };
    const auditText = JSON.stringify(audit, null, 2);
    const auditHash = createHash('sha256').update(auditText).digest('hex');
    await writeAtomic(path.join(auditDir, `${auditHash}.json`), auditText);
  }

  const cases = plans.map((plan): RestoreCaseResult => ({
    caseId: plan.caseId,
    currentVersion: plan.target?.version ?? null,
    verifiedVersions: (verifiedByCase.get(plan.caseId) ?? []).map((version) => version.version),
    action: plan.action,
  }));
  const verifiedCount = [...verifiedByCase.values()].reduce((total, versions) => total + versions.length, 0);
  return {
    complete,
    package: {
      entryCount: 67,
      sourceCount: sourceItems.length,
      aliasCount: TEACHER_CASE_CATALOG.filter((item) => TEACHER_CASE_LINKS[item.id]?.relation === 'alias').length,
      subtypeCount: TEACHER_CASE_CATALOG.filter((item) => TEACHER_CASE_LINKS[item.id]?.relation === 'subtype').length,
      fingerprint,
    },
    snapshots: {
      facts: factsRows.length,
      answers: answersRows.length,
      verified: verifiedCount,
      rejected,
    },
    files: {
      archiveWritten,
      archiveUnchanged,
      currentWritten,
      currentUnchanged,
    },
    missing,
    conflicts,
    warnings,
    cases,
  };
}
