import { readdir, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const text = readFileSync('src/domain/teacher-case-catalog.ts', 'utf8');
const catalog = JSON.parse(text.slice(text.indexOf('= [') + 2, text.lastIndexOf(']') + 1));
let converted = 0;
async function convert(file, relative, caseId) {
  const destination = path.resolve('knowledge/teaching-media', caseId);
  await mkdir(destination, { recursive: true });
  const output = path.join(destination, `${createHash('sha256').update(relative).digest('hex')}.mp4`);
  if (await access(output).then(() => true, () => false)) return;
  await new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-c:v', 'libx264', '-preset', 'fast', '-crf', '24', '-c:a', 'aac', '-movflags', '+faststart', output], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    process.stderr.on('data', () => {});
    process.on('error', reject);
    process.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`视频转换失败，退出码 ${code}`)));
  });
  converted++;
}
for (const item of catalog.filter((entry) => entry.folder)) {
  const root = path.resolve(item.folder);
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && ['.avi', '.mov'].includes(path.extname(entry.name).toLowerCase())) await convert(file, path.relative(root, file).replaceAll('\\', '/'), item.id);
    }
  }
  await walk(root);
}
console.log(JSON.stringify({ converted, output: 'knowledge/teaching-media' }));
