import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'knowledge');
const output = path.resolve(process.argv[3] ?? 'docs/实施方案/病例知识库资源索引.json');
const media = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp3', '.wav', '.mp4', '.avi', '.mov']);
const documents = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xlsx']);

async function walk(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else result.push(full);
  }
  return result;
}

const files = await walk(root);
const groups = new Map();
for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const segments = relative.split('/');
  const caseName = segments.length > 1 ? segments[0] : '未分类资料';
  const item = groups.get(caseName) ?? { caseName, files: [], media: [], documents: [] };
  const ext = path.extname(file).toLowerCase();
  const record = { path: `knowledge/${relative}`, bytes: (await stat(file)).size };
  item.files.push(record);
  if (media.has(ext)) item.media.push(record.path);
  if (documents.has(ext)) item.documents.push(record.path);
  groups.set(caseName, item);
}

const outputData = {
  generatedAt: new Date().toISOString(),
  sourceRoot: 'knowledge/',
  purpose: '教师病例资料资源索引；不改变原始资料，不把未审核资料直接暴露给学生端。',
  groups: [...groups.values()].sort((a, b) => a.caseName.localeCompare(b.caseName, 'zh-CN')),
};
await writeFile(output, JSON.stringify(outputData, null, 2), 'utf8');
console.log(`indexed ${files.length} files into ${output}`);
