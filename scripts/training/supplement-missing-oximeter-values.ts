/** Add explicit teaching-simulation SpO2 readings only where the verified runtime has no numeric result. */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { fixedTeachingOximeterResult } from '../../src/domain/exam-fixed-teaching';
import { teachingPackageSchema, type TeachingPackage } from '../../src/domain/teaching-package';
import { extractVitalSigns } from '../../src/domain/vital-signs';
import { teachingPackageVersion } from '../../src/lib/teaching-package-store';

const baselineValue = process.env.PEDIATRICS_TRAINING_BASELINE_ROOT;
const outputValue = process.env.PEDIATRICS_TRAINING_OUTPUT_ROOT;
if (!baselineValue || !outputValue) {
  throw new Error('Usage: PEDIATRICS_TRAINING_BASELINE_ROOT=<verified/runtime> PEDIATRICS_TRAINING_OUTPUT_ROOT=<new/runtime> tsx scripts/training/supplement-missing-oximeter-values.ts');
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
  const initialSpo2 = oldPackage.intake?.initialVitals.find(item => item.code === 'spo2')?.value ?? null;
  let changed = false;
  const exams = oldPackage.exams.map(exam => {
    if (exam.toolId !== 'oximeter' || exam.origin !== 'reference') return exam;
    const result = fixedTeachingOximeterResult(oldPackage.age);
    assert.ok(result, `OXIMETER_SCENARIO:${caseId}`);
    assert.equal(extractVitalSigns(exam.result).spo2, undefined, `REFERENCE_ALREADY_HAS_VALUE:${caseId}`);
    assert.equal(initialSpo2, null, `SOURCE_INTAKE_VALUE_WOULD_BE_REPLACED:${caseId}`);
    changed = true;
    return {
      ...exam,
      origin: 'teaching-simulation' as const,
      scope: 'local' as const,
      result,
      sourceLocator: '固定教学模拟：原资料无 SpO₂ 数值；非原患者新增实测；未医学审定',
    };
  });

  let nextPackage = oldPackage;
  let nextVersion = baselineVersion;
  if (changed) {
    const content = teachingPackageSchema.parse({ ...oldPackage, exams, version: 'pending' });
    nextVersion = teachingPackageVersion(content);
    assert.notEqual(nextVersion, baselineVersion, `VERSION_DID_NOT_CHANGE:${caseId}`);
    nextPackage = teachingPackageSchema.parse({ ...content, version: nextVersion });
    assert.equal(teachingPackageVersion(nextPackage), nextVersion, `PACKAGE_VERSION:${caseId}`);
    for (const key of ['intake', 'historyFacts', 'questions', 'tests', 'management', 'referenceNote', 'references', 'rubric'] as const) {
      assert.deepEqual(nextPackage[key], oldPackage[key], `UNRELATED_CONTENT_CHANGED:${caseId}:${key}`);
    }
    assert.deepEqual(
      nextPackage.exams.filter(item => !(item.toolId === 'oximeter' && item.origin === 'teaching-simulation')),
      oldPackage.exams.filter(item => !(item.toolId === 'oximeter' && item.origin === 'reference')),
      `OTHER_EXAMS_CHANGED:${caseId}`,
    );
  }
  const oximeter = nextPackage.exams.filter(item => item.toolId === 'oximeter');
  assert.equal(oximeter.length, 1, `OXIMETER_RULE_COUNT:${caseId}`);
  assert.ok(oximeter.some(item => extractVitalSigns(item.result).spo2 !== undefined), `NUMERIC_SPO2_REQUIRED:${caseId}`);
  packages.push(nextPackage);
  results.push({
    caseId,
    sourceId: oldPackage.sourceId,
    sourceVersion: oldPackage.sourceVersion,
    baselineTeachingVersion: baselineVersion,
    teachingVersion: nextVersion,
    initialSpo2,
    changed,
    oximeterOrigin: oximeter[0].origin,
    measuredSpo2: extractVitalSigns(oximeter[0].result).spo2,
    intakeUnchanged: true,
    rubricUnchanged: true,
  });
}

const changed = results.filter(item => item.changed === true);
assert.equal(changed.length, 20, 'EXPECTED_REFERENCE_SUPPLEMENT_COUNT');
assert.equal(results.filter(item => item.oximeterOrigin === 'source').length, 23, 'SOURCE_VALUE_COUNT');
assert.equal(results.filter(item => item.oximeterOrigin === 'teaching-simulation').length, 44, 'SIMULATED_VALUE_COUNT');
assert.equal(new Set(packages.map(item => item.version)).size, 67, 'PACKAGE_VERSIONS_UNIQUE');

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
writeFileSync(path.join(output, 'oximeter-supplement-report.json'), JSON.stringify({
  baselineGeneration: path.basename(path.dirname(baseline)),
  cases: results.length,
  changedCases: changed.length,
  sourceNumericValuesChanged: false,
  intakeChanged: false,
  rubricChanged: false,
  simulationDisclosure: '教学模拟测量，非原患者实测',
  results,
}, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ cases: results.length, changedCases: changed.length, sourceValues: 23, simulatedValues: 44, output, databaseWrites: false }));
