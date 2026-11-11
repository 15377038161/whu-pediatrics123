/** Build a new immutable runtime from a verified baseline and all 67 intake supplements. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { caseIntakeSchema } from '../../src/domain/case-intake';
import { teachingPackageSchema, type TeachingPackage } from '../../src/domain/teaching-package';
import { computeCaseDataVersion } from '../../src/lib/case-data-version';
import { publicCaseId } from '../../src/lib/case-identity';
import { deidentifyClinicalText } from '../../src/lib/history-dialogue';
import { recordSchema } from '../../src/lib/teacher-case-data';
import { teachingPackageVersion } from '../../src/lib/teaching-package-store';

const baselineRootValue = process.env.PEDIATRICS_TRAINING_BASELINE_ROOT;
const supplementRootValue = process.env.PEDIATRICS_INTAKE_SUPPLEMENT_ROOT;
const outputRootValue = process.env.PEDIATRICS_TRAINING_OUTPUT_ROOT;
if (!baselineRootValue || !supplementRootValue || !outputRootValue) {
  throw new Error('Usage: PEDIATRICS_TRAINING_BASELINE_ROOT=<baseline/runtime> PEDIATRICS_INTAKE_SUPPLEMENT_ROOT=<extracted supplement> PEDIATRICS_TRAINING_OUTPUT_ROOT=<new runtime> tsx scripts/training/apply-intake-supplements.ts');
}
const baselineRoot = path.resolve(baselineRootValue);
const supplementRoot = path.resolve(supplementRootValue);
const outputRoot = path.resolve(outputRootValue);
if (outputRoot === baselineRoot || outputRoot.startsWith(`${baselineRoot}${path.sep}`) || existsSync(outputRoot)) {
  throw new Error('OUTPUT_MUST_BE_NEW_AND_OUTSIDE_BASELINE');
}

const runtimeIndexSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(z.string(), z.string().regex(/^[a-f0-9]{20}$/)),
}).strict();
const supplementIndexSchema = z.object({
  generation: z.string().regex(/^[a-f0-9]{20}$/),
  cases: z.array(z.object({
    system: z.string().trim().min(1),
    level: z.number().int().positive(),
    title: z.string().trim().min(1),
    publicCaseId: z.string().startsWith('case-'),
    caseId: z.string().startsWith('teacher-'),
    file: z.string().trim().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    recordedVitals: z.number().int().min(0).max(4),
    missingVitals: z.number().int().min(0).max(4),
    additionalSourceReviewFields: z.array(z.string()),
  }).strict()),
}).strict();
const supplementRecordSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('case-intake-authoring-supplement'),
  baselineGeneration: z.string().regex(/^[a-f0-9]{20}$/),
  publicCaseId: z.string().startsWith('case-'),
  caseId: z.string().startsWith('teacher-'),
  sourceId: z.string().startsWith('teacher-'),
  sourceVersion: z.string().regex(/^[a-f0-9]{16}$/),
  baselineTeachingVersion: z.string().regex(/^[a-f0-9]{20}$/),
  system: z.string().trim().min(1),
  level: z.number().int().positive(),
  intake: caseIntakeSchema,
}).passthrough();

function readJson<Schema extends z.ZodType>(file: string, schema: Schema): z.output<Schema> {
  return schema.parse(JSON.parse(readFileSync(file, 'utf8')));
}
function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const baselineIndex = readJson(path.join(baselineRoot, 'index.json'), runtimeIndexSchema);
const supplementIndex = readJson(path.join(supplementRoot, '接诊信息逐例索引.json'), supplementIndexSchema);
assert.equal(Object.keys(baselineIndex.entries).length, 67, 'BASELINE_ENTRY_COUNT');
assert.equal(supplementIndex.cases.length, 67, 'SUPPLEMENT_ENTRY_COUNT');
assert.equal(new Set(supplementIndex.cases.map(item => item.caseId)).size, 67, 'SUPPLEMENT_CASE_ID_UNIQUE');
assert.equal(supplementIndex.generation, path.basename(path.dirname(baselineRoot)), 'BASELINE_GENERATION_MISMATCH');
assert.deepEqual(new Set(supplementIndex.cases.map(item => item.caseId)), new Set(Object.keys(baselineIndex.entries)), 'SUPPLEMENT_CASE_SET_MISMATCH');

const sourceRoot = path.join(path.dirname(baselineRoot), 'source-cases');
const sourceAnonymousIds = new Map<string, string>();
const results: Array<Record<string, unknown>> = [];
const nextPackages: TeachingPackage[] = [];
for (const entry of supplementIndex.cases) {
  const file = path.resolve(supplementRoot, entry.file);
  if (!file.startsWith(`${supplementRoot}${path.sep}`)) throw new Error(`INTAKE_PATH_INVALID:${entry.caseId}`);
  const bytes = readFileSync(file);
  assert.equal(sha256(bytes), entry.sha256, `INTAKE_FILE_SHA256:${entry.caseId}`);
  const supplement = supplementRecordSchema.parse(JSON.parse(bytes.toString('utf8')));
  assert.equal(supplement.baselineGeneration, supplementIndex.generation, `BASELINE_GENERATION:${entry.caseId}`);
  assert.equal(supplement.caseId, entry.caseId, `CASE_ID:${entry.caseId}`);
  assert.equal(supplement.publicCaseId, entry.publicCaseId, `PUBLIC_CASE_ID:${entry.caseId}`);
  assert.equal(publicCaseId(entry.caseId), entry.publicCaseId, `PUBLIC_ID_BINDING:${entry.caseId}`);
  assert.equal(supplement.system, entry.system, `SYSTEM:${entry.caseId}`);
  assert.equal(supplement.level, entry.level, `LEVEL:${entry.caseId}`);

  const oldVersion = baselineIndex.entries[entry.caseId];
  const oldPackage = readJson(path.join(baselineRoot, 'packages', `${oldVersion}.json`), teachingPackageSchema);
  assert.equal(oldPackage.caseId, entry.caseId, `BASELINE_CASE:${entry.caseId}`);
  assert.equal(teachingPackageVersion(oldPackage), oldVersion, `BASELINE_PACKAGE_VERSION:${entry.caseId}`);
  assert.equal(oldPackage.intake, undefined, `BASELINE_ALREADY_HAS_INTAKE:${entry.caseId}`);
  assert.equal(supplement.baselineTeachingVersion, oldVersion, `BASELINE_TEACHING_VERSION:${entry.caseId}`);
  assert.equal(supplement.sourceId, oldPackage.sourceId, `SOURCE_ID:${entry.caseId}`);
  assert.equal(supplement.sourceVersion, oldPackage.sourceVersion, `SOURCE_VERSION:${entry.caseId}`);

  const source = readJson(path.join(sourceRoot, `${oldPackage.sourceId}.json`), recordSchema);
  assert.equal(computeCaseDataVersion(source), oldPackage.sourceVersion, `SOURCE_FILE_VERSION:${entry.caseId}`);
  assert.equal(supplement.intake.patient.age.value, source.age, `AGE:${entry.caseId}`);
  assert.equal(supplement.intake.patient.sex.value, source.sex, `SEX:${entry.caseId}`);
  assert.equal(supplement.intake.encounter.chiefComplaint.value, deidentifyClinicalText(source.complaint), `COMPLAINT:${entry.caseId}`);
  const sharedAnonymousId = sourceAnonymousIds.get(oldPackage.sourceId);
  if (sharedAnonymousId) assert.equal(sharedAnonymousId, supplement.intake.patient.anonymousId.value, `SHARED_ANONYMOUS_ID:${entry.caseId}`);
  else sourceAnonymousIds.set(oldPackage.sourceId, supplement.intake.patient.anonymousId.value);

  for (const vital of supplement.intake.initialVitals) {
    const sourceValue = source.vitals[vital.code];
    assert.equal(vital.value, sourceValue, `SOURCE_VITAL:${entry.caseId}:${vital.code}`);
    assert.equal(vital.status, sourceValue === null ? 'not-recorded-in-source' : 'recorded', `SOURCE_VITAL_STATUS:${entry.caseId}:${vital.code}`);
  }
  const recordedVitals = supplement.intake.initialVitals.filter(item => item.status === 'recorded').length;
  const missingVitals = 4 - recordedVitals;
  assert.equal(recordedVitals, entry.recordedVitals, `RECORDED_VITAL_COUNT:${entry.caseId}`);
  assert.equal(missingVitals, entry.missingVitals, `MISSING_VITAL_COUNT:${entry.caseId}`);
  assert.equal(supplement.intake.initialObservations.recordedFindings.length, 0, `TRIAGE_ANSWER_LEAK:${entry.caseId}`);

  // Parse before hashing so optional-field insertion and schema key order are stable on read-back.
  const content = teachingPackageSchema.parse({ ...oldPackage, intake: supplement.intake, version: 'pending' });
  const nextVersion = teachingPackageVersion(content);
  assert.notEqual(nextVersion, oldVersion, `VERSION_DID_NOT_CHANGE:${entry.caseId}`);
  const nextPackage: TeachingPackage = { ...content, version: nextVersion };
  assert.equal(teachingPackageVersion(nextPackage), nextVersion, `NEW_PACKAGE_VERSION:${entry.caseId}`);
  nextPackages.push(nextPackage);
  results.push({
    caseId: entry.caseId,
    publicCaseId: entry.publicCaseId,
    sourceId: oldPackage.sourceId,
    sourceVersion: oldPackage.sourceVersion,
    baselineTeachingVersion: oldVersion,
    teachingVersion: nextVersion,
    system: entry.system,
    level: entry.level,
    title: entry.title,
    intakeStatus: 'passed',
    recordedVitals,
    missingVitals,
    pendingAdditionalMeasurements: supplement.intake.additionalMeasurements.filter(item => item.status === 'requires-source-review').length,
    sourceReviewFields: entry.additionalSourceReviewFields,
  });
}

const verification = readJson(path.join(supplementRoot, '接诊补充核验记录.json'), z.object({
  cases: z.literal(67),
  vitalRows: z.literal(268),
  recordedByField: z.record(z.string(), z.number().int()),
  notRecordedByField: z.record(z.string(), z.number().int()),
  sourceNumericValuesChanged: z.literal(false),
  anonymousIdUsesSharedSourceIdentity: z.literal(true),
}).passthrough());
const allVitals = nextPackages.flatMap(item => item.intake!.initialVitals);
for (const code of ['temperature', 'heartRate', 'respiratoryRate', 'spo2'] as const) {
  assert.equal(allVitals.filter(item => item.code === code && item.status === 'recorded').length, verification.recordedByField[code], `VERIFY_RECORDED:${code}`);
  assert.equal(allVitals.filter(item => item.code === code && item.status === 'not-recorded-in-source').length, verification.notRecordedByField[code], `VERIFY_MISSING:${code}`);
}
assert.equal(sourceAnonymousIds.size, 53, 'SOURCE_COUNT');
assert.equal(new Set(nextPackages.map(item => item.version)).size, 67, 'NEW_PACKAGE_VERSIONS_UNIQUE');

mkdirSync(path.join(outputRoot, 'packages'), { recursive: true });
const nextEntries: Record<string, string> = {};
for (const [caseId] of Object.entries(baselineIndex.entries)) {
  const pack = nextPackages.find(item => item.caseId === caseId);
  assert.ok(pack, `OUTPUT_PACKAGE_MISSING:${caseId}`);
  nextEntries[caseId] = pack.version;
  writeFileSync(path.join(outputRoot, 'packages', `${pack.version}.json`), JSON.stringify(pack, null, 2), { flag: 'wx' });
}
writeFileSync(path.join(outputRoot, 'index.json'), JSON.stringify({ schemaVersion: 1, entries: nextEntries }, null, 2), { flag: 'wx' });
cpSync(path.join(baselineRoot, 'media'), path.join(outputRoot, 'media'), { recursive: true, force: false, errorOnExist: true });
writeFileSync(path.join(outputRoot, 'intake-application-report.json'), JSON.stringify({
  baselineGeneration: supplementIndex.generation,
  cases: results.length,
  sources: sourceAnonymousIds.size,
  sourceNumericValuesChanged: false,
  results,
}, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ baselineGeneration: supplementIndex.generation, cases: results.length, sources: sourceAnonymousIds.size, packages: nextPackages.length, outputRoot, intakeVersionsChanged: results.length }));
