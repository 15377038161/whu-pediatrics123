/**
 * DKA 病例分析试点（不写库、不改报告）：
 *   npx tsx scripts/pilot-case-analysis.ts
 *   CASE_ANALYSIS_LIVE=1 npx tsx scripts/pilot-case-analysis.ts   # 真实模型，消耗配额
 *
 * 离线模式用固定夹具验证判分口径；真实模式从 knowledge/ 读 DKA 原件，
 * 让 AI 生成得分点并逐点判分，结果只打印，不落库。
 */
import { groundCaseAnswerKey } from '../src/domain/case-analysis';
import type { PointJudgementMap } from '../src/domain/diagnosis-answer';
import { generateCaseAnswerKey, gradeCaseAnalysis } from '../src/lib/case-analysis-ai';
import {
  dkaFullJudgements,
  dkaFullSubmission,
  dkaGeneratedKey,
  dkaOnlyPrimaryJudgements,
  dkaOnlyPrimarySubmission,
  dkaPartialJudgements,
  dkaPartialSubmission,
  dkaSource,
  dkaWrongJudgements,
  dkaWrongSubmission,
} from '../tests/fixtures/dka-case-analysis';

const DKA_CASE_ID = 'teacher-1型糖尿病伴有酮症酸中毒';
const live = process.env.CASE_ANALYSIS_LIVE === '1';

function line(label: string, value: string): string {
  return `${label.padEnd(10, ' ')}${value}`;
}

async function main(): Promise<void> {
  console.log(`DKA 病例分析试点 · ${live ? '真实 AI' : '离线夹具'}`);
  let key;
  if (live) {
    const record = await generateCaseAnswerKey(DKA_CASE_ID);
    if (record.status !== 'auto' || !record.key) {
      console.error(`标答生成失败：${record.status} / ${record.reason ?? 'unknown'}`);
      if (record.dropped.length > 0) console.error(`被丢弃候选：${record.dropped.length} 条`);
      process.exitCode = 1;
      return;
    }
    key = record.key;
    console.log(line('模型', record.model));
    console.log(line('提示词', record.promptVersion));
    console.log(line('指纹', record.version));
  } else {
    const grounded = groundCaseAnswerKey(dkaGeneratedKey, dkaSource);
    if (!('key' in grounded)) {
      console.error(`夹具回校失败：${grounded.notAssessableReason}`);
      process.exitCode = 1;
      return;
    }
    key = grounded.key;
    console.log(line('模式', '夹具（不消耗模型配额）'));
  }

  console.log(line('主诊断', key.primary.name));
  console.log(line('并列诊断', key.secondary.map((item) => item.name).join('、') || '无'));
  console.log(line('诊断依据', `${key.evidence.length} 条`));
  console.log(line('鉴别诊断', key.differentials?.map((item) => item.name).join('、') || '原件未提供，不计分'));
  console.log(line('处理原则', `${key.management.length} 条`));
  console.log(line('计分口径', '各段原始权重 30/20/25/10/25（合计 110），报告总分按百分比折算为 100'));
  console.log('');

  const cases = [
    { name: '全对', submission: dkaFullSubmission, judgements: dkaFullJudgements as PointJudgementMap },
    { name: '部分', submission: dkaPartialSubmission, judgements: dkaPartialJudgements as PointJudgementMap },
    { name: '错误', submission: dkaWrongSubmission, judgements: dkaWrongJudgements as PointJudgementMap },
    { name: '只写诊断', submission: dkaOnlyPrimarySubmission, judgements: dkaOnlyPrimaryJudgements as PointJudgementMap },
  ];

  for (const item of cases) {
    const result = await gradeCaseAnalysis(key, item.submission, live
      ? {}
      : { judgements: item.judgements, deps: { generate: async () => { throw new Error('离线模式不应调用模型'); } } });
    const prefix = result.usedFallback ? '（AI 不可用，已回退关键词匹配）' : '';
    console.log(`${item.name.padEnd(6, ' ')} ${result.percent}/100（原始 ${result.grade.totalScore}/${result.grade.maxScore}）${prefix}`);
    console.log(line('  诊断', `${result.grade.diagnosis.primaryScore} + 并列 ${result.grade.diagnosis.secondaryScore}`));
    console.log(line('  依据', `${result.grade.evidence.score}/${result.grade.evidence.maxScore}`));
    console.log(line('  鉴别', result.grade.differential.applicable ? `${result.grade.differential.score}/${result.grade.differential.maxScore}` : '不适用'));
    console.log(line('  处理', `${result.grade.management.score}/${result.grade.management.maxScore}`));
    if (result.grade.missingPoints.length > 0) {
      console.log(line('  漏项', result.grade.missingPoints.slice(0, 5).join('；') + (result.grade.missingPoints.length > 5 ? '…' : '')));
    }
    console.log('');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : '试点运行失败');
  process.exitCode = 1;
});