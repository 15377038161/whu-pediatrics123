import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { computeCaseContentHash, computeCaseDataVersion } from '@/lib/case-data-version';
import { computeImportVersion, getLocalImportVersion } from '@/lib/teacher-case-import';
import { readTeacherCaseData, recordSchema } from '@/lib/teacher-case-data';

const fixture = recordSchema.parse(JSON.parse(readFileSync(path.resolve('tests/fixtures/knowledge/teaching-cases/teacher-肾病综合征.json'), 'utf8')));

test('同一原件不变时，处置、诊断、生命体征和身份等固定事实修订必须换版', () => {
  const originalVersion = computeCaseDataVersion(fixture);
  const edits = [
    { ...fixture, age: '7岁' },
    { ...fixture, sex: '女' },
    { ...fixture, complaint: '测试主诉变化' },
    { ...fixture, sections: { ...fixture.sections, history: '测试病史变化' } },
    { ...fixture, sections: { ...fixture.sections, plan: '测试处置段修订，原件未变' } },
    { ...fixture, sections: { ...fixture.sections, diagnosis: '测试诊断变化' } },
    { ...fixture, sections: { ...fixture.sections, tests: '测试检查变化' } },
    { ...fixture, sections: { ...fixture.sections, exam: '测试查体变化' } },
    { ...fixture, vitals: { ...fixture.vitals, spo2: 99 } },
  ];
  for (const edited of edits) {
    assert.deepEqual(edited.documents, fixture.documents, '本回归不得靠更改原件哈希来制造新版本');
    assert.notEqual(computeCaseDataVersion(edited), originalVersion);
  }
});

test('内容指纹稳定于对象属性顺序、CRLF和审核元数据，但原文内容、顺序、媒体绑定均有影响', () => {
  const original = computeCaseDataVersion(fixture);
  const reordered = { ...fixture, sections: { plan: fixture.sections.plan, diagnosis: fixture.sections.diagnosis, tests: fixture.sections.tests, exam: fixture.sections.exam, history: fixture.sections.history } };
  assert.equal(computeCaseDataVersion(reordered), original);
  assert.equal(computeCaseDataVersion({ ...fixture, reviewNote: '仅审核备注' } as typeof fixture), original);
  const textWithLf = { ...fixture, sections: { ...fixture.sections, plan: '测试一\n测试二' } };
  assert.equal(computeCaseDataVersion(textWithLf), computeCaseDataVersion({ ...textWithLf, sections: { ...textWithLf.sections, plan: '测试一\r\n测试二' } }));
  assert.notEqual(computeCaseDataVersion({ ...fixture, documents: fixture.documents.map(d => ({ ...d, text: d.text + '测试修订' })) }), original);
  const withTwoDocs = { ...fixture, documents: [...fixture.documents, { source: 'test-2', text: '合成附录', sha256: 'synthetic-2' }] };
  assert.notEqual(computeCaseDataVersion(withTwoDocs), computeCaseDataVersion({ ...withTwoDocs, documents: [...withTwoDocs.documents].reverse() }));
  assert.notEqual(computeCaseDataVersion(fixture, [{ url: 'https://example.invalid/one', caption: '教学示例' }]), original);
  assert.match(original, /^[0-9a-f]{16}$/);
  assert.match(computeCaseContentHash(fixture), /^[0-9a-f]{64}$/);
  assert.equal(computeImportVersion(fixture), original);
});

test('真实本地读取/导入/绑定共用v2指纹，旧字段或旧原件指纹不能读取修改后的本地患者', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'case-content-version-'));
  const previousRoot = process.env.PEDIATRICS_KNOWLEDGE_ROOT;
  try {
    mkdirSync(path.join(directory, 'teaching-cases'));
    const file = path.join(directory, 'teaching-cases', `${fixture.caseId}.json`);
    process.env.PEDIATRICS_KNOWLEDGE_ROOT = directory;
    writeFileSync(file, JSON.stringify(fixture));
    const version1 = getLocalImportVersion(fixture.caseId)!;
    assert.equal(version1, computeImportVersion(fixture));
    assert.equal(readTeacherCaseData(fixture.caseId, version1)?.sections.plan, fixture.sections.plan);
    const revised = { ...fixture, sections: { ...fixture.sections, plan: '合成测试的新处置' } };
    writeFileSync(file, JSON.stringify(revised));
    const version2 = getLocalImportVersion(fixture.caseId)!;
    assert.notEqual(version2, version1);
    assert.equal(readTeacherCaseData(fixture.caseId, version1), null, '旧绑定不得漂移到新内容');
    const legacy = createHash('sha256').update(fixture.documents.map(d => d.sha256).sort().join('\n')).digest('hex').slice(0, 16);
    assert.equal(readTeacherCaseData(fixture.caseId, legacy), null, '旧原件指纹不能被当作当前事实同版');
    assert.equal(readTeacherCaseData(fixture.caseId, version2)?.sections.plan, revised.sections.plan);
  } finally {
    if (previousRoot === undefined) delete process.env.PEDIATRICS_KNOWLEDGE_ROOT;
    else process.env.PEDIATRICS_KNOWLEDGE_ROOT = previousRoot;
    rmSync(directory, { recursive: true, force: true });
  }
});


test('检查/查体媒体绑定和释放时点变动必须换版，不能让旧会话静默换图或提前释放', () => {
  const bound = recordSchema.parse({ ...fixture,
    testMedia: [{ testId: 'source-test-0', media: [{ fileId: 'synthetic-image-a', kind: 'image', caption: '教学示意' }] }],
    examMedia: [{ examId: 'source-exam-test', media: [{ fileId: 'synthetic-exam-a', kind: 'image', caption: '教学示意' }] }],
    testRelease: [{ testId: 'source-test-0', availableFromStage: 'tests', resultDelayNote: '合成延迟说明' }],
  });
  const edits = [
    { ...bound, testMedia: [{ ...bound.testMedia![0], testId: 'source-test-1' }] },
    { ...bound, testMedia: [{ ...bound.testMedia![0], media: [{ ...bound.testMedia![0].media[0], fileId: 'synthetic-image-b' }] }] },
    { ...bound, testMedia: [{ ...bound.testMedia![0], media: [{ ...bound.testMedia![0].media[0], caption: '修订教学示意' }] }] },
    { ...bound, examMedia: [{ ...bound.examMedia![0], examId: 'source-exam-other' }] },
    { ...bound, examMedia: [{ ...bound.examMedia![0], media: [{ ...bound.examMedia![0].media[0], fileId: 'synthetic-exam-b' }] }] },
    { ...bound, testRelease: [{ ...bound.testRelease![0], availableFromStage: 'report' as const }] },
    { ...bound, testRelease: [{ ...bound.testRelease![0], resultDelayNote: '不同合成延迟说明' }] },
    { ...bound, testMedia: [] },
  ];
  for (const edited of edits) {
    assert.deepEqual(edited.documents, bound.documents);
    assert.notEqual(computeCaseDataVersion(edited), computeCaseDataVersion(bound));
  }
});

test('媒体版本贯穿本地读取/导入与绑定，旧版本不读取修订绑定', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'case-media-version-'));
  const previousRoot = process.env.PEDIATRICS_KNOWLEDGE_ROOT;
  try {
    mkdirSync(path.join(directory, 'teaching-cases'));
    const file = path.join(directory, 'teaching-cases', `${fixture.caseId}.json`);
    process.env.PEDIATRICS_KNOWLEDGE_ROOT = directory;
    const original = recordSchema.parse({ ...fixture, testMedia: [{ testId: 'source-test-0', media: [{ fileId: 'synthetic-old', kind: 'image', caption: '教学示意' }] }] });
    writeFileSync(file, JSON.stringify(original));
    const oldVersion = getLocalImportVersion(fixture.caseId)!;
    const revised = { ...original, testMedia: [{ testId: 'source-test-0', media: [{ fileId: 'synthetic-new', kind: 'image' as const, caption: '教学示意' }] }] };
    writeFileSync(file, JSON.stringify(revised));
    const newVersion = getLocalImportVersion(fixture.caseId)!;
    assert.notEqual(newVersion, oldVersion);
    assert.equal(newVersion, computeImportVersion(revised));
    assert.equal(readTeacherCaseData(fixture.caseId, oldVersion), null);
    assert.equal(readTeacherCaseData(fixture.caseId, newVersion)?.testMedia?.[0].media[0].fileId, 'synthetic-new');
  } finally {
    if (previousRoot === undefined) delete process.env.PEDIATRICS_KNOWLEDGE_ROOT;
    else process.env.PEDIATRICS_KNOWLEDGE_ROOT = previousRoot;
    rmSync(directory, { recursive: true, force: true });
  }
});
