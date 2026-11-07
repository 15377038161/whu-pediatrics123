/* eslint-disable no-console, @typescript-eslint/no-require-imports */
/**
 * 仅补扫 ZIP 文件名/fileId 的 Git pickaxe 证据。
 * 输出 commits，不输出命中的历史正文，不读取或修改对象存储。
 */
const { execFile } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const inventoryPath = process.argv[2];
if (!inventoryPath) throw new Error('用法: node scripts/audit-git-zip-references.cjs <zip-inventory.json>');

const inventoryDocument = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const sourceFiles = Array.isArray(inventoryDocument) ? inventoryDocument : inventoryDocument.files;
if (!Array.isArray(sourceFiles)) throw new Error('清单中缺少 files 数组');
const inventory = sourceFiles
  .filter((item) => item.fileName.toLowerCase().endsWith('.zip') && item.fileName !== 'pilot-case.zip');
if (inventory.length !== 42) throw new Error(`ZIP 范围异常：预期 42，实际 ${inventory.length}`);

async function commitsContaining(pattern) {
  const { stdout } = await execFileAsync('git', [
    'log', '--all', '--format=%H', '--fixed-strings', `-S${pattern}`, '--', '.',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

const results = Array.from({ length: inventory.length });
let cursor = 0;
let finished = 0;

async function worker() {
  while (cursor < inventory.length) {
    const index = cursor;
    cursor += 1;
    const item = inventory[index];
    const result = {
      fileName: item.fileName,
      fileId: item.fileId,
      nameHistoryCommits: [],
      idHistoryCommits: [],
      errors: [],
    };
    try {
      result.nameHistoryCommits = await commitsContaining(item.fileName);
    } catch (error) {
      result.errors.push(`name: ${error instanceof Error ? error.message.slice(0, 240) : String(error)}`);
    }
    try {
      result.idHistoryCommits = await commitsContaining(item.fileId);
    } catch (error) {
      result.errors.push(`fileId: ${error instanceof Error ? error.message.slice(0, 240) : String(error)}`);
    }
    results[index] = result;
    finished += 1;
    console.error(`PROGRESS ${finished}/${inventory.length} ${item.fileName} name=${result.nameHistoryCommits.length} id=${result.idHistoryCommits.length} errors=${result.errors.length}`);
  }
}

async function main() {
  await Promise.all(Array.from({ length: Math.min(4, inventory.length) }, () => worker()));
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    method: 'git log --all --fixed-strings -S<filename|fileId> -- .',
    contentPrinted: false,
    objectCount: results.length,
    complete: results.every((item) => item.errors.length === 0),
    objects: results,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.complete) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FATAL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
