/**
 * 从教师提供的病例原件（sections.diagnosis / sections.plan）里**抽取**结构化标答。
 *
 * 与 diagnosis-answer.ts 的关系：那边是判分结构（DiagnosisAnswerKey / gradeDiagnosisAnswer），
 * 这边只负责把扫描版病历原文切成可核对的条目。原件不是分列的标答清单——实测 53 例中
 * 35 例同时含入院与出院诊断、28 例含「二、五、」文档序号、34 例混入出院情况查体叙述，
 * 按行序直接切会把「出院诊断」当成第二诊断、把查体叙述当成诊断，所以必须逐条回校原文。
 *
 * 红线：
 * - 模型只做「切分与归类」，不生成、不补全、不推断任何医学内容；
 * - 每条结果必须带 sourceQuote，且必须是原件的逐字子串（仅容忍空白差异），校验不过一律丢弃并如实回报；
 * - 行号、入院/出院归属、叙述段排除全部由本模块确定性计算，不采信模型自报；
 * - 结果只用于教师复核与教学对照，不参与判分、不进临床成绩。
 */

import { z } from 'zod';

export type AnswerPhase = 'admission' | 'discharge' | 'unspecified';

export type ExtractedItem = {
  /** 原件逐字引用，教师据此核对。 */
  sourceQuote: string;
  /** 引用所在原件行号（1 起）；跨行引用无法定位到单行时为 null。 */
  sourceLine: number | null;
  /** 由所在行及其上文最近一次「入院诊断/出院诊断」声明确定性推出。 */
  phase: AnswerPhase;
};

export type DroppedItem = { sourceQuote: string; reason: string };

export type ExtractedCaseAnswer = {
  diagnoses: ExtractedItem[];
  management: ExtractedItem[];
  /** 被校验丢弃的条目与原因，如实回给教师，不静默吞掉。 */
  dropped: DroppedItem[];
  disclaimer: string;
};

export const DIAGNOSIS_EXTRACTION_DISCLAIMER =
  '以下条目由 AI 从教师提供的病历原件中逐字摘取并归类，不含原件以外的任何医学内容；' +
  '每条都标出原文行号供教师核对，未经教师复核不作为标准答案，也不参与判分。';

const MAX_DIAGNOSES = 12;
const MAX_MANAGEMENT = 16;
const MIN_QUOTE = 2;
const MAX_QUOTE = 200;

/** 原件里这些开头是叙述段（病程/出院情况/查体），不是诊断条目，不能被当成诊断。 */
const NARRATIVE_LINE_PREFIXES = ['出院情况', '诊疗经过', '查体', '入院情况', '病程记录', '辅助检查'];
const ADMISSION_MARKERS = ['入院诊断', '初步诊断', '门诊诊断'];
const DISCHARGE_MARKERS = ['出院诊断', '修正诊断', '最后诊断'];

/** 仅折叠空白后比较：既容忍模型改写换行/空格，又不放过任何字形改动。 */
function squash(value: string): string {
  return value.replace(/\s+/g, '');
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function phaseOfLine(line: string): AnswerPhase | null {
  const head = squash(line).slice(0, 12);
  if (ADMISSION_MARKERS.some((marker) => head.includes(squash(marker)))) return 'admission';
  if (DISCHARGE_MARKERS.some((marker) => head.includes(squash(marker)))) return 'discharge';
  return null;
}

/**
 * 逐行确定入院/出院归属：某行自己声明了就用它自己的，否则继承上文最近一次声明。
 * 纯结构判断，不涉及医学内容。
 */
export function resolveLinePhases(diagnosisText: string): AnswerPhase[] {
  let current: AnswerPhase = 'unspecified';
  return splitLines(diagnosisText).map((line) => {
    const declared = phaseOfLine(line);
    if (declared) current = declared;
    return current;
  });
}

function locateLine(lines: readonly string[], quote: string): number | null {
  const target = squash(quote);
  if (!target) return null;
  const index = lines.findIndex((line) => squash(line).includes(target));
  return index < 0 ? null : index + 1;
}

function isNarrativeLine(line: string | undefined): boolean {
  if (!line) return false;
  const head = squash(line).slice(0, 10);
  return NARRATIVE_LINE_PREFIXES.some((prefix) => head.startsWith(squash(prefix)));
}

const responseSchema = z.object({
  diagnoses: z.array(z.string()).max(MAX_DIAGNOSES * 2).default([]),
  management: z.array(z.string()).max(MAX_MANAGEMENT * 2).default([]),
});

/** 剥掉 ```json 围栏后解析；模型输出不是合法 JSON 时抛错，由调用方按「模型不可用」处理。 */
export function parseExtractionResponse(raw: string): { diagnoses: string[]; management: string[] } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('EXTRACTION_RESPONSE_NOT_JSON');
  const parsed = responseSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
  if (!parsed.success) throw new Error('EXTRACTION_RESPONSE_SHAPE_INVALID');
  return parsed.data;
}

type VerifyContext = {
  lines: readonly string[];
  phases: readonly AnswerPhase[];
  sourceText: string;
  limit: number;
  narrativeRejected: boolean;
};

function verifyQuotes(quotes: readonly string[], context: VerifyContext, dropped: DroppedItem[]): ExtractedItem[] {
  const accepted: ExtractedItem[] = [];
  const squashedSource = squash(context.sourceText);
  for (const raw of quotes) {
    const quote = raw.trim();
    if (!quote) continue;
    if (accepted.length >= context.limit) {
      dropped.push({ sourceQuote: quote, reason: `超出条数上限（最多 ${context.limit} 条），已截断` });
      continue;
    }
    if (squash(quote).length < MIN_QUOTE) {
      dropped.push({ sourceQuote: quote, reason: '引用过短，无法核对' });
      continue;
    }
    if (quote.length > MAX_QUOTE) {
      dropped.push({ sourceQuote: quote.slice(0, 40) + '…', reason: '引用过长（整段叙述），不是可核对的要点' });
      continue;
    }
    // 逐字子串校验：原件里没有的字形一律进不来，这是防止模型补全诊断的结构性关卡。
    if (!squashedSource.includes(squash(quote))) {
      dropped.push({ sourceQuote: quote, reason: '不是原件的逐字内容，已丢弃（原件没有的诊断不允许出现）' });
      continue;
    }
    const sourceLine = locateLine(context.lines, quote);
    if (context.narrativeRejected && isNarrativeLine(context.lines[(sourceLine ?? 1) - 1])) {
      dropped.push({ sourceQuote: quote, reason: '引用来自叙述段（出院情况/查体/诊疗经过），不是诊断条目' });
      continue;
    }
    accepted.push({
      sourceQuote: quote,
      sourceLine,
      phase: sourceLine === null ? 'unspecified' : context.phases[sourceLine - 1] ?? 'unspecified',
    });
  }
  return accepted;
}

/**
 * 把模型输出回校到原件上，产出可核对的条目列表。
 * 所有校验都在本地做，模型只负责「指出原件里的哪几段是诊断/处理要点」。
 */
export function buildExtractedAnswer(raw: string, source: { diagnosisText: string; planText: string }): ExtractedCaseAnswer {
  const parsed = parseExtractionResponse(raw);
  const dropped: DroppedItem[] = [];
  const diagnosisLines = splitLines(source.diagnosisText);
  const planLines = splitLines(source.planText);
  const diagnoses = verifyQuotes(parsed.diagnoses, {
    lines: diagnosisLines,
    phases: resolveLinePhases(source.diagnosisText),
    sourceText: source.diagnosisText,
    limit: MAX_DIAGNOSES,
    narrativeRejected: true,
  }, dropped);
  const management = verifyQuotes(parsed.management, {
    lines: planLines,
    phases: planLines.map(() => 'unspecified' as AnswerPhase),
    sourceText: source.planText,
    limit: MAX_MANAGEMENT,
    narrativeRejected: false,
  }, dropped);
  return { diagnoses, management, dropped, disclaimer: DIAGNOSIS_EXTRACTION_DISCLAIMER };
}

export interface ExtractionCaseInput {
  complaint?: string;
  age?: string;
  sex?: string;
  diagnosisText: string;
  planText: string;
}

/**
 * 抽取提示词。约束写成硬规则并要求逐字摘取，
 * 但真正的防线是 buildExtractedAnswer 的子串校验——提示词只降低丢弃率，不承担正确性。
 */
export function buildExtractionPrompt(input: ExtractionCaseInput): string {
  const stem = [
    input.age ? `年龄：${input.age}` : null,
    input.sex ? `性别：${input.sex}` : null,
    input.complaint ? `主诉：${input.complaint}` : null,
  ].filter(Boolean).join('\n');
  return [
    '你是医学文本整理助手。下面是教师提供的一份儿科住院病历原件节选，以及本例的题目信息。',
    '任务：从原件里**逐字摘取**诊断条目与处理要点，只做切分与归类。',
    '',
    '硬性规则：',
    '1. 只允许摘取原件里已经存在的字，禁止改写、翻译、补全、推断、合并或新增任何医学内容。',
    '2. 原件可能同时含「入院诊断」与「出院诊断」，两者都要摘出来，不要合并成一条。',
    '3. 一行里若有「1.xxx2.yyy」这类行内编号，拆成多条，每条仍是原文逐字片段（编号本身可保留）。',
    '4. 「出院情况」「查体」「诊疗经过」等叙述段不是诊断，不要放进 diagnoses。',
    '5. management 只摘处理措施片段（如用药、降颅压、止惊、支持治疗等原文词组），每条不超过 60 字，不要整段复制。',
    '6. 原件没有的内容一律留空数组，不要为了凑数编造。',
    '',
    '输出：严格 JSON，不要解释、不要代码围栏，形如',
    '{"diagnoses":["原文片段","原文片段"],"management":["原文片段"]}',
    '',
    stem ? `【题目信息】\n${stem}\n` : '',
    `【原件·诊断段】\n${input.diagnosisText}\n`,
    `【原件·诊疗计划段】\n${input.planText}`,
  ].join('\n');
}
