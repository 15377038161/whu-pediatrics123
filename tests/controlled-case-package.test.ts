import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  inspectControlledCasePackage,
  parseControlledCaseImportRequest,
  parseControlledCasePackageManifest,
  reconcileControlledCaseImport,
} from '@/lib/controlled-case-package';
import { getKnowledgeRoot } from '@/lib/teacher-case-data';
import type { ImportSummary } from '@/lib/teacher-case-import';

// knowledge/ 整体 gitignore，清单只由教师鉴权的快照恢复（POST /api/teacher/case-snapshot-archive）
// 按数据库双表重算后写盘，因此新检出/未跑过恢复的环境必然没有它。缺清单时跳过而不是判红：
// 指纹是「教师已核对的那个包」的凭据，本地重新生成会得到另一个包，不能冒充。
const manifestFile = path.join(getKnowledgeRoot(), 'case-package-manifest.json');
const skipReason = existsSync(manifestFile)
  ? false
  : 'knowledge/case-package-manifest.json 不存在：需先以教师身份运行受控快照恢复生成清单';

test('固定候选包：53 源病例、67 入口，全部通过哈希/schema/教学完整性校验', { skip: skipReason }, () => {
  const item = inspectControlledCasePackage();
  assert.equal(item.sourceCount, 53);
  assert.equal(item.entryCount, 67);
  assert.equal(item.aliasCount, 6);
  assert.equal(item.subtypeCount, 8);
  assert.equal(item.sourceCaseIds.length, 53);
  assert.equal(Object.keys(item.versions).length, 53);
  assert.match(item.fingerprint, /^[a-f0-9]{64}$/);
  for (const version of Object.values(item.versions)) assert.match(version, /^[a-f0-9]{16}$/);
});

test('manifest 边界：重复入口、来源错配和额外哈希路径均拒绝', { skip: skipReason }, () => {
  const raw = JSON.parse(readFileSync(path.join(getKnowledgeRoot(), 'case-package-manifest.json'), 'utf8')) as {
    entries: Array<Record<string, unknown>>;
    sha256: Record<string, string>;
  };
  assert.equal(parseControlledCasePackageManifest(raw).sourceCaseIds.length, 53);

  const duplicate = structuredClone(raw);
  duplicate.entries[1]!.entryId = duplicate.entries[0]!.entryId as string;
  assert.throws(() => parseControlledCasePackageManifest(duplicate), /CASE_PACKAGE_INVALID/);

  const wrongSource = structuredClone(raw);
  wrongSource.entries[0]!.sourceId = 'teacher-不存在的病例';
  assert.throws(() => parseControlledCasePackageManifest(wrongSource), /CASE_PACKAGE_INVALID/);

  const extraPath = structuredClone(raw);
  extraPath.sha256['../outside.json'] = 'a'.repeat(64);
  assert.throws(() => parseControlledCasePackageManifest(extraPath), /CASE_PACKAGE_INVALID/);
});

test('导入输入：只接受当前包指纹与包内病例 ID，拒绝空选择、未知 ID 和额外字段', { skip: skipReason }, () => {
  const item = inspectControlledCasePackage();
  assert.deepEqual(parseControlledCaseImportRequest({ packageFingerprint: item.fingerprint }, item), { only: undefined });
  const selected = item.sourceCaseIds[0]!;
  assert.deepEqual(parseControlledCaseImportRequest({ packageFingerprint: item.fingerprint, only: [selected] }, item), { only: [selected] });
  assert.throws(() => parseControlledCaseImportRequest({ packageFingerprint: '0'.repeat(64) }, item), /CASE_PACKAGE_CHANGED/);
  assert.throws(() => parseControlledCaseImportRequest({ packageFingerprint: item.fingerprint, only: [] }, item), /INVALID_REQUEST/);
  assert.throws(() => parseControlledCaseImportRequest({ packageFingerprint: item.fingerprint, only: ['teacher-不存在的病例'] }, item), /INVALID_REQUEST/);
  assert.throws(() => parseControlledCaseImportRequest({ packageFingerprint: item.fingerprint, filePath: '../outside.json' }, item), /INVALID_REQUEST/);
});

test('双表逐例回读：精确版本匹配；失败但双表已写入可恢复为已核对', () => {
  const summary: ImportSummary = {
    total: 5,
    imported: 1,
    unchanged: 1,
    skipped: 1,
    failed: 2,
    results: [
      { caseId: 'case-a', status: 'imported', version: 'v1' },
      { caseId: 'case-b', status: 'unchanged', version: 'v2' },
      { caseId: 'case-c', status: 'failed', version: 'v3' },
      { caseId: 'case-d', status: 'failed', version: 'v4' },
      { caseId: 'case-e', status: 'skipped_invalid_schema' },
    ],
  };
  const versions = { 'case-a': 'v1', 'case-b': 'v2', 'case-c': 'v3', 'case-d': 'v4', 'case-e': 'v5' };
  const result = reconcileControlledCaseImport(
    summary,
    versions,
    [{ case_id: 'case-a', version: 'v1' }, { case_id: 'case-b', version: 'v2' }, { case_id: 'case-d', version: 'v4' }, { case_id: 'case-e', version: 'old' }],
    [{ case_id: 'case-a', version: 'v1' }, { case_id: 'case-b', version: 'old' }, { case_id: 'case-d', version: 'v4' }],
  );
  assert.equal(result.total, 5);
  assert.equal(result.verified, 2);
  assert.equal(result.incomplete, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.cases.find((item) => item.caseId === 'case-d')?.status, 'verified');
  assert.equal(result.cases.find((item) => item.caseId === 'case-d')?.importStatus, 'failed');
  assert.equal(result.cases.find((item) => item.caseId === 'case-b')?.answersMatched, false);
  assert.equal(result.cases.find((item) => item.caseId === 'case-e')?.status, 'skipped');
});
