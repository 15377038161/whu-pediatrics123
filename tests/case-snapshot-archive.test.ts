import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {unzipSync,strFromU8} from 'fflate';
import { CASE_INDEX_NUMBER, TEACHER_CASE_CATALOG } from '../src/domain/teacher-case-catalog';
import { buildControlledCaseManifest, exportRestoredCaseSources, reconstructCaseSnapshot, restoreControlledCaseSources, VERIFIED_CURRENT_VERSIONS, type SnapshotAnswersRow, type SnapshotFactsRow } from '../src/lib/case-snapshot-archive';
import { computeCaseDataVersion } from '../src/lib/case-data-version';
import { parseControlledCasePackageManifest } from '../src/lib/controlled-case-package';
import { recordSchema } from '../src/lib/teacher-case-data';
import { syntheticTeacherCase } from './fixtures/teacher-case';

function sourceRecord(caseId: string) {
  const digest = createHash('sha256').update(`fixture:${caseId}`).digest('hex');
  return recordSchema.parse(syntheticTeacherCase({
    caseId,
    complaint: `合成主诉：${caseId}`,
    documents: [{ source: 'synthetic.txt', text: `合成原文：${caseId}`, sha256: digest }],
    testRelease: [{ testId: 'source-test-1', availableFromStage: 'tests', resultDelayNote: '合成延迟回报' }],
    testMedia: [],
    examMedia: [],
  }));
}

function rows(record: ReturnType<typeof sourceRecord>): { facts: SnapshotFactsRow; answers: SnapshotAnswersRow } {
  const version = computeCaseDataVersion(record);
  return {
    facts: {
      case_id: record.caseId,
      version,
      created_at: '2026-11-05T00:00:00.000Z',
      facts: {
        caseId: record.caseId,
        sourceName: record.sourceName,
        sourceDocument: record.sourceDocument,
        age: record.age,
        sex: record.sex,
        complaint: record.complaint,
        sections: { history: record.sections.history, exam: record.sections.exam, tests: record.sections.tests },
        vitals: record.vitals,
      },
    },
    answers: {
      case_id: record.caseId,
      version,
      created_at: '2026-11-05T00:00:00.000Z',
      diagnosis: record.sections.diagnosis,
      plan: record.sections.plan,
      documents: record.documents,
      binding_config: {
        testRelease: record.testRelease,
        testMedia: record.testMedia,
        examMedia: record.examMedia,
      },
    },
  };
}

test('快照重建逐字段还原记录，篡改事实即拒绝指纹', () => {
  const record = sourceRecord('teacher-川崎病');
  const { facts, answers } = rows(record);
  const rebuilt = reconstructCaseSnapshot(facts, answers);
  assert.deepEqual(rebuilt.record, record);
  assert.equal(rebuilt.version, computeCaseDataVersion(record));

  const tampered = { ...facts, facts: { ...(facts.facts as Record<string, unknown>), complaint: '被篡改的主诉' } };
  assert.throws(() => reconstructCaseSnapshot(tampered, answers), /CASE_SNAPSHOT_VERSION_MISMATCH/);
  assert.throws(() => reconstructCaseSnapshot({ ...facts, version: '0'.repeat(16) }, answers), /CASE_SNAPSHOT_VERSION_MISMATCH/);
});

test('53 份快照可重建固定包、版本档案与幂等清单', async () => {
  const previous = process.env.PEDIATRICS_KNOWLEDGE_ROOT;
  const prefix = path.join(os.tmpdir(), 'peds-snapshot-restore-');
  const root = mkdtempSync(prefix);
  process.env.PEDIATRICS_KNOWLEDGE_ROOT = root;
  try {
    const sources = TEACHER_CASE_CATALOG.filter((item) => item.folder);
    assert.equal(sources.length, 53);
    const snapshots = sources.map((item) => {
      const record = sourceRecord(item.id);
      return { record, version: computeCaseDataVersion(record), ...rows(record) };
    });
    const activeVersions = Object.fromEntries(
      snapshots
        .filter(({ record }) => VERIFIED_CURRENT_VERSIONS[record.caseId])
        .map(({ record, version }) => [record.caseId, version]),
    );

    const first = await restoreControlledCaseSources(
      snapshots.map((item) => item.facts),
      snapshots.map((item) => item.answers),
      { root, activeVersions, preferredVersions: activeVersions, now: new Date('2026-11-05T00:00:00.000Z') },
    );
    assert.equal(first.complete, true);
    assert.equal(first.snapshots.verified, 53);
    assert.equal(first.files.archiveWritten, 53);
    assert.equal(first.files.currentWritten, 53);
    assert.equal(first.cases.length, 53);
    assert.ok(first.package.fingerprint);

    const manifestRaw = readFileSync(path.join(root, 'case-package-manifest.json'), 'utf8');
    const manifest = parseControlledCasePackageManifest(JSON.parse(manifestRaw));
    assert.equal(manifest.sourceCaseIds.length, 53);
    assert.equal(Object.keys(manifest.hashes).length, 53);
    const rawManifest = JSON.parse(manifestRaw) as { entries: Array<{ seq: string; entryId: string }> };
    assert.equal(rawManifest.entries.length, 67);
    assert.ok(rawManifest.entries.every((entry) => entry.seq === String(CASE_INDEX_NUMBER[entry.entryId])));
    assert.equal(new Set(rawManifest.entries.map((entry) => entry.seq)).size, 67);

    const second = await restoreControlledCaseSources(
      snapshots.map((item) => item.facts),
      snapshots.map((item) => item.answers),
      { root, activeVersions, preferredVersions: activeVersions, now: new Date('2026-11-05T00:01:00.000Z') },
    );
    assert.equal(second.complete, true);
    assert.equal(second.files.currentWritten, 0);
    assert.equal(second.files.currentUnchanged, 53);
    assert.equal(second.files.archiveWritten, 0);
    assert.equal(second.package.fingerprint, first.package.fingerprint);
    const audits=readdirSync(path.join(root,'source-recovery-audits'));
    assert.equal(audits.length,2,'两次恢复的审计分别保留在私有根目录，不覆盖历史审计');
    for(const name of audits){
      const bytes=readFileSync(path.join(root,'source-recovery-audits',name));
      assert.equal(name,createHash('sha256').update(bytes).digest('hex')+'.json');
    }
    const exported=exportRestoredCaseSources(snapshots.map(item=>item.facts),snapshots.map(item=>item.answers),second);
    assert.equal(exported.sourceCount,53);assert.equal(exported.versionCount,53);
    assert.equal(exported.sha256,createHash('sha256').update(exported.bytes).digest('hex'));
    const exportedFiles=unzipSync(exported.bytes);
    assert.equal(Object.keys(exportedFiles).length,108);
    assert.ok(Object.keys(exportedFiles).every(name=>name==='case-package-manifest.json'||name==='source-export-manifest.json'||name.startsWith('teaching-cases/')||name.startsWith('teaching-case-versions/')));
    const exportedSource=recordSchema.parse(JSON.parse(strFromU8(exportedFiles[`teaching-cases/${sources[0].id}.json`])));
    assert.deepEqual(exportedSource,snapshots[0].record);
    const modified=snapshots.map(item=>item.facts);
    modified[0]={...modified[0],facts:{...(modified[0].facts as Record<string,unknown>),complaint:'篡改的合成主诉'}};
    assert.throws(()=>exportRestoredCaseSources(modified,snapshots.map(item=>item.answers),second),/VERSION_MISMATCH/);
    assert.throws(()=>exportRestoredCaseSources(snapshots.map(item=>item.facts),snapshots.map(item=>item.answers),{...second,complete:false}),/EXPORT_INCOMPLETE/);
    const preferred=snapshots.find(item=>item.record.caseId==='teacher-异物吸入性窒息')!;
    const newer=recordSchema.parse({...preferred.record,complaint:'合成新激活版本主诉'}),newRows=rows(newer);
    const selectedActive=await restoreControlledCaseSources([...snapshots.map(item=>item.facts),newRows.facts],[...snapshots.map(item=>item.answers),newRows.answers],{
      root:path.join(root,'active-version-check'),activeVersions:{...activeVersions,[newer.caseId]:newRows.facts.version},preferredVersions:{...activeVersions,[newer.caseId]:preferred.version},
    });
    assert.equal(selectedActive.complete,true);
    assert.equal(selectedActive.cases.find(item=>item.caseId===newer.caseId)?.currentVersion,newRows.facts.version,'已核验的真实激活版本优先于旧固定推荐版本');

    const hashes = new Map(sources.map((item) => {
      const raw = readFileSync(path.join(root, 'teaching-cases', `${item.id}.json`), 'utf8');
      return [item.id, createHash('sha256').update(raw).digest('hex')] as const;
    }));
    const rebuiltManifest = buildControlledCaseManifest(hashes);
    assert.deepEqual(rebuiltManifest, JSON.parse(manifestRaw));
  } finally {
    if (previous === undefined) delete process.env.PEDIATRICS_KNOWLEDGE_ROOT;
    else process.env.PEDIATRICS_KNOWLEDGE_ROOT = previous;
    if (!path.resolve(root).startsWith(path.resolve(prefix))) throw new Error('TEST_CLEANUP_PATH_INVALID');
    rmSync(root, { recursive: true, force: true });
  }
});
