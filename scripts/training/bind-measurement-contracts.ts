import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { teachingExamApplicabilitySchema, teachingPackageSchema, type TeachingExam, type TeachingPackage } from '../../src/domain/teaching-package';
import { fixedStructuredMeasurementSchema, measurementContractSchema, type FixedStructuredMeasurement, type MeasurementIndicator } from '../../src/domain/structured-measurement';
import { teachingPackageVersion } from '../../src/lib/teaching-package-store';

const authorValue = process.env.PEDIATRICS_TRAINING_AUTHOR_ROOT;
const baselineValue = process.env.PEDIATRICS_TRAINING_BASELINE_ROOT;
const outputValue = process.env.PEDIATRICS_TRAINING_OUTPUT_ROOT;
if (!authorValue || !baselineValue || !outputValue) throw new Error('Usage: PEDIATRICS_TRAINING_AUTHOR_ROOT=<merged> PEDIATRICS_TRAINING_BASELINE_ROOT=<verified/runtime> PEDIATRICS_TRAINING_OUTPUT_ROOT=<new-staging/runtime> tsx scripts/training/bind-measurement-contracts.ts');
const authorRoot = path.resolve(authorValue), baseline = path.resolve(baselineValue), output = path.resolve(outputValue);
if (output === baseline || output.startsWith(`${baseline}${path.sep}`) || existsSync(output)) throw new Error('OUTPUT_MUST_BE_NEW_AND_OUTSIDE_BASELINE');

const authorIndex = z.array(z.object({ caseId: z.string(), folder: z.string(), teachingVersion: z.string() }).passthrough()).parse(JSON.parse(readFileSync(path.join(authorRoot, 'index.json'), 'utf8')));
const baselineIndex = z.object({ schemaVersion: z.literal(1), entries: z.record(z.string(), z.string().regex(/^[a-f0-9]{20}$/)) }).strict().parse(JSON.parse(readFileSync(path.join(baseline, 'index.json'), 'utf8')));
assert.equal(authorIndex.length, 67, 'AUTHOR_CASE_COUNT');
assert.equal(Object.keys(baselineIndex.entries).length, 67, 'BASELINE_CASE_COUNT');

type LooseRecord = Record<string, unknown>;
const object = (value: unknown): LooseRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as LooseRecord : {};
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const finite = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim()) : [];

function candidateFrom(rawValue: unknown, indicator: MeasurementIndicator, exam?: TeachingExam): FixedStructuredMeasurement | null {
  const raw = object(rawValue);
  const legacy = exam?.measurements?.find(item => item.metric === indicator);
  const toolId = text(raw.toolId) ?? exam?.toolId;
  const bodyPartId = text(raw.bodyPartId) ?? exam?.bodyPartId;
  const origin = text(raw.origin) ?? legacy?.origin ?? (exam?.origin === 'reference' ? undefined : exam?.origin);
  const method = text(raw.method) ?? legacy?.method ?? exam?.label;
  const timepoint = text(raw.timepoint) ?? legacy?.sourceTimepoint ?? '本轮固定教学查体';
  const sourceLocator = text(raw.sourceLocator) ?? legacy?.sourceLocator ?? exam?.sourceLocator;
  if (!toolId || !bodyPartId || !origin || !method || !timepoint || !sourceLocator) return null;
  const parsed = fixedStructuredMeasurementSchema.safeParse({
    indicator,
    ...(finite(raw.value) !== undefined ? { value: finite(raw.value) } : {}),
    ...(finite(raw.systolic) !== undefined ? { systolic: finite(raw.systolic) } : {}),
    ...(finite(raw.diastolic) !== undefined ? { diastolic: finite(raw.diastolic) } : {}),
    unit: text(raw.unit), toolId, bodyPartId, method, timepoint, origin, sourceLocator,
    preconditions: strings(raw.preconditions),
    availableFromStage: text(raw.availableFromStage) === 'triage' ? 'triage' : 'exam',
    ...(text(raw.currentCaseCondition) ? { currentCaseCondition: text(raw.currentCaseCondition) } : {}),
    ...(text(raw.phaseId) ? { phaseId: text(raw.phaseId) } : {}),
  });
  return parsed.success ? parsed.data : null;
}

const packages: TeachingPackage[] = [];
const results: Array<Record<string, unknown>> = [];
for (const entry of authorIndex) {
  const baselineVersion = baselineIndex.entries[entry.caseId];
  assert.equal(baselineVersion, entry.teachingVersion, `AUTHOR_BASELINE_BINDING:${entry.caseId}`);
  const oldRaw = JSON.parse(readFileSync(path.join(baseline, 'packages', `${baselineVersion}.json`), 'utf8')) as TeachingPackage;
  assert.equal(teachingPackageVersion(oldRaw), baselineVersion, `BASELINE_RAW_VERSION:${entry.caseId}`);
  const oldPackage = teachingPackageSchema.parse(oldRaw);
  assert.equal(oldPackage.caseId, entry.caseId);
  const source = JSON.parse(readFileSync(path.join(authorRoot, entry.folder, '病例数据.json'), 'utf8')) as LooseRecord;
  const physical = object(object(source.sections).physicalExam);
  const authoringRows = Array.isArray(physical.authoringRows) ? physical.authoringRows.map(object) : [];
  const authorById = new Map(authoringRows.map(row => [text(row.id), row]));
  const fixedParameters = z.record(z.string(), z.record(z.string(), z.unknown())).parse(physical.fixedExamParameters ?? {});
  const exams = oldPackage.exams.map(exam => ({
    ...exam,
    applicability: teachingExamApplicabilitySchema.parse(authorById.get(exam.id)?.applicability),
    ...(fixedParameters[exam.id] ? { fixedParameters: fixedParameters[exam.id] } : {}),
  }));
  const examByPair = new Map(exams.map(exam => [`${exam.toolId}:${exam.bodyPartId}`, exam]));
  const contracts = (Array.isArray(physical.measurementReleaseContract) ? physical.measurementReleaseContract : []).map(rowValue => {
    const row = object(rowValue), indicator = text(row.indicator) as MeasurementIndicator;
    const fixedRecords = Array.isArray(row.fixedMeasurementRecords) ? row.fixedMeasurementRecords : [];
    const proposed = row.proposedMeasurement ?? row.measurement;
    const rawCandidates = fixedRecords.length ? fixedRecords : proposed ? [proposed] : [];
    let candidates = rawCandidates.map(raw => {
      const candidate = object(raw), pair = `${text(candidate.toolId)}:${text(candidate.bodyPartId)}`;
      return candidateFrom(raw, indicator, examByPair.get(pair));
    }).filter((item): item is FixedStructuredMeasurement => Boolean(item));
    // Heart/respiratory contracts may carry only the indicator while the previous verified
    // package already has the exact structured exam. Reuse that pairing, never parse prose.
    if (!candidates.length && row.readyForActivation === true && !fixedRecords.length) {
      const compatible = exams.filter(exam => exam.measurements?.some(item => item.metric === indicator));
      const proposedObject = object(proposed);
      const proposedHasReading = finite(proposedObject.value) !== undefined || finite(proposedObject.systolic) !== undefined;
      if (proposedHasReading && compatible.length === 1) {
        const merged = candidateFrom(proposed, indicator, compatible[0]);
        if (merged) candidates = [merged];
      } else if (!proposedHasReading) {
        candidates = compatible.map(exam => candidateFrom({ indicator, unit: exam.measurements?.find(item => item.metric === indicator)?.unit }, indicator, exam))
          .filter((item): item is FixedStructuredMeasurement => Boolean(item));
      }
    }
    return measurementContractSchema.parse({
      indicator,
      status: text(object(row.applicability).status) ?? 'unspecified',
      ...(text(object(row.applicability).reason) ? { reason: text(object(row.applicability).reason) } : {}),
      readyForActivation: row.readyForActivation === true,
      releaseStage: text(row.releaseStage) === 'triage' ? 'triage' : 'exam',
      syncTarget: text(row.syncTarget) ?? indicator,
      candidates,
    });
  });
  for (const contract of contracts) for (const candidate of contract.candidates) {
    assert.ok(examByPair.has(`${candidate.toolId}:${candidate.bodyPartId}`), `MEASUREMENT_WITHOUT_EXAM:${entry.caseId}:${contract.indicator}`);
  }
  const content = teachingPackageSchema.parse({ ...oldPackage, exams, measurementContracts: contracts, version: 'pending' });
  const nextVersion = teachingPackageVersion(content);
  assert.notEqual(nextVersion, baselineVersion, `VERSION_DID_NOT_CHANGE:${entry.caseId}`);
  const nextPackage = teachingPackageSchema.parse({ ...content, version: nextVersion });
  assert.equal(teachingPackageVersion(nextPackage), nextVersion);
  for (const key of ['intake', 'historyFacts', 'questions', 'tests', 'management', 'referenceNote', 'references', 'rubric'] as const) {
    assert.deepEqual(nextPackage[key], oldPackage[key], `UNRELATED_CONTENT_CHANGED:${entry.caseId}:${key}`);
  }
  packages.push(nextPackage);
  results.push({
    caseId: entry.caseId, baselineTeachingVersion: baselineVersion, teachingVersion: nextVersion,
    fixedExamParameters: Object.keys(fixedParameters).length,
    contracts: contracts.map(contract => ({ indicator: contract.indicator, status: contract.status, readyForActivation: contract.readyForActivation, candidates: contract.candidates.length })),
    structuredCandidates: contracts.reduce((sum, contract) => sum + contract.candidates.length, 0),
  });
}
assert.equal(new Set(packages.map(item => item.version)).size, 67, 'PACKAGE_VERSIONS_UNIQUE');
mkdirSync(path.join(output, 'packages'), { recursive: true });
const nextEntries: Record<string, string> = {};
for (const pack of packages) {
  nextEntries[pack.caseId] = pack.version;
  writeFileSync(path.join(output, 'packages', `${pack.version}.json`), JSON.stringify(pack, null, 2), { flag: 'wx' });
}
const nextIndex = JSON.stringify({ schemaVersion: 1, entries: nextEntries }, null, 2);
writeFileSync(path.join(output, 'index.json'), nextIndex, { flag: 'wx' });
const mediaRoot = path.join(baseline, 'media');
if (existsSync(mediaRoot)) cpSync(mediaRoot, path.join(output, 'media'), { recursive: true, force: false, errorOnExist: true });
const generation = createHash('sha256').update(nextIndex).digest('hex').slice(0, 20);
const stagingRoot = path.dirname(output), generationRoot = path.join(path.dirname(stagingRoot), generation);
if (existsSync(generationRoot)) throw new Error('GENERATION_ALREADY_EXISTS');
renameSync(stagingRoot, generationRoot);
const report = {
  schemaVersion: 1, generation, baselineGeneration: path.basename(path.dirname(baseline)), cases: 67,
  fixedExamParameters: results.reduce((sum, item) => sum + (item.fixedExamParameters as number), 0),
  contracts: results.reduce((sum, item) => sum + (item.contracts as unknown[]).length, 0),
  structuredCandidates: results.reduce((sum, item) => sum + (item.structuredCandidates as number), 0),
  runtimeTextExtraction: false, databaseWrites: false, results,
};
writeFileSync(path.join(generationRoot, 'measurement-contract-report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ generation, cases: 67, fixedExamParameters: report.fixedExamParameters, contracts: report.contracts, structuredCandidates: report.structuredCandidates, output: path.join(generationRoot, 'runtime'), databaseWrites: false }));
