/**
 * 预生成 DKA 病例分析标答并落库（需已执行迁移 + service role）。
 *   npx tsx scripts/prewarm-case-analysis.ts
 *   npx tsx scripts/prewarm-case-analysis.ts teacher-川崎病
 *
 * 只生成标答，不跑学生判分；学生完成训练时直接读这份缓存，避免完成请求里再等模型。
 */
import { CASE_ANALYSIS_DEFAULT_CASE_ID } from '../src/lib/case-analysis-config';
import { generateCaseAnswerKey } from '../src/lib/case-analysis-ai';
import { saveCaseAnswerKey } from '../src/lib/case-answer-key-store';

async function main(): Promise<void> {
  const caseId = process.argv[2]?.trim() || CASE_ANALYSIS_DEFAULT_CASE_ID;
  const record = await generateCaseAnswerKey(caseId);
  await saveCaseAnswerKey(record);
  console.log(`case=${record.caseId}`);
  console.log(`version=${record.version}`);
  console.log(`status=${record.status}`);
  if (record.reason) console.log(`reason=${record.reason}`);
  if (record.key) {
    console.log(`primary=${record.key.primary.name}`);
    console.log(`secondary=${record.key.secondary.map((item) => item.name).join('、') || '无'}`);
    console.log(`evidence=${record.key.evidence.length}`);
    console.log(`differentials=${record.key.differentials?.length ?? 0}`);
    console.log(`management=${record.key.management.length}`);
  }
  if (record.dropped.length > 0) console.log(`dropped=${record.dropped.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : '预生成失败');
  process.exitCode = 1;
});