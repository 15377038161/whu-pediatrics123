import type { Message } from 'coder-coding-dev-sdk';
import { noteReviewSchema, NOTE_TEMPLATE, type NoteContent, type NoteReviewResult } from '@/domain/medical-note';
import type { ReleasedEvidenceSummary } from '@/lib/note-evidence';

/**
 * 批次6·病历 AI 辅助审阅（独立辅助反馈）提示词与结果校验，纯函数可单测。
 *
 * 边界（CASE_WORKFLOW_AND_NOTE_WRITING.md 第4节第3/4/5条）：
 * - AI 建议必须引用学生已写内容或本例已获得的证据，区分漏采与漏写；
 * - 不编造检查结果或临床结论；不输出标准病历整篇或标准答案结论；
 * - AI 审阅给出独立的病历书写评分（100 分），只做教学反馈，不冒充医学审核；
 *   评分不进入临床评分、班级积分或选关逻辑，不修改历史成绩；
 * - 服务异常（failed）不影响提交与教师查看，不因服务异常给零分或全缺。
 */

/** 提示词版本：结构变化必须换版，已落库意见保留原 ai_prompt_version。 */
export const NOTE_REVIEW_PROMPT_VERSION = 'v2';

/** 审阅输入中的标准病历五段（teacher-case-data sections，仅服务端上下文，绝不下发学生）。 */
export interface StandardSectionsInput {
  history: string;
  exam: string;
  tests: string;
  diagnosis: string;
  plan: string;
}

const SYSTEM_PROMPT = `你是儿科临床教学病历审阅助手，负责审阅医学生书写的小儿接诊病历（通用儿科大病历结构），输出结构化 JSON。

# 输入
1. template：病历模板段落（key/label/required）。
2. submittedContent：学生提交的病历内容（模板段键 → 文本）。
3. releasedEvidence：该学生本次接诊实际获得的证据摘要（问诊采集覆盖、查体与检查证据、训练中的最终提交、报告优点与改进点）。
4. standardSections：教师标准病历（仅用于完整性对照，判断「漏采」）。

# 审阅维度
- 完整性：逐段判断 written（已充分书写）/ partial（仅有片段）/ missing（必填或应写而未写）/ not_applicable（本例不适用）。
- 事实一致性：学生病历中的表述与 releasedEvidence 或学生本人在训练中的提交（submissions）矛盾时指出，quote 必须为学生病历原文，evidence 引用 releasedEvidence 中的条目。
- 时间线与逻辑：起病、演变、检查时间点、诊断推理链是否自洽。
- 遗漏：获得而未写（omission_unwritten，依据 releasedEvidence）与未采集（omission_uncollected，依据 standardSections 对照判断）。
- 表达不足：表述含糊、口语化、缺量化等。

# 病历书写评分（独立 100 分）
只评本次提交的病历文本，不评价临床操作、接诊表现或团队协作；分数只用于病历书写教学反馈，不进入临床评分、班级积分或选关。
- 结构完整性（25）：5 个必填段各 3 分，共 15 分；适用的选填段与整体层次共 10 分。不适用段落不扣分；必填段缺失每项扣 3 分。
- 事实准确性（35）：以 releasedEvidence 与学生训练提交为唯一事实依据。与证据矛盾每条扣 8 分；时间线冲突每处扣 4 分；无依据的检查结果或临床结论每处扣 4 分；如实写「未知/未采集」不扣分。最低 0 分。
- 诊断依据（20）：诊断明确 5 分；依据具体且与证据对应 10 分；鉴别诊断合理 5 分。
- 诊疗计划（15）：首要处置 5 分；监测、治疗与复评 6 分；随访、转诊或家长交代 4 分。
- 表达规范（5）：术语准确 3 分；时间点与量化表达清楚 2 分。
- 各维度必须为整数且不超过上限；信息不足时按已写内容保守评分，不因学生无法获得的资料扣分。

# 硬规则
1. 只输出 JSON，不要任何解释性文字或 Markdown。
2. 不编造检查结果或临床结论：建议只能基于学生原文、releasedEvidence 与标准病历对照后的「缺口方向」。
3. 不输出标准病历整篇内容，也不直接给出标准答案结论（如标准诊断名、标准查体发现的完整内容）。漏采提示只写「某类信息未采集」的方向性描述，例如「现病史缺少咳嗽时间特点」而非「标准答案为夜间咳嗽」。
4. 只按上述固定维度给出 writingScore，不冒充医学审核；医学结论由教师复核作出，评分仅用于病历书写教学反馈。
5. 学生无法获得的信息不能成为要求其猜答案的条目；无法判断的内容标注 not_applicable 或不写 issues。
6. suggestion 必须可执行且引用学生已写内容或本例可获得证据；禁止建议学生编造未获得的结果。
7. 对完全未书写且本例不适用的段落，completeness 用 not_applicable，不给 issues。

# 输出 JSON 结构
{
  "summary": "一句话总评（不超过 60 字）",
  "sections": [
    {
      "sectionKey": "模板段 key",
      "completeness": "written | partial | missing | not_applicable",
      "issues": [
        {
          "kind": "inconsistency | omission_unwritten | omission_uncollected | timeline | expression",
          "sectionKey": "模板段 key",
          "quote": "学生病历原文片段（仅 inconsistency/expression 时给）",
          "evidence": "releasedEvidence 中的条目描述（仅 omission_unwritten/inconsistency 时可给）",
          "suggestion": "可执行的修改建议（不包含标准答案结论）"
        }
      ]
    }
  ],
  "notableStrengths": ["值得肯定的书写要点，1-3 条"],
  "writingScore": {
    "structure": 0,
    "accuracy": 0,
    "diagnosis": 0,
    "plan": 0,
    "expression": 0
  }
}`;

export function buildNoteReviewMessages(args: {
  content: NoteContent;
  evidence: ReleasedEvidenceSummary;
  standardSections: StandardSectionsInput;
}): Message[] {
  const userPayload = JSON.stringify(
    {
      template: NOTE_TEMPLATE.map((section) => ({ key: section.key, label: section.label, required: section.required })),
      submittedContent: args.content,
      releasedEvidence: args.evidence,
      standardSections: args.standardSections,
    },
    null,
    2,
  );
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPayload },
  ];
}

/** 解析并校验模型输出：支持裸 JSON 或 Markdown 代码块包裹；失败返回 null（调用方标记 failed）。 */
export function parseNoteReview(text: string): NoteReviewResult | null {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fenced ? fenced[1] : text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return noteReviewSchema.parse(parsed);
  } catch {
    return null;
  }
}
