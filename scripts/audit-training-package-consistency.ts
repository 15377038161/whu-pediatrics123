import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ANATOMY_REGIONS, EXAM_INSTRUMENTS } from '../src/domain/exam-anatomy';
import { sourceEncounterContext } from '../src/domain/encounter-time';
import { teachingPackageSchema, type TeachingPackage } from '../src/domain/teaching-package';
import type { SessionState } from '../src/domain/agent';
import { contextualHistorySelection } from '../src/lib/history-dialogue';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const root = path.resolve(argument('--root') ?? process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT ?? path.join(process.cwd(), 'knowledge', 'training-packages'));
const output = argument('--output');
const index = JSON.parse(readFileSync(path.join(root, 'index.json'), 'utf8')) as { entries: Record<string, string> };
const siteIds = new Set(ANATOMY_REGIONS.flatMap((region) => region.sites.map((site) => site.id)));
const toolIds = new Set(EXAM_INSTRUMENTS.map((tool) => tool.id));

function packageVersion(pack: TeachingPackage): string {
  const { version: _version, ...content } = pack;
  void _version;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 20);
}

function factSections(pack: TeachingPackage): Map<string, string> {
  const result = new Map<string, string>();
  let section = '现病史';
  for (const fact of pack.historyFacts) {
    const heading = fact.text.match(/^【([^】]+)】$/)?.[1]
      ?? fact.text.match(/^(既往史|个人史|家族史|现病史)[：:]?$/)?.[1];
    if (heading) section = heading;
    result.set(fact.id, section);
  }
  return result;
}

const rows = Object.entries(index.entries).map(([caseId, selectedVersion]) => {
  const file = path.join(root, 'packages', `${selectedVersion}.json`);
  const pack = teachingPackageSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (pack.caseId !== caseId || pack.version !== selectedVersion) throw new Error(`PACKAGE_IDENTITY_MISMATCH:${caseId}`);
  const facts = new Map(pack.historyFacts.map((fact) => [fact.id, fact]));
  const sections = factSections(pack);
  const encounter = sourceEncounterContext(pack.historyFacts.map((fact) => fact.text).join('\n'), pack.age);
  const runtimeFacts: TeachingPackage['historyFacts'] = [...pack.historyFacts, {
    id: 'SOURCE_HX_-2', text: pack.complaint, topics: ['主要不适'], sourceLocator: 'complaint', origin: 'source', actor: 'mixed',
  }];
  const auditSession = { messages: [], dialogueMemory: null } as unknown as SessionState;
  const timeConflicts = pack.questions.filter((question) => question.topic === '起病与病程').flatMap((question) => {
    const selectedIds = new Set(contextualHistorySelection(auditSession, question.prompt, runtimeFacts, pack.questions).facts.map((fact) => fact.id));
    return question.factIds.filter((id) => /既往史|个人史|家族史/.test(sections.get(id) ?? '')).map((factId) => ({
      question: question.prompt,
      factId,
      section: sections.get(factId),
      runtimeFiltered: !selectedIds.has(factId),
      disposition: selectedIds.has(factId) ? '仍需修复运行时检索' : '运行时按当前问题过滤，原件保留',
    }));
  });
  const pastDateFactIds = pack.historyFacts.filter((fact) => /20\d{2}[-.年]/.test(fact.text) && sections.get(fact.id) !== '现病史').map((fact) => fact.id);
  const mappingErrors: string[] = [];
  const seenExamKeys = new Map<string, string[]>();
  for (const exam of pack.exams) {
    if (!toolIds.has(exam.toolId)) mappingErrors.push(`未知器材:${exam.id}:${exam.toolId}`);
    if (!siteIds.has(exam.bodyPartId)) mappingErrors.push(`未知部位:${exam.id}:${exam.bodyPartId}`);
    const key = `${exam.toolId}×${exam.bodyPartId}`;
    seenExamKeys.set(key, [...seenExamKeys.get(key) ?? [], exam.id]);
  }
  const duplicateExamKeys = [...seenExamKeys.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
  const missingQuestionFactIds = pack.questions.flatMap((question) => question.factIds.filter((id) => !facts.has(id)).map((id) => ({ topic: question.topic, factId: id })));
  return {
    caseId,
    sourceVersion: pack.sourceVersion,
    packageVersion: pack.version,
    versionHashValid: packageVersion(pack) === pack.version,
    ageAtEncounter: pack.age,
    encounterTime: encounter?.time ?? null,
    timeStatus: encounter ? (timeConflicts.length ? 'runtime_filtered' : 'verified') : 'encounter_unverified',
    timeConflicts,
    pastDateFactIds,
    examCount: pack.exams.length,
    inspectionScalp: pack.exams.some((exam) => exam.toolId === 'inspection' && exam.bodyPartId === 'scalp'),
    mappingErrors,
    duplicateExamKeys,
    missingQuestionFactIds,
    examStatus: mappingErrors.length ? 'error' : duplicateExamKeys.length ? 'review' : 'verified',
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  root,
  total: rows.length,
  summary: {
    expected67: rows.length === 67,
    versionHashValid: rows.filter((row) => row.versionHashValid).length,
    encounterVerified: rows.filter((row) => row.encounterTime).length,
    encounterUnverified: rows.filter((row) => !row.encounterTime).length,
    runtimeFilteredTimeConflicts: rows.filter((row) => row.timeConflicts.length && row.timeConflicts.every((conflict) => conflict.runtimeFiltered)).length,
    runtimeFilterFailures: rows.reduce((sum, row) => sum + row.timeConflicts.filter((conflict) => !conflict.runtimeFiltered).length, 0),
    examVerified: rows.filter((row) => row.examStatus === 'verified').length,
    examReview: rows.filter((row) => row.examStatus === 'review').length,
    examErrors: rows.filter((row) => row.examStatus === 'error').length,
    inspectionScalp: rows.filter((row) => row.inspectionScalp).length,
    missingQuestionFactReferences: rows.reduce((sum, row) => sum + row.missingQuestionFactIds.length, 0),
  },
  rows,
};
if (output) {
  const destination = path.resolve(output);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ ...report.summary, output: output ? path.resolve(output) : null }, null, 2));
if (rows.some((row) => !row.versionHashValid || row.examStatus === 'error' || row.timeConflicts.some((conflict) => !conflict.runtimeFiltered))) process.exitCode = 1;
