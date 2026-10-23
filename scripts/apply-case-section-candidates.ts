/** Apply source-preserving, fingerprint-verified section candidates locally only.
 * Default is a dry run. No database calls, authentication or publication.
 * Every replacement is backed up and journaled before the atomic rename.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { TEACHER_CASE_CATALOG } from '@/domain/teacher-case-catalog';
import { computeCaseContentHash, computeCaseDataVersion } from '@/lib/case-data-version';
import { getKnowledgeRoot, recordSchema } from '@/lib/teacher-case-data';

const root = process.cwd();
const argIndex = process.argv.indexOf('--output');
const output = path.resolve(root, argIndex >= 0 ? process.argv[argIndex + 1] : 'outputs/case-library-review/20261021');
if (!output.startsWith(`${root}${path.sep}`)) throw new Error('Output must stay inside repository');
execFileSync('git', ['check-ignore', output], { stdio: 'pipe' });
const apply = process.argv.includes('--apply');
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const atomicJson = (file: string, value: unknown) => {
  writeFileSync(`${file}.pending`, JSON.stringify(value, null, 2) + '\n');
  renameSync(`${file}.pending`, file);
};
interface AuditRow {
  caseId: string;
  status: string;
  baselineRuntimeSha256: string;
  candidate?: string;
  candidateSha256?: string;
  sourceLinesPreserved?: boolean;
  verifiedOriginalMaterialIds?: string[];
}
interface JournalRow {
  caseId: string;
  baselineRuntimeSha256: string;
  candidateSha256: string;
  beforeVersion: string;
  afterVersion: string;
  afterContentHash: string;
  backup: string;
  state: 'planned' | 'backup_saved' | 'applied';
}
const audit = JSON.parse(readFileSync(path.join(output, 'section-audit.json'), 'utf8')) as { baseline: string; results: AuditRow[] };
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (head !== audit.baseline) throw new Error('Git baseline changed; recheck candidates');
const journalFile = path.join(output, 'section-apply-manifest.json');
const previous = existsSync(journalFile) ? JSON.parse(readFileSync(journalFile, 'utf8')) as { baseline: string; rows: JournalRow[] } : null;
if (previous && previous.baseline !== head) throw new Error('Apply journal belongs to another Git baseline');
const rows = previous?.rows ?? [];
const saveJournal = () => atomicJson(journalFile, { baseline: head, versionAlgorithm: 'case-content-v2', localOnly: true, rows });
const operations = [];
let replacedThisRun = 0;
for (const item of audit.results.filter(row => row.status === 'candidate_staged_not_applied')) {
  if (!TEACHER_CASE_CATALOG.some(row => row.id === item.caseId && row.folder) || !item.sourceLinesPreserved || !item.verifiedOriginalMaterialIds?.length) {
    throw new Error(`Unverified candidate ${item.caseId}`);
  }
  if (!item.candidate || !item.candidateSha256) throw new Error('Missing candidate fingerprint');
  const candidateFile = path.resolve(root, item.candidate);
  if (!candidateFile.startsWith(`${output}${path.sep}`)) throw new Error('Candidate escaped review output');
  const candidateBytes = readFileSync(candidateFile);
  if (hash(candidateBytes) !== item.candidateSha256) throw new Error(`Candidate changed ${item.caseId}`);
  const target = path.join(getKnowledgeRoot(), 'teaching-cases', `${item.caseId}.json`);
  const currentBytes = readFileSync(target);
  const currentHash = hash(currentBytes);
  const existing = rows.find(row => row.caseId === item.caseId);
  if (currentHash === item.candidateSha256) {
    if (!existing || existing.baselineRuntimeSha256 !== item.baselineRuntimeSha256 || existing.candidateSha256 !== item.candidateSha256 || hash(readFileSync(existing.backup)) !== item.baselineRuntimeSha256) {
      throw new Error(`Already changed but no matching recovery journal ${item.caseId}`);
    }
    if (apply) { existing.state = 'applied'; saveJournal(); }
    continue;
  }
  if (currentHash !== item.baselineRuntimeSha256) throw new Error(`Runtime changed concurrently ${item.caseId}`);
  const beforeRaw = JSON.parse(currentBytes.toString('utf8')) as Record<string, unknown>;
  const afterRaw = JSON.parse(candidateBytes.toString('utf8')) as Record<string, unknown>;
  const before = recordSchema.parse(beforeRaw);
  const after = recordSchema.parse(afterRaw);
  if (before.caseId !== item.caseId || after.caseId !== item.caseId) throw new Error('Case ID mismatch');
  if (!isDeepStrictEqual({ ...beforeRaw, sections: null }, { ...afterRaw, sections: null })) throw new Error('Candidate changes more than source sections');
  const sourceLines = (sections: typeof before.sections) => Object.values(sections).flatMap(value => value.split('\n').filter(line => line.trim())).sort();
  if (!isDeepStrictEqual(sourceLines(before.sections), sourceLines(after.sections))) throw new Error('Source lines changed');
  const beforeVersion = computeCaseDataVersion(before);
  const afterVersion = computeCaseDataVersion(after);
  if (beforeVersion === afterVersion) throw new Error('Content changed without version change');
  if (existing && (existing.baselineRuntimeSha256 !== currentHash || existing.candidateSha256 !== item.candidateSha256)) throw new Error('Conflicting apply journal');
  const row: JournalRow = existing ?? {
    caseId: item.caseId, baselineRuntimeSha256: currentHash, candidateSha256: item.candidateSha256,
    beforeVersion, afterVersion, afterContentHash: computeCaseContentHash(after),
    backup: path.join(output, 'runtime-backups', currentHash, `${item.caseId}.json`), state: 'planned',
  };
  operations.push({ target, currentHash, currentBytes, candidateBytes, row });
}
// Preflight the entire batch before any writes; recheck each file at replacement.
for (const operation of operations) {
  const { target, currentHash, currentBytes, candidateBytes, row } = operation;
  if (!apply) continue;
  if (!rows.includes(row)) rows.push(row);
  saveJournal();
  mkdirSync(path.dirname(row.backup), { recursive: true });
  if (!existsSync(row.backup)) writeFileSync(row.backup, currentBytes, { flag: 'wx' });
  if (hash(readFileSync(row.backup)) !== currentHash) throw new Error('Backup mismatch');
  row.state = 'backup_saved'; saveJournal();
  if (hash(readFileSync(target)) !== currentHash) throw new Error('Runtime changed after preflight');
  writeFileSync(`${target}.pending`, candidateBytes);
  renameSync(`${target}.pending`, target);
  if (hash(readFileSync(target)) !== row.candidateSha256) throw new Error('Replacement verification failed');
  replacedThisRun += 1;
  row.state = 'applied'; saveJournal();
}
if (apply) {
  const cases = TEACHER_CASE_CATALOG.filter(item => item.folder).map(item => {
    const file = path.join(getKnowledgeRoot(), 'teaching-cases', `${item.id}.json`);
    if (!existsSync(file)) return null;
    const bytes = readFileSync(file);
    const record = recordSchema.parse(JSON.parse(bytes.toString('utf8')));
    return { caseId: item.id, runtimeFileSha256: hash(bytes), contentVersion: computeCaseDataVersion(record),
      contentHash: computeCaseContentHash(record), localSectionRepair: rows.some(row => row.caseId === item.id && row.state === 'applied') };
  }).filter(Boolean);
  atomicJson(path.join(output, 'content-version-mapping.json'), {
    generatedAt: new Date().toISOString(), algorithm: 'case-content-v2',
    versionAlgorithmSha256: hash(readFileSync(path.join(root, 'src/lib/case-data-version.ts'))),
    requiresTeacherImportBeforeDeployment: true, databaseMigrated: false, cases,
  });
}
console.log(JSON.stringify({ mode: apply ? 'apply_local_only' : 'dry_run', candidates: audit.results.filter(row => row.status === 'candidate_staged_not_applied').length,
  replacedThisRun,
  pendingReplacements: apply ? rows.filter(row => row.state !== 'applied').length : operations.length,
  appliedWithBackup: apply ? rows.filter(row => row.state === 'applied').length : 0, databaseWrites: 0, published: false }));
