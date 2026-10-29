/**
 * 病例媒体绑定（私有链）：按 spec 上传图片至对象存储（StorageClient），
 * 生成 testMedia 绑定叠加层 JSON（不修改 pack 候选原文件——保 manifest 指纹）。
 *
 * 教师材料使用授权按本聊天确认记录，不再要求逐图隐私批准。
 * 每图review仍须核实用途和来源，绑定候选、图片及caption的SHA256和testId；
 * 缺收据或任一绑定已变化，整批在创建StorageClient前拒绝。不得自行填写批准冒充人工图核。
 *
 * 用法：pnpm exec tsx scripts/case-audit/bind-case-media.mts <spec.json>
 * spec 结构（私有，outputs/ 下）：
 *  {
 *    "caseId": "teacher-蚕豆病",
 *    "candidatePath": "outputs/local-handoff-20261023/pack-20261023/runtime-candidates/teacher-蚕豆病.json",
 *    "imageDir": "outputs/case-library-review/20261024/incoming/media-candou",
 *    "images": [{ "file": "image1.png", "testId": "source-test-2", "caption": "…", "sourcePath": "私有原图路径",
 *      "source": { "kind": "standalone-image", "originalSha256": "…", "locatorSha256": "…" }, "review": "见 docs/CASE_MEDIA_BINDING.md" }],
 *    "outPath": "outputs/case-library-review/20261024/media-bindings/teacher-蚕豆病.testMedia.json"
 *  }
 * 叠加层：{ caseId, boundAt, candidateSha256, testMedia, provenance[] }
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { StorageClient } from 'coder-coding-dev-sdk';
import { recordSchema } from '@/lib/teacher-case-data';
import { requireMediaBindingReview, verifyMediaOriginal, verifyRegisteredMedia, type MediaBindingReview, type MediaSource } from './media-binding-review';

const ROOT = process.cwd();
async function main() {
const specPath = process.argv[2];
if (!specPath) {
  console.error('用法：pnpm exec tsx scripts/case-audit/bind-case-media.mts <spec.json>');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
  caseId: string; candidatePath: string; imageDir: string;
  images: Array<{ file: string; testId: string; caption: string; sourcePath: string; source: MediaSource; review: MediaBindingReview; existingFileId?:string }>; outPath: string;
};

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

// 1) 候选校验：caseId 一致、tests 行存在、testId 均在候选行索引内
const candAbs = path.resolve(ROOT, spec.candidatePath);
const cand = JSON.parse(readFileSync(candAbs, 'utf8'));
if (cand.caseId !== spec.caseId) throw new Error('MEDIA_CASE_MISMATCH');
const candidateSha256 = sha256(candAbs);
const testLines = (cand.sections?.tests ?? '').split('\n')
  .filter((l: string) => l.trim() && !/^(?:辅助检查|辅检|入院后辅检)[：:]?$/.test(l.trim()));
const maxIndex = testLines.length - 1;
if (!spec.images.length) throw new Error('MEDIA_SPEC_EMPTY');
// Validate the ENTIRE batch before constructing StorageClient or uploading the first image.
const checkedImages = new Map<string, Buffer>();
for (const img of spec.images) {
  if (path.basename(img.file) !== img.file || /[\\/]/.test(img.file)) throw new Error('MEDIA_PATH_INVALID');
  if (!/\.(png|jpe?g)$/i.test(img.file) || typeof img.caption !== 'string' || !img.caption.trim()) throw new Error('MEDIA_FORMAT_OR_CAPTION_INVALID');
  const m = /^source-test-(\d+)$/.exec(img.testId);
  if (!m || Number(m[1]) > maxIndex) throw new Error('MEDIA_TRIGGER_INVALID');
  const bytes = readFileSync(path.resolve(ROOT, spec.imageDir, img.file));
  if (typeof img.sourcePath !== 'string' || !img.sourcePath.trim()) throw new Error('MEDIA_SOURCE_PATH_MISSING');
  const sourcePath = path.resolve(ROOT, img.sourcePath);
  verifyMediaOriginal(img.source, readFileSync(sourcePath), sourcePath, bytes);
  requireMediaBindingReview(img.review, { caseId: spec.caseId, candidateSha256,
    source: img.source, testId: img.testId,
    captionSha256: createHash('sha256').update(img.caption).digest('hex') }, bytes);
  checkedImages.set(img.file, bytes);
}
console.log(`媒体来源/用途与教师授权校验通过：${spec.images.length} 张待绑`);

// 2) 上传（StorageClient 零配置；fileId 为唯一登记标识，不持久化 URL）
const storage = new StorageClient();
// Verify every reused object before uploading anything; wrong registrations cannot cause partial new uploads.
for(const img of spec.images)if(img.existingFileId!==undefined)await verifyRegisteredMedia(img.existingFileId,checkedImages.get(img.file)!,storage);
const testMediaMap = new Map<string, Array<{ fileId: string; kind: 'image'; caption: string }>>();
const provenance: Array<{ file: string; sha256: string; fileId: string; testId: string; size: number; source: MediaSource; review: MediaBindingReview; storageAction:'verified-reuse'|'uploaded' }> = [];
for (const img of spec.images) {
  const content = checkedImages.get(img.file)!;
  const digest = createHash('sha256').update(content).digest('hex');
  const contentType = img.file.toLowerCase().endsWith('.jpeg') || img.file.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  // 扁平模型文件名不含目录分隔符；加病例前缀便于平台侧管理识别
  const uploaded = img.existingFileId ? {fileId:img.existingFileId} : await storage.uploadFile({
    fileContent: content,
    fileName: `case-media_${digest}${path.extname(img.file).toLowerCase()}`,
    contentType,
  });
  const list = testMediaMap.get(img.testId) ?? [];
  list.push({ fileId: uploaded.fileId, kind: 'image', caption: img.caption });
  testMediaMap.set(img.testId, list);
  provenance.push({ file: img.file, sha256: digest, fileId: uploaded.fileId, testId: img.testId, size: content.length, source: img.source, review: img.review,storageAction:img.existingFileId?'verified-reuse':'uploaded' });
  console.log(`[bind] image=${digest.slice(0, 12)} trigger=${img.testId}`);
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
  candidateSha256,
  testMedia,
  provenance,
};
const outAbs = path.resolve(ROOT, spec.outPath);
mkdirSync(path.dirname(outAbs), { recursive: true });
writeFileSync(outAbs, JSON.stringify(overlay, null, 2));
console.log(`叠加层已落盘：testMedia ${testMedia.length} 组 / 媒体 ${provenance.length} 张`);

}
await main().catch((error: unknown) => {
  // Storage/filesystem errors can carry private paths or signed URLs. Never print them.
  const code = error instanceof Error && /^MEDIA_[A-Z_]+$/.test(error.message) ? error.message : 'MEDIA_BINDING_FAILED';
  console.error(code);
  process.exitCode = 1;
});
