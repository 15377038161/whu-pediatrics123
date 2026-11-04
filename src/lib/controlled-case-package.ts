import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { getSupabaseUserClient } from '@/lib/supabase-client';
import { getKnowledgeRoot, recordSchema } from '@/lib/teacher-case-data';
import {
  computeImportVersion,
  controlledCaseReadiness,
  type ImportSummary,
} from '@/lib/teacher-case-import';

const manifestEntrySchema = z.object({
  seq: z.string().regex(/^\d+$/),
  entryId: z.string().min(1),
  publicEntryId: z.string().regex(/^case-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  sourceId: z.string().min(1),
  relation: z.enum(['source', 'alias', 'subtype']),
}).strict();

const manifestSchema = z.object({
  status: z.literal('candidate'),
  entries: z.array(manifestEntrySchema).length(67),
  sha256: z.record(z.string().regex(/^[a-f0-9]{64}$/i)),
}).strict();

const requestSchema = z.object({
  packageFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  only: z.array(z.string().min(1)).min(1).max(53).optional(),
}).strict();

export interface ControlledCasePackage {
  fingerprint: string;
  entryCount: number;
  sourceCount: number;
  aliasCount: number;
  subtypeCount: number;
  sourceCaseIds: string[];
  versions: Record<string, string>;
}

export type ControlledCasePackageMetadata = Omit<ControlledCasePackage, 'sourceCaseIds' | 'versions'>;

export interface ControlledImportRequest {
  only?: string[];
}

export type ControlledImportCaseStatus = 'verified' | 'incomplete' | 'failed' | 'skipped';

export interface ControlledImportCaseResult {
  caseId: string;
  version: string;
  importStatus: ImportSummary['results'][number]['status'];
  factsMatched: boolean;
  answersMatched: boolean;
  status: ControlledImportCaseStatus;
}

export interface ControlledImportVerification {
  total: number;
  verified: number;
  incomplete: number;
  failed: number;
  skipped: number;
  cases: ControlledImportCaseResult[];
}

function packageError(): Error {
  return new Error('CASE_PACKAGE_INVALID');
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

/** Validate the fixed manifest without trusting client-provided paths or case content. */
export function parseControlledCasePackageManifest(input: unknown): {
  sourceCaseIds: string[];
  hashes: Record<string, string>;
  aliasCount: number;
  subtypeCount: number;
} {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) throw packageError();
  const manifest = parsed.data;
  const entryIds = manifest.entries.map((entry) => entry.entryId);
  const publicEntryIds = manifest.entries.map((entry) => entry.publicEntryId);
  const sequences = manifest.entries.map((entry) => entry.seq);
  if (new Set(entryIds).size !== entryIds.length || new Set(publicEntryIds).size !== publicEntryIds.length || new Set(sequences).size !== sequences.length) {
    throw packageError();
  }
  const sourceEntries = manifest.entries.filter((entry) => entry.relation === 'source');
  if (sourceEntries.some((entry) => entry.entryId !== entry.sourceId)) throw packageError();
  const sourceCaseIds = sourceEntries.map((entry) => entry.sourceId);
  if (new Set(sourceCaseIds).size !== sourceCaseIds.length) throw packageError();
  const catalogSourceIds = TEACHER_CASE_CATALOG.filter((item) => item.folder).map((item) => item.id);
  if (!sameMembers(sourceCaseIds, catalogSourceIds)) throw packageError();
  if (manifest.entries.some((entry) => !sourceCaseIds.includes(entry.sourceId))) throw packageError();
  const expectedHashKeys = sourceCaseIds.map((caseId) => `knowledge/teaching-cases/${caseId}.json`);
  if (!sameMembers(Object.keys(manifest.sha256), expectedHashKeys)) throw packageError();
  return {
    sourceCaseIds,
    hashes: manifest.sha256,
    aliasCount: manifest.entries.filter((entry) => entry.relation === 'alias').length,
    subtypeCount: manifest.entries.filter((entry) => entry.relation === 'subtype').length,
  };
}

/** Re-read and hash every fixed server-side source before any database write. */
export function inspectControlledCasePackage(): ControlledCasePackage {
  let rawManifest: string;
  try {
    rawManifest = readFileSync(path.join(getKnowledgeRoot(), 'case-package-manifest.json'), 'utf8');
  } catch {
    throw packageError();
  }
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(rawManifest);
  } catch {
    throw packageError();
  }
  const manifest = parseControlledCasePackageManifest(parsedManifest);
  const versions: Record<string, string> = {};
  for (const caseId of manifest.sourceCaseIds) {
    const expectedHash = manifest.hashes[`knowledge/teaching-cases/${caseId}.json`];
    let rawRecord: string;
    try {
      rawRecord = readFileSync(path.join(getKnowledgeRoot(), 'teaching-cases', `${caseId}.json`), 'utf8');
    } catch {
      throw packageError();
    }
    if (createHash('sha256').update(rawRecord).digest('hex') !== expectedHash) throw packageError();
    try {
      const record = recordSchema.parse(JSON.parse(rawRecord));
      if (record.caseId !== caseId || controlledCaseReadiness(record).length > 0) throw packageError();
      versions[caseId] = computeImportVersion(record);
    } catch {
      throw packageError();
    }
  }
  return {
    fingerprint: createHash('sha256').update(rawManifest).digest('hex'),
    entryCount: 67,
    sourceCount: manifest.sourceCaseIds.length,
    aliasCount: manifest.aliasCount,
    subtypeCount: manifest.subtypeCount,
    sourceCaseIds: manifest.sourceCaseIds,
    versions,
  };
}

export function controlledCasePackageMetadata(item: ControlledCasePackage): ControlledCasePackageMetadata {
  return {
    fingerprint: item.fingerprint,
    entryCount: item.entryCount,
    sourceCount: item.sourceCount,
    aliasCount: item.aliasCount,
    subtypeCount: item.subtypeCount,
  };
}

/** The request can only select IDs from the already inspected package; an empty selection is rejected. */
export function parseControlledCaseImportRequest(input: unknown, item: ControlledCasePackage): ControlledImportRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success || parsed.data.packageFingerprint !== item.fingerprint) {
    if (parsed.success && parsed.data.packageFingerprint !== item.fingerprint) throw new Error('CASE_PACKAGE_CHANGED');
    throw new Error('INVALID_REQUEST');
  }
  if (parsed.data.only) {
    if (new Set(parsed.data.only).size !== parsed.data.only.length || parsed.data.only.some((caseId) => !item.sourceCaseIds.includes(caseId))) {
      throw new Error('INVALID_REQUEST');
    }
  }
  return { only: parsed.data.only };
}

/** Exact-version reconciliation prevents an old facts row from masquerading as a successful import. */
export function reconcileControlledCaseImport(
  summary: ImportSummary,
  versions: Record<string, string>,
  factsRows: Array<{ case_id: string; version: string }>,
  answersRows: Array<{ case_id: string; version: string }>,
): ControlledImportVerification {
  const facts = new Set(factsRows.map((row) => `${row.case_id}\0${row.version}`));
  const answers = new Set(answersRows.map((row) => `${row.case_id}\0${row.version}`));
  const cases = summary.results.map((result) => {
    const version = versions[result.caseId] ?? result.version ?? '';
    const factsMatched = facts.has(`${result.caseId}\0${version}`);
    const answersMatched = answers.has(`${result.caseId}\0${version}`);
    const status: ControlledImportCaseStatus = factsMatched && answersMatched
      ? 'verified'
      : result.status === 'failed'
        ? 'failed'
        : result.status === 'imported' || result.status === 'unchanged'
          ? 'incomplete'
          : 'skipped';
    return {
      caseId: result.caseId,
      version,
      importStatus: result.status,
      factsMatched,
      answersMatched,
      status,
    };
  });
  return {
    total: cases.length,
    verified: cases.filter((item) => item.status === 'verified').length,
    incomplete: cases.filter((item) => item.status === 'incomplete').length,
    failed: cases.filter((item) => item.status === 'failed').length,
    skipped: cases.filter((item) => item.status === 'skipped').length,
    cases,
  };
}

/** Teacher-RLS readback of both snapshot tables after every import attempt, including failures. */
export async function verifyControlledCaseImport(
  accessToken: string,
  summary: ImportSummary,
  item: ControlledCasePackage,
): Promise<ControlledImportVerification> {
  const db = getSupabaseUserClient(accessToken);
  const [factsResult, answersResult] = await Promise.all([
    db.from('case_snapshot_facts').select('case_id,version'),
    db.from('case_snapshot_answers').select('case_id,version'),
  ]);
  if (factsResult.error) throw factsResult.error;
  if (answersResult.error) throw answersResult.error;
  return reconcileControlledCaseImport(
    summary,
    item.versions,
    (factsResult.data ?? []) as Array<{ case_id: string; version: string }>,
    (answersResult.data ?? []) as Array<{ case_id: string; version: string }>,
  );
}
