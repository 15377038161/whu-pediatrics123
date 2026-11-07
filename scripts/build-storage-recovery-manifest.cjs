/* eslint-disable no-console, @typescript-eslint/no-require-imports */
/**
 * 将既有只读对象存储审计与 Git pickaxe 证据汇总为：
 * 1. 42 个非 pilot ZIP 的分类矩阵；
 * 2. 仅含“Git 历史零引用且缺完整独立同路径备份”的本机下载清单；
 * 3. 可在本机直接使用的 SHA256SUMS。
 *
 * 本脚本只读取本地 JSON，不访问网络、不读取或修改对象存储、不输出签名 URL。
 */
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const auditRoot = process.argv[2] ? path.resolve(process.argv[2]) : '';
const gitEvidencePath = process.argv[3] ? path.resolve(process.argv[3]) : '';
const outputRoot = process.argv[4] ? path.resolve(process.argv[4]) : '';
const expectedOutputRoot = path.resolve('artifacts/model-acceptance');
if (!auditRoot || !gitEvidencePath || outputRoot !== expectedOutputRoot) {
  throw new Error('用法: node scripts/build-storage-recovery-manifest.cjs <audit-root> <git-evidence.json> artifacts/model-acceptance');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function byFileName(items, label) {
  const map = new Map(items.map((item) => [item.fileName, item]));
  assert(map.size === items.length, `${label} 存在重复文件名`);
  return map;
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))];
  writeFileSync(filePath, `${lines.join('\n')}\n`, { mode: 0o600 });
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function compareNames(a, b) {
  const aPart = /^peds-private122-part(\d{3})\.zip$/.exec(a.fileName);
  const bPart = /^peds-private122-part(\d{3})\.zip$/.exec(b.fileName);
  if (aPart && bPart) return Number(aPart[1]) - Number(bPart[1]);
  if (aPart) return 1;
  if (bPart) return -1;
  return a.fileName.localeCompare(b.fileName, 'en');
}

const inventoryDocument = readJson(path.join(auditRoot, 'inventory.json'));
const inventory = inventoryDocument.files.filter((item) => item.fileName.toLowerCase().endsWith('.zip'));
assert(inventory.length === 43, `ZIP 总数异常：预期 43，实际 ${inventory.length}`);
const inventoryByName = byFileName(inventory, '对象清单');

const duplicateDocument = readJson(path.join(auditRoot, 'duplicate-summary.json'));
const standaloneDocument = readJson(path.join(auditRoot, 'standalone-content-backup-summary.json'));
const controlDocument = readJson(path.join(auditRoot, 'control-coverage.json'));
const duplicateByName = byFileName(duplicateDocument.summaries, '重复内容汇总');
const standaloneByName = byFileName(standaloneDocument.summaries, '独立备份汇总');
const controlByName = byFileName(controlDocument.checks, '恢复集合控制清单');
assert(controlDocument.checks.length === 35, '恢复集合控制清单必须恰好包含 35 个分片');

const smallIntegrity = readJson(path.join(auditRoot, 'zip-integrity-small.json'));
const integrityDirectory = path.join(auditRoot, 'integrity');
const largeIntegrity = readdirSync(integrityDirectory)
  .filter((fileName) => fileName.endsWith('.json'))
  .map((fileName) => readJson(path.join(integrityDirectory, fileName)));
const integrityByName = byFileName([...smallIntegrity, ...largeIntegrity], 'ZIP 完整性记录');
assert(integrityByName.size === 43, `完整性记录异常：预期 43，实际 ${integrityByName.size}`);

const gitDocument = readJson(gitEvidencePath);
assert(gitDocument.complete === true && gitDocument.objectCount === 42, 'Git 历史证据必须完整覆盖 42 个非 pilot ZIP');
assert(gitDocument.objects.every((item) => item.errors.length === 0), 'Git 历史证据仍有错误项');
const gitByName = byFileName(gitDocument.objects, 'Git 历史证据');

const activeRuntimeFileName = 'pilot-case.zip';
const historicalReferenceFileName = 'peds-material-install131.zip';
const verificationOnlyFileName = 'peds-workbuddy-67-import-candidate.zip';
const partPattern = /^peds-private122-part\d{3}\.zip$/;

const objects = inventory.map((item) => {
  const integrity = integrityByName.get(item.fileName);
  const duplicate = duplicateByName.get(item.fileName);
  const standalone = standaloneByName.get(item.fileName);
  assert(integrity && duplicate && standalone, `${item.fileName} 缺少审计证据`);
  assert(integrity.fileId === item.fileId, `${item.fileName} 的 fileId 与完整性记录不一致`);
  assert(integrity.declaredBytes === item.fileSize && integrity.actualBytes === item.fileSize, `${item.fileName} 的字节数不一致`);
  assert(integrity.sizeMatches === true && integrity.zipReadable === true, `${item.fileName} 未通过 ZIP 完整性校验`);
  assert(/^[a-f0-9]{64}$/.test(integrity.sha256), `${item.fileName} 的 SHA256 无效`);

  const isPilot = item.fileName === activeRuntimeFileName;
  const git = isPilot ? null : gitByName.get(item.fileName);
  assert(isPilot || git, `${item.fileName} 缺少 Git 历史证据`);
  if (git) assert(git.fileId === item.fileId, `${item.fileName} 的 fileId 与 Git 证据不一致`);
  const nameHistoryCommits = git?.nameHistoryCommits ?? [];
  const idHistoryCommits = git?.idHistoryCommits ?? [];
  const gitHistoryReferenceFree = !isPilot && nameHistoryCommits.length === 0 && idHistoryCommits.length === 0;
  const isRecoverySetMember = partPattern.test(item.fileName);
  const control = isRecoverySetMember ? controlByName.get(item.fileName) : null;
  if (isRecoverySetMember) {
    assert(control?.fileNameInControl === true && control?.sha256InControl === true, `${item.fileName} 不在完整恢复集合控制清单中`);
  }

  let referenceCategory = 'git_zero';
  if (isPilot) referenceCategory = 'active_runtime_not_in_git_scan';
  else if (nameHistoryCommits.length > 0 || idHistoryCommits.length > 0) referenceCategory = 'historical_git_reference';
  else if (isRecoverySetMember) referenceCategory = 'git_zero_recovery_control_metadata_present';
  else if (item.fileName === verificationOnlyFileName) referenceCategory = 'git_zero_verification_only_worktree_reference';

  const fullStandaloneNameContentBackup = standalone.fullStandaloneNameContentBackup === true;
  const localBackupRequired = gitHistoryReferenceFree && !fullStandaloneNameContentBackup;
  let classification = 'backup_before_any_cleanup';
  let action = '先按清单下载并核验；本审计不授权删除';
  if (isPilot) {
    classification = 'keep_active_runtime';
    action = '保留：生产受控病例冷启动引用，不在 42 个扫描对象与本机下载清单中';
    assert(!localBackupRequired, '活动运行时不应进入零引用下载清单');
  } else if (item.fileName === historicalReferenceFileName) {
    classification = 'hold_historical_reference';
    action = '保留并人工复核历史文档引用，不进入零引用下载清单';
    assert(nameHistoryCommits.length > 0, '历史引用对象缺少文件名命中');
  } else if (isRecoverySetMember) {
    classification = 'backup_as_complete_recovery_set_do_not_split';
    action = '与其余 34 个分片及 control-v2 完整下载核验；不得逐片拆分、重打包或删除';
  } else if (item.fileName === verificationOnlyFileName) {
    classification = 'backup_before_cleanup_verification_reference_only';
    action = '下载核验；当前仅有验收脚本引用，不代表生产运行时依赖';
  }

  return {
    fileName: item.fileName,
    fileId: item.fileId,
    bytes: item.fileSize,
    sha256: integrity.sha256,
    zipReadable: integrity.zipReadable,
    sizeMatches: integrity.sizeMatches,
    entryCount: integrity.entryCount,
    referenceCategory,
    gitNameHistoryCommitCount: nameHistoryCommits.length,
    gitFileIdHistoryCommitCount: idHistoryCommits.length,
    nameHistoryCommits,
    idHistoryCommits,
    standaloneContentEntries: standalone.standaloneContentEntries,
    standaloneNameContentEntries: standalone.standaloneNameContentEntries,
    entriesWithoutStandaloneContent: standalone.entriesWithoutStandaloneContent,
    fullStandaloneContentBackup: standalone.fullStandaloneContentBackup,
    fullStandaloneNameContentBackup,
    exactPathFullyBackedUpInOtherZip: duplicate.exactPathFullyBackedUp,
    contentFullyDuplicatedInOtherZip: duplicate.contentFullyDuplicated,
    exactPathBackupArchives: duplicate.exactPathBackupArchives,
    recoverySetMember: isRecoverySetMember,
    recoveryControl: control,
    localBackupRequired,
    doNotSplit: isRecoverySetMember,
    deletionAuthorized: false,
    classification,
    action,
  };
}).sort(compareNames);

const matrixObjects = objects.filter((item) => item.fileName !== activeRuntimeFileName);
const localBackupObjects = objects.filter((item) => item.localBackupRequired);
const recoverySetObjects = localBackupObjects.filter((item) => item.recoverySetMember);
const individualObjects = localBackupObjects.filter((item) => !item.recoverySetMember);
assert(matrixObjects.length === 42, `分类矩阵应含 42 个对象，实际 ${matrixObjects.length}`);
assert(localBackupObjects.length === 41, `本机下载清单应含 41 个对象，实际 ${localBackupObjects.length}`);
assert(recoverySetObjects.length === 35 && individualObjects.length === 6, '下载清单应包含 35 个分片和 6 个非分片对象');
assert(localBackupObjects.every((item) => item.gitNameHistoryCommitCount === 0 && item.gitFileIdHistoryCommitCount === 0), '下载清单混入 Git 历史引用对象');
assert(localBackupObjects.every((item) => !item.fullStandaloneNameContentBackup), '下载清单混入已有完整独立同路径备份对象');
assert(matrixObjects.every((item) => !item.deletionAuthorized), '任何对象都不得被标记为已授权删除');

const sumBytes = (items) => items.reduce((sum, item) => sum + item.bytes, 0);
const sizeEvidence = (items) => ({
  objectCount: items.length,
  bytes: sumBytes(items),
  decimalGB: Number((sumBytes(items) / 1e9).toFixed(9)),
  binaryGiB: Number((sumBytes(items) / 1073741824).toFixed(9)),
});

mkdirSync(outputRoot, { recursive: true });
const matrixHeaders = [
  'fileName', 'fileId', 'bytes', 'sha256', 'entryCount', 'referenceCategory',
  'gitNameHistoryCommitCount', 'gitFileIdHistoryCommitCount',
  'standaloneContentEntries', 'standaloneNameContentEntries',
  'fullStandaloneContentBackup', 'fullStandaloneNameContentBackup',
  'exactPathFullyBackedUpInOtherZip', 'contentFullyDuplicatedInOtherZip',
  'recoverySetMember', 'doNotSplit', 'localBackupRequired', 'classification', 'action',
];
const backupHeaders = ['fileName', 'fileId', 'bytes', 'sha256', 'downloadGroup', 'doNotSplit'];
const backupRows = localBackupObjects.map((item) => ({
  ...item,
  downloadGroup: item.recoverySetMember ? 'private122-complete-set' : 'individual-object',
}));
writeCsv(path.join(outputRoot, 'zip-classification-matrix.csv'), matrixHeaders, matrixObjects);
writeCsv(path.join(outputRoot, 'local-backup-manifest.csv'), backupHeaders, backupRows);
writeFileSync(
  path.join(outputRoot, 'local-backup-SHA256SUMS.txt'),
  localBackupObjects.map((item) => `${item.sha256}  ${item.fileName}`).join('\n') + '\n',
  { mode: 0o600 },
);

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceCommit,
  inventoryCapturedAt: inventoryDocument.capturedAt,
  gitEvidenceGeneratedAt: gitDocument.generatedAt,
  gitMethod: gitDocument.method,
  networkAccessUsed: false,
  objectStorageReadsUsed: false,
  objectStorageWritesUsed: false,
  signedUrlsIncluded: false,
  secretsIncluded: false,
  deletionAuthorized: false,
  definitions: {
    completeStandaloneBackup: 'ZIP 内每个条目都在 ZIP 之外存在同路径、同内容的独立对象；只有全部条目满足才算完整。',
    otherZipCopies: '其他 ZIP 内的同内容或同路径副本单独列示，不等同于 ZIP 外独立同路径备份。',
    gitZero: 'git log --all --fixed-strings -S<文件名|fileId> 对文件名和 fileId 均无提交命中；不等于医学价值或业务价值为零。',
    localBackupScope: '42 个非 pilot 对象中，Git 历史零引用且没有完整独立同路径备份的对象。pilot-case.zip 因活动运行时引用单独保留。',
  },
  counts: {
    inventoryZipObjects: objects.length,
    matrixObjects: matrixObjects.length,
    activeRuntimeExcludedFromMatrix: 1,
    historicalGitReferenceObjects: matrixObjects.filter((item) => item.referenceCategory === 'historical_git_reference').length,
    gitHistoryReferenceFreeObjects: matrixObjects.filter((item) => item.gitNameHistoryCommitCount === 0 && item.gitFileIdHistoryCommitCount === 0).length,
    completeStandaloneNameContentBackups: matrixObjects.filter((item) => item.fullStandaloneNameContentBackup).length,
    missingCompleteStandaloneNameContentBackups: matrixObjects.filter((item) => !item.fullStandaloneNameContentBackup).length,
    localBackupObjects: localBackupObjects.length,
    individualObjects: individualObjects.length,
    recoverySetMembers: recoverySetObjects.length,
  },
  sizes: {
    allZipObjects: sizeEvidence(objects),
    matrixObjects: sizeEvidence(matrixObjects),
    localBackupTotal: sizeEvidence(localBackupObjects),
    individualObjects: sizeEvidence(individualObjects),
    private122CompleteSetMembers: sizeEvidence(recoverySetObjects),
  },
  private122RecoverySet: {
    memberPattern: 'peds-private122-part001.zip … peds-private122-part035.zip',
    memberCount: recoverySetObjects.length,
    controlObject: 'peds-private122-control-v2.zip',
    fileNameAndSha256PresentInControlForEveryMember: recoverySetObjects.every((item) => item.recoveryControl?.fileNameInControl && item.recoveryControl?.sha256InControl),
    fileIdPresentInControlForEveryMember: recoverySetObjects.every((item) => item.recoveryControl?.fileIdInControl),
    splitDecision: '不可把单分片判定为独立可清理对象；35 个分片必须与 control-v2 作为同一恢复集合完整备份和核验。',
  },
  verificationOnlyReference: {
    fileName: verificationOnlyFileName,
    path: 'scripts/verify-role-three-cases-60.ts',
    productionRuntimeDependency: false,
    note: '该引用是本轮新增的只读验收脚本，不应反向解释为生产运行时依赖。',
  },
  userSteps: [
    '在对象存储控制台按 fileName 精确查找，并核对 fileId；从官方控制台下载原对象，不使用本证据文件中的任何 URL（证据未包含签名 URL）。',
    `本机新建独立目录，下载清单共 ${localBackupObjects.length} 个对象、${sumBytes(localBackupObjects)} 字节；保留原文件名，并将 local-backup-SHA256SUMS.txt 放在同一目录。`,
    'Linux 在该目录执行 sha256sum -c local-backup-SHA256SUMS.txt；macOS 可执行 shasum -a 256 -c local-backup-SHA256SUMS.txt。必须 41/41 全部显示 OK。',
    'Windows PowerShell 可对 local-backup-manifest.csv 每行使用 Get-FileHash -Algorithm SHA256，并用 Get-Item 核对 Length；哈希须不区分大小写等于 sha256，Length 须精确等于 bytes。',
    'peds-private122-part001.zip 至 part035.zip 必须作为同一恢复集合完整下载；同时保留下载清单中的 peds-private122-control-v2.zip，不得只挑部分分片、改名、重打包或逐片清理。',
    '核验后再保留第二份独立副本并复核；把本机核验结果交回人工审核。当前清单不是删除授权，本轮不会删除任何对象。',
  ],
  artifacts: {
    matrix: 'zip-classification-matrix.csv',
    localBackupManifest: 'local-backup-manifest.csv',
    sha256Sums: 'local-backup-SHA256SUMS.txt',
    detailedMatrixJson: 'zip-classification-matrix.json',
  },
};
writeJson(path.join(outputRoot, 'zip-classification-matrix.json'), {
  summary,
  activeRuntimeObject: objects.find((item) => item.fileName === activeRuntimeFileName),
  objects: matrixObjects,
});
writeJson(path.join(outputRoot, 'local-backup-plan.json'), summary);

console.log(JSON.stringify({
  status: 'completed',
  matrixObjects: matrixObjects.length,
  localBackupObjects: localBackupObjects.length,
  individualObjects: individualObjects.length,
  recoverySetMembers: recoverySetObjects.length,
  localBackupBytes: sumBytes(localBackupObjects),
  localBackupGiB: Number((sumBytes(localBackupObjects) / 1073741824).toFixed(6)),
  completeStandaloneNameContentBackups: summary.counts.completeStandaloneNameContentBackups,
  deletionAuthorized: false,
}, null, 2));
