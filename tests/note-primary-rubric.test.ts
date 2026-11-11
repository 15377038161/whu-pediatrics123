import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildNotePrimaryRubric } from '../src/domain/note-primary-rubric';
import { NOTE_PRIMARY_VERSION, NOTE_PRIMARY_WEIGHTS, PROCESS_PRIMARY_WEIGHTS, notePrimaryErrors } from '../src/domain/note-primary-contract';
import { teachingPackageSchema, type TeachingPackage } from '../src/domain/teaching-package';
import { buildTeachingFeedback } from '../src/domain/teaching-score';
import { createInitialSession } from '../src/lib/agent-engine';

const runtime = path.join(process.cwd(), 'knowledge/training-generations/a9f300e1c12d531d22d8/runtime');
const index = JSON.parse(readFileSync(path.join(runtime, 'index.json'), 'utf8')) as { entries: Record<string, string> };
function load(caseId: string): TeachingPackage {
  return teachingPackageSchema.parse(JSON.parse(readFileSync(path.join(runtime, 'packages', `${index.entries[caseId]}.json`), 'utf8')));
}
function upgraded(caseId: string): TeachingPackage {
  const pack = load(caseId);
  return teachingPackageSchema.parse({ ...pack, rubric: buildNotePrimaryRubric(pack), rubricVersion: NOTE_PRIMARY_VERSION });
}
const sum = (items: TeachingPackage['rubric'], predicate: (item: TeachingPackage['rubric'][number]) => boolean) =>
  Math.round(items.filter(predicate).reduce((total, item) => total + item.maxScore, 0) * 1000) / 1000;

test('三例评分点保留本例临床内容，且满足病历60、过程40、基础80、提高20', () => {
  const acute = upgraded('teacher-急性喉炎');
  const dka = upgraded('teacher-1型糖尿病伴有酮症酸中毒');
  const newborn = upgraded('teacher-新生儿肺炎');
  for (const pack of [acute, dka, newborn]) {
    assert.deepEqual(notePrimaryErrors(pack.rubric), []);
    assert.equal(sum(pack.rubric, () => true), 100);
    assert.equal(sum(pack.rubric, item => item.section === 'note'), 60);
    assert.equal(sum(pack.rubric, item => item.section !== 'note'), 40);
    assert.equal(sum(pack.rubric, item => item.level === 'basic'), 80);
    assert.equal(sum(pack.rubric, item => item.level === 'advanced'), 20);
    assert.equal(sum(pack.rubric, item => item.section === 'diagnosis'), 0);
    assert.equal(sum(pack.rubric, item => item.reportSection === 'diagnosis'), 15);
    assert.equal(sum(pack.rubric, item => item.noteComponent === 'diagnosis'), 5);
    assert.equal(sum(pack.rubric, item => item.noteComponent === 'basis'), 5);
    assert.deepEqual([...new Set(pack.rubric.map(item => item.reportSection ?? item.section))].sort(), ['communication', 'diagnosis', 'exam', 'history', 'note', 'plan', 'tests'].sort());
    assert.equal(new Set(pack.rubric.map(item => item.id)).size, pack.rubric.length);
    for (const [section, weights] of Object.entries(NOTE_PRIMARY_WEIGHTS)) {
      for (const [index, level] of ['basic', 'advanced'].entries()) {
        assert.equal(sum(pack.rubric, item => item.section === 'note' && item.noteSection === section && item.level === level), weights[index]);
      }
    }
    for (const [section, weights] of Object.entries(PROCESS_PRIMARY_WEIGHTS)) {
      for (const [index, level] of ['basic', 'advanced'].entries()) {
        assert.equal(sum(pack.rubric, item => item.section === section && item.level === level), weights[index]);
      }
    }
  }
  assert.match(acute.rubric.map(item => item.fullAnswer).join('；'), /喉炎|喉鸣|犬吠/);
  const dkaText = JSON.stringify(dka.rubric);
  assert.match(dkaText, /胰岛素/);
  assert.match(dkaText, /血钾/);
  assert.match(dkaText, /静脉推注胰岛素/);
  assert.match(newborn.rubric.map(item => item.fullAnswer).join('；'), /新生儿|呼吸|抗感染/);
  assert.notDeepEqual(acute.rubric.map(item => [item.id, item.fullAnswer]), dka.rubric.map(item => [item.id, item.fullAnswer]));
});

test('过程评分保留原操作证据码，最终病历评分只读对应段落', () => {
  const original = load('teacher-1型糖尿病伴有酮症酸中毒');
  const pack = upgraded('teacher-1型糖尿病伴有酮症酸中毒');
  for (const section of ['history', 'exam', 'tests', 'plan'] as const) {
    const expected = original.rubric.filter(item => item.section === section).flatMap(item => item.evidenceCodes).sort();
    const actual = pack.rubric.filter(item => item.section === section).flatMap(item => item.evidenceCodes).sort();
    assert.deepEqual(actual, expected);
  }
  assert.ok(pack.rubric.filter(item => item.section === 'note').every(item => item.evidenceCodes.length === 0));

  const session = createInitialSession('rubric-fixture', 'guided', pack.caseId);
  const noteSections = {
    chiefComplaint: '', presentIllness: '', pastHistory: '', personalHistory: '', familyHistory: '',
    physicalExam: '', auxiliaryTests: '', preliminaryDiagnosis: '', differentialDiagnosis: '',
    treatmentPlan: '静脉补液，监测血钾并按结果补钾，静脉持续使用胰岛素，密切复评意识变化，必要时升级监护。',
  };
  const feedback = buildTeachingFeedback(session, pack, undefined, noteSections);
  assert.equal(feedback.rubricVersion, NOTE_PRIMARY_VERSION);
  assert.ok(feedback.items.some(item => item.noteSection === 'treatmentPlan' && item.score > 0));
  assert.ok(feedback.items.filter(item => item.section === 'note' && item.noteSection !== 'treatmentPlan').every(item => item.score === 0));
  assert.equal(feedback.noteProcessBreakdown?.noteMax, 60, JSON.stringify(feedback.items.filter(item => item.section === 'note' && item.status === 'not_assessable').map(item => ({ id: item.id, label: item.label, explanation: item.explanation }))));
  assert.equal(feedback.noteProcessBreakdown?.processMax, 38);
  assert.deepEqual(feedback.items.filter(item => item.section !== 'note' && item.status === 'not_assessable').map(item => item.id), ['exam-interpret']);
});
