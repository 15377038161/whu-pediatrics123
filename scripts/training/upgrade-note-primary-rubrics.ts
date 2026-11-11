/** Build a new immutable runtime by replacing only the 67 rubrics with note-primary-60-v1. */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { buildNotePrimaryRubric } from '../../src/domain/note-primary-rubric';
import { NOTE_PRIMARY_VERSION, notePrimaryErrors } from '../../src/domain/note-primary-contract';
import { teachingPackageSchema, type TeachingPackage } from '../../src/domain/teaching-package';
import { teachingPackageVersion } from '../../src/lib/teaching-package-store';

const baselineValue = process.env.PEDIATRICS_TRAINING_BASELINE_ROOT;
const outputValue = process.env.PEDIATRICS_TRAINING_OUTPUT_ROOT;
if (!baselineValue || !outputValue) {
  throw new Error('Usage: PEDIATRICS_TRAINING_BASELINE_ROOT=<verified/runtime> PEDIATRICS_TRAINING_OUTPUT_ROOT=<new/runtime> tsx scripts/training/upgrade-note-primary-rubrics.ts');
}
const baseline = path.resolve(baselineValue);
const output = path.resolve(outputValue);
if (output === baseline || output.startsWith(`${baseline}${path.sep}`) || existsSync(output)) {
  throw new Error('OUTPUT_MUST_BE_NEW_AND_OUTSIDE_BASELINE');
}
const indexSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(z.string(), z.string().regex(/^[a-f0-9]{20}$/)),
}).strict();
const index = indexSchema.parse(JSON.parse(readFileSync(path.join(baseline, 'index.json'), 'utf8')));
const entries = Object.entries(index.entries);
assert.equal(entries.length, 67, 'BASELINE_ENTRY_COUNT');

const packages: TeachingPackage[] = [];
const results: Array<Record<string, unknown>> = [];
for (const [caseId, baselineVersion] of entries) {
  const oldPackage = teachingPackageSchema.parse(JSON.parse(readFileSync(path.join(baseline, 'packages', `${baselineVersion}.json`), 'utf8')));
  assert.equal(oldPackage.caseId, caseId, `CASE_ID:${caseId}`);
  assert.equal(teachingPackageVersion(oldPackage), baselineVersion, `BASELINE_VERSION:${caseId}`);
  assert.ok(oldPackage.intake, `INTAKE_REQUIRED:${caseId}`);
  assert.notEqual(oldPackage.rubricVersion, NOTE_PRIMARY_VERSION, `BASELINE_ALREADY_UPGRADED:${caseId}`);

  const rubric = buildNotePrimaryRubric(oldPackage);
  const content = teachingPackageSchema.parse({
    ...oldPackage, rubric, rubricVersion: NOTE_PRIMARY_VERSION, version: 'pending',
  });
  const version = teachingPackageVersion(content);
  assert.notEqual(version, baselineVersion, `VERSION_DID_NOT_CHANGE:${caseId}`);
  const nextPackage = teachingPackageSchema.parse({ ...content, version });
  assert.equal(teachingPackageVersion(nextPackage), version, `PACKAGE_VERSION:${caseId}`);
  assert.deepEqual(notePrimaryErrors(nextPackage.rubric), [], `RUBRIC_CONTRACT:${caseId}`);
  for (const key of ['intake', 'historyFacts', 'questions', 'exams', 'tests', 'management', 'referenceNote', 'references'] as const) {
    assert.deepEqual(nextPackage[key], oldPackage[key], `CLINICAL_CONTENT_CHANGED:${caseId}:${key}`);
  }
  assert.equal(nextPackage.sourceVersion, oldPackage.sourceVersion, `SOURCE_VERSION:${caseId}`);
  assert.ok(nextPackage.rubric.every(item => item.id === 'exam-interpret' || item.concepts.length > 0), `EMPTY_CONCEPTS:${caseId}`);

  const round = (value: number) => Math.round(value * 1000) / 1000;
  const sum = (predicate: (item: TeachingPackage['rubric'][number]) => boolean) => round(nextPackage.rubric.filter(predicate).reduce((total, item) => total + item.maxScore, 0));
  assert.equal(sum(() => true), 100, `TOTAL:${caseId}`);
  assert.equal(sum(item => item.section === 'note'), 60, `NOTE_TOTAL:${caseId}`);
  assert.equal(sum(item => item.section !== 'note'), 40, `PROCESS_TOTAL:${caseId}`);
  assert.equal(sum(item => item.level === 'basic'), 80, `BASIC_TOTAL:${caseId}`);
  assert.equal(sum(item => item.level === 'advanced'), 20, `ADVANCED_TOTAL:${caseId}`);
  packages.push(nextPackage);
  results.push({
    caseId,
    sourceId: oldPackage.sourceId,
    sourceVersion: oldPackage.sourceVersion,
    baselineTeachingVersion: baselineVersion,
    teachingVersion: version,
    rubricVersion: NOTE_PRIMARY_VERSION,
    rubricItems: rubric.length,
    noteItems: rubric.filter(item => item.section === 'note').length,
    processItems: rubric.filter(item => item.section !== 'note').length,
    noteScore: 60,
    processScore: 40,
    basicScore: 80,
    advancedScore: 20,
    primaryDiagnosis: oldPackage.referenceNote.preliminaryDiagnosis,
    intakeUnchanged: true,
    clinicalContentUnchanged: true,
  });
}
assert.equal(new Set(packages.map(item => item.version)).size, 67, 'NEW_PACKAGE_VERSIONS_UNIQUE');

mkdirSync(path.join(output, 'packages'), { recursive: true });
const nextEntries: Record<string, string> = {};
for (const [caseId] of entries) {
  const pack = packages.find(item => item.caseId === caseId);
  assert.ok(pack, `OUTPUT_PACKAGE_MISSING:${caseId}`);
  nextEntries[caseId] = pack.version;
  writeFileSync(path.join(output, 'packages', `${pack.version}.json`), JSON.stringify(pack, null, 2), { flag: 'wx' });
}
writeFileSync(path.join(output, 'index.json'), JSON.stringify({ schemaVersion: 1, entries: nextEntries }, null, 2), { flag: 'wx' });
cpSync(path.join(baseline, 'media'), path.join(output, 'media'), { recursive: true, force: false, errorOnExist: true });
writeFileSync(path.join(output, 'note-primary-application-report.json'), JSON.stringify({
  baselineGeneration: path.basename(path.dirname(baseline)),
  rubricVersion: NOTE_PRIMARY_VERSION,
  cases: results.length,
  sourceNumericValuesChanged: false,
  intakeChanged: false,
  results,
}, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ cases: results.length, rubricVersion: NOTE_PRIMARY_VERSION, output, versionsChanged: results.length, clinicalContentChanged: false }));
