/**
 * 病例媒体绑定（私有链）：按 spec 上传图片至对象存储（StorageClient），
 * 生成 testMedia 绑定叠加层 JSON（不修改 pack 候选原文件——保 manifest 指纹）。
 *
 * 隐私硬门槛：spec 中每张图必须已完成全图隐私图核且结论为 adoptable（无身份标识），
 * blocked_until_redacted 媒体禁止进入 spec（teacher-case-data.ts 模式注释同源约束）。
 *
 * 用法：pnpm exec tsx scripts/case-audit/bind-case-media.mts <spec.json>
 * spec 结构（私有，outputs/ 下）：
 *  {
 *    "caseId": "teacher-蚕豆病",
 *    "candidatePath": "outputs/local-handoff-20261023/pack-20261023/runtime-candidates/teacher-蚕豆病.json",
 *    "imageDir": "outputs/case-library-review/20261024/incoming/media-candou",
 *    "sourceDocxSha256": "93ed1dde…",
 *    "images": [{ "file": "image1.png", "testId": "source-test-2", "caption": "…" }],
 *    "outPath": "outputs/case-library-review/20261024/media-bindings/teacher-蚕豆病.testMedia.json"
 *  }
 * 叠加层：{ caseId, boundAt, sourceDocxSha256, candidateSha256, testMedia, provenance[] }
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { StorageClient } from 'coder-coding-dev-sdk';
import { recordSchema } from '@/lib/teacher-case-data';

const ROOT = process.cwd();
const specPath = process.argv[2];
if (!specPath) {
  console.error('用法：pnpm exec tsx scripts/case-audit/bind-case-media.mts <spec.json>');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
  caseId: string; candidatePath: string; imageDir: string; sourceDocxSha256: string;
  images: Array<{ file: string; testId: string; caption: string }>; outPath: string;
};

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

// 1) 候选校验：caseId 一致、tests 行存在、testId 均在候选行索引内
const candAbs = path.join(ROOT, spec.candidatePath);
const cand = JSON.parse(readFileSync(candAbs, 'utf8'));
if (cand.caseId !== spec.caseId) { console.error(`caseId 不符：${cand.caseId} != ${spec.caseId}`); process.exit(1); }
const candidateSha256 = sha256(candAbs);
const testLines = (cand.sections?.tests ?? '').split('\n')
  .filter((l: string) => l.trim() && !/^(?:辅助检查|辅检|入院后辅检)[：:]?$/.test(l.trim()));
const maxIndex = testLines.length - 1;
for (const img of spec.images) {
  const m = /^source-test-(\d+)$/.exec(img.testId);
  if (!m || Number(m[1]) > maxIndex) { console.error(`testId 越界：${img.testId}（候选 ${testLines.length} 行）`); process.exit(1); }
}
console.log(`候选校验通过：${spec.caseId}，tests ${testLines.length} 行，${spec.images.length} 张待绑`);

// 2) 上传（StorageClient 零配置；fileId 为唯一登记标识，不持久化 URL）
const storage = new StorageClient();
const testMediaMap = new Map<string, Array<{ fileId: string; kind: 'image'; caption: string }>>();
const provenance: Array<{ file: string; sha256: string; fileId: string; testId: string; size: number }> = [];
for (const img of spec.images) {
  const abs = path.join(ROOT, spec.imageDir, img.file);
  const content = readFileSync(abs);
  const digest = sha256(abs);
  const contentType = img.file.toLowerCase().endsWith('.jpeg') || img.file.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  // 扁平模型文件名不含目录分隔符；加病例前缀便于平台侧管理识别
  const uploaded = await storage.uploadFile({
    fileContent: content,
    fileName: `case-media_${spec.caseId.replace(/^teacher-/, '')}_${img.file}`,
    contentType,
  });
  const list = testMediaMap.get(img.testId) ?? [];
  list.push({ fileId: uploaded.fileId, kind: 'image', caption: img.caption });
  testMediaMap.set(img.testId, list);
  provenance.push({ file: img.file, sha256: digest, fileId: uploaded.fileId, testId: img.testId, size: content.length });
  console.log(`[bind] ${img.file} -> ${img.testId} fileId=${uploaded.fileId.slice(0, 12)}…`);
}

// 3) 叠加层落盘 + 模式校验（复用运行时 recordSchema 的 testMedia 形状）
const testMedia = [...testMediaMap.entries()]
  .sort((a, b) => Number(a[0].replace('source-test-', '')) - Number(b[0].replace('source-test-', '')))
  .map(([testId, media]) => ({ testId, media }));
const shapeCheck = recordSchema.shape.testMedia.unwrap().safeParse(testMedia);
if (!shapeCheck.success) { console.error('testMedia 模式校验失败', shapeCheck.error.issues); process.exit(1); }

const overlay = {
  caseId: spec.caseId,
  boundAt: new Date().toISOString(),
  bindingMode: 'storage_fileId_overlay_not_candidate_mutation',
  sourceDocxSha256: spec.sourceDocxSha256,
  candidateSha256,
  testMedia,
  provenance,
};
const outAbs = path.join(ROOT, spec.outPath);
mkdirSync(path.dirname(outAbs), { recursive: true });
writeFileSync(outAbs, JSON.stringify(overlay, null, 2));
console.log(`叠加层落盘：${spec.outPath}（testMedia ${testMedia.length} 组 / 媒体 ${provenance.length} 张）`);
