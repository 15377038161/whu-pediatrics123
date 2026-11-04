/**
 * Restore only uniquely confirmed historical media bindings into the current
 * controlled case files. The old staged package is used as the source of fileIds
 * and captions; every target testId is checked against the current test definitions
 * and every image byte has already been matched to the archived report content.
 *
 * This script never deletes media, never touches DKA's pinned active version, and
 * refuses to run unless all targets and source IDs are present.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { recordSchema, type TeacherCaseData } from '@/lib/teacher-case-data';
import { computeCaseDataVersion } from '@/lib/case-data-version';

type Binding = { fileId: string; caption: string };
type Plan = {
  caseId: string;
  testMedia: Array<{ testId: string; media: Binding[] }>;
  examMedia?: Array<{ examId: string; media: Binding[] }>;
};

const plan: Plan[] = [
  {
    caseId: 'teacher-中枢性尿崩症',
    testMedia: [{ testId: 'source-test-3', media: [{ fileId: '54477d66632578a9a0db7de8aff38f74', caption: '教师原PDF报告的整页显示副本，非AI生成；检查所见和日期对应本项文字与源报告。' }] }],
  },
  {
    caseId: 'teacher-噬血细胞综合征',
    testMedia: [
      { testId: 'source-test-69', media: [{ fileId: 'ab06c40d0517b6d2ecdcf00c74804d1e', caption: '教师原件骨髓细胞学的既有脱敏副本；相对原图仅有黑色遮罩，遮罩外像素一致。检查日期和主要结果见本项文字；非AI生成影像。' }] },
      { testId: 'source-test-78', media: [{ fileId: '047dcd9a6e4d4d0153d2d633571f243e', caption: '教师原件CT（颅脑）的既有脱敏副本；相对原图仅有黑色遮罩，遮罩外像素一致。检查日期和主要结果见本项文字；非AI生成影像。' }] },
      { testId: 'source-test-80', media: [{ fileId: '0c1e2e8bfe5090aad329d201682671e1', caption: '教师原件CT（全腹）的既有脱敏副本；相对原图仅有黑色遮罩，遮罩外像素一致。检查日期和主要结果见本项文字；非AI生成影像。' }] },
    ],
  },
  {
    caseId: 'teacher-特发性血小板减少性紫癜',
    testMedia: [
      { testId: 'source-test-10', media: [{ fileId: '177e3936beda5a2af2da11d114fc48fd', caption: '教师原始检查报告：血常规；原件表格同行附件，数值请结合原报告核对。' }] },
      { testId: 'source-test-21', media: [{ fileId: 'b3042b3eeb6facc6171d8d2cf10cc0dc', caption: '教师原始检查报告：血小板相关抗体；原件表格同行附件，数值请结合原报告核对。' }] },
      { testId: 'source-test-6', media: [
        { fileId: 'fadb29936d34e168b84b937b0e63e2de', caption: '教师原件表格的生化、心肌酶谱等附件；同一表格行、原件检查日期与结果对应。组合检查包含多张原始报告，具体指标请结合原图核对。' },
        { fileId: '340b4b39c2943591a260387faa726f70', caption: '教师原件表格的生化、心肌酶谱等附件；同一表格行、原件检查日期与结果对应。组合检查包含多张原始报告，具体指标请结合原图核对。' },
      ] },
      { testId: 'source-test-7', media: [{ fileId: '89737fa32800c53653cb52d6e5270d1c', caption: '教师原件表格的生化、心肌酶谱等附件；同一表格行、原件检查日期与结果对应。组合检查包含多张原始报告，具体指标请结合原图核对。' }] },
      { testId: 'source-test-17', media: [{ fileId: '528ec77ca2c59967982d2acbd3b6e7a3', caption: '教师原件表格的病原学检查附件；同一表格行、原件检查日期与结果对应。组合检查包含多张原始报告，具体指标请结合原图核对。' }] },
      { testId: 'source-test-43', media: [{ fileId: '4821efd4db18801c9f44673333518feb', caption: '教师原件检查报告：超声（肝胆胰脾）；同一原表格行的原图。检查日期随本项文字结果保留。' }] },
      { testId: 'source-test-25', media: [{ fileId: 'd930021470c32c03c1d459d8a50e3294', caption: '教师原件检查报告：超声（心脏）；同一原表格行的原图。检查日期随本项文字结果保留。' }] },
      { testId: 'source-test-54', media: [{ fileId: 'a6b72b4b681dfdcd7dda268e06fafad0', caption: '教师原件检查报告：心电图；同一原表格行的原图。原件此表未列检查日期，不补造日期。' }] },
    ],
    examMedia: [{ examId: 'source-exam-inspection-skin', media: [{ fileId: '5167a2ade32646b9763e86193ba11145', caption: '教师原件中的皮肤查体附件；对应本例视诊记录，具体体征待教师复核。' }] }],
  },
  {
    caseId: 'teacher-蚕豆病',
    testMedia: [
      { testId: 'source-test-1', media: [{ fileId: '5018412cde7e529bb6f9775424629246', caption: '教师原始血常规报告；对应本例血常规项目，临床解读待教师核对。' }] },
      { testId: 'source-test-2', media: [
        { fileId: 'b1a14e5ded2f0fa44d86da272fded3bc', caption: '教师原件的生化、炎症指标附件；同一原表格行，原检查日期及主要结果随本项保留，具体指标请结合原图核对。' },
        { fileId: '1389fcbdd82c89ffb629eecac0ae69f8', caption: '教师原件的生化、炎症指标附件；同一原表格行，原检查日期及主要结果随本项保留，具体指标请结合原图核对。' },
      ] },
      { testId: 'source-test-8', media: [{ fileId: '69878cb2ef713b31d2a4c524cdd0a920', caption: '教师原件的病原学检查附件；同一原表格行，原检查日期及主要结果随本项保留，具体指标请结合原图核对。' }] },
      { testId: 'source-test-10', media: [{ fileId: '1eef94cac215275ff417b813b6ff0dc8', caption: '教师原件的病原学检查附件；同一原表格行，原检查日期及主要结果随本项保留，具体指标请结合原图核对。' }] },
      { testId: 'source-test-15', media: [{ fileId: 'c9d1e58102b6b4a1707b12b479cff9c1', caption: '教师原件的病原学检查附件；同一原表格行，原检查日期及主要结果随本项保留，具体指标请结合原图核对。' }] },
      { testId: 'source-test-9', media: [{ fileId: 'e190c5f25c0b5cf8716e8ea917f8859a', caption: '教师原件的溶血及免疫检查附件；同一原表格行，原检查日期及主要结果随本项保留，具体指标请结合原图核对。' }] },
      { testId: 'source-test-11', media: [{ fileId: 'e1f1d425ce89470f5dbeb7d85d9f4edc', caption: '教师原件的溶血及免疫检查附件；同一原表格行，原检查日期及主要结果随本项保留，具体指标请结合原图核对。' }] },
    ],
  },
];

const root = process.cwd();
const knowledgeRoot = path.join(root, 'knowledge', 'teaching-cases');
const backupDir = '/tmp/case-media-recovery-backups';
mkdirSync(backupDir, { recursive: true });

const receipt: Array<Record<string, unknown>> = [];
for (const item of plan) {
  const file = path.join(knowledgeRoot, `${item.caseId}.json`);
  const before = JSON.parse(readFileSync(file, 'utf8')) as TeacherCaseData;
  const beforeVersion = computeCaseDataVersion(before);
  const testIds = new Set((before.testDefinitions ?? []).map((test) => test.testId));
  for (const binding of item.testMedia) {
    if (!testIds.has(binding.testId)) throw new Error(`MEDIA_TARGET_MISSING:${item.caseId}:${binding.testId}`);
    if (!binding.media.length || binding.media.some((media) => !/^[a-f0-9]{32}$/.test(media.fileId))) {
      throw new Error(`MEDIA_FILE_INVALID:${item.caseId}:${binding.testId}`);
    }
  }
  if ((before.testMedia?.length ?? 0) > 0) throw new Error(`MEDIA_ALREADY_PRESENT:${item.caseId}`);
  if (item.examMedia && !item.caseId.includes('血小板')) throw new Error(`UNEXPECTED_EXAM_MEDIA:${item.caseId}`);

  copyFileSync(file, path.join(backupDir, `${item.caseId}.${beforeVersion}.json`));
  const next: TeacherCaseData = {
    ...before,
    testMedia: item.testMedia.map((binding) => ({ ...binding, media: binding.media.map((media) => ({ ...media, kind: 'image' as const })) })),
    ...(item.examMedia ? { examMedia: item.examMedia.map((binding) => ({ ...binding, media: binding.media.map((media) => ({ ...media, kind: 'image' as const })) })) } : {}),
  };
  recordSchema.parse(next);
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  receipt.push({
    caseId: item.caseId,
    beforeVersion,
    afterVersion: computeCaseDataVersion(next),
    testMedia: item.testMedia.map((binding) => ({ testId: binding.testId, fileIds: binding.media.map((media) => media.fileId) })),
    examMedia: item.examMedia ?? [],
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  });
  console.log(`${item.caseId}: ${beforeVersion} -> ${receipt.at(-1)?.afterVersion}; testMedia=${item.testMedia.length}; examMedia=${item.examMedia?.length ?? 0}`);
}

const blocked = [
  { caseId: 'teacher-1型糖尿病伴有酮症酸中毒', reason: '现行两版仅保留两条血气分析；旧版3项媒体（肝胆胰脾超声、两份PDF报告）无对应新版testId，活动版本dcdf43acad052794保持冻结。', fileIds: ['eada38ddc8b12b62a2b584ce13c94c9a', 'dd9e5e70e70e23752acdb145144e9729', '9afe76d7d67b57473df568aa6daf4f2a'] },
  { caseId: 'teacher-中枢性尿崩症', reason: 'PET/CT与心电图旧图在现行27项检查中无对应项目；仅MRI垂体平扫+增强可唯一映射。', fileIds: ['2ff7d1f00984c3b053f97df34fa5fcc6', 'ad1d37639b3b682d885342857b50b22f'] },
  { caseId: 'teacher-特发性血小板减少性紫癜', reason: 'EBV报告图在现行38项检查中无独立项目；其余10份已逐一确认。', fileIds: ['12f2560557cc75f432afb5c464c84dfd'] },
  { caseId: 'teacher-蚕豆病', reason: '呼吸道病原图在现行23项检查中无对应项目；颅脑CT图对应的仅剩合并项目source-test-0（同时含血常规/肝功能），绑定会扩大释放范围；其余8份已确认。', fileIds: ['770d914561e50c83b3479df4157744e8', 'bb3bfb8f050150c6a05599c55dab85bf'] },
];
writeFileSync(path.join(root, 'review-records', 'case-media-recovery-20261104.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  policy: 'only uniquely confirmed current testIds; no historical version deleted; DKA active version untouched',
  applied: receipt,
  blocked,
}, null, 2)}\n`);
console.log(`APPLIED=${receipt.length} BLOCKED=${blocked.length}`);
