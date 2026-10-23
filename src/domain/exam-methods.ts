/** 将源记录按检查方法分开；结果始终为原始片段，不合成正常结论。 */

/** 淋巴结/肿块触诊的主命中：明确淋巴结记录，或特定部位的可触及肿块/结节/肿大。 */
const LYMPH_MAIN = /淋巴结|(?:枕部|颌下|腋下|腹股沟|颈部)[^，。]{0,12}(?:肿块|结节|肿大)/;
/** 淋巴结/肿块的续段描述（大小、质地、活动度、融合、触痛、边界）。
 *  仅在紧接主命中、且该片段不属于任何其他查体规则时吸收，避免跨器官串味。 */
const LYMPH_CONTINUATION = /^大小|约?\d+(?:\.\d+)?\s*[*×xX]\s*\d|质\s*[硬韧中软]|活动|固定|融合|触痛|压痛|边界|表面|光滑/;
/** 阴性淋巴结记录（未扪及/未触及/无肿大）不吸收续段：其后片段属于其他器官。 */
const LYMPH_NEGATIVE = /未扪及|未触及|未及|无肿大|不大/;

/** 其他查体规则的主关键词；命中即归属该查体，淋巴结续段吸收不得越过。 */
const OTHER_EXAM_MARKERS = /体温|\bT\s*[:：]?\s*\d|spo[₂2]|血氧|氧饱和度|\bBP|血压|呼吸音|啰音|罗音|哮鸣音|心音|心律|杂音|口|咽|扁桃体|舌|前囟|瞳孔|眼|结膜|巩膜|耳|鼻|头|颈|甲状腺|皮肤|黄染|皮疹|精神|神清|面色|青紫|反应|胸廓|三凹征|胸壁|呼吸费力|乳房|乳晕|Tanner|腹|反跳痛|肌紧张|肝|脾|移动.{0,2}浊音|叩诊|鼓音|肠鸣音|四肢|双下肢|双上肢|肢体|反射|肌张力|神经|巴氏|克氏|布氏|水肿/i;

export function sourceExamDefinitions(text: string): string[][] {
  const parts = text.split(/[，,；;。\n]/);
  /** 已被淋巴结触诊吸收的片段下标；这些片段不再进入其他查体结果。 */
  const absorbed = new Set<number>();
  for (let i = 0; i < parts.length; i += 1) {
    if (!LYMPH_MAIN.test(parts[i]) || LYMPH_NEGATIVE.test(parts[i])) continue;
    absorbed.add(i);
    for (let j = i + 1; j < parts.length; j += 1) {
      const next = parts[j];
      if (!next.trim() || OTHER_EXAM_MARKERS.test(next) || LYMPH_MAIN.test(next) || !LYMPH_CONTINUATION.test(next)) break;
      absorbed.add(j);
    }
  }
  const snippets = (pattern: RegExp) => parts.filter((part, index) => pattern.test(part) && !absorbed.has(index)).join('，');
  return [
    ['thermometer', 'forehead', '体温测量', snippets(/体温|\bT\s*[:：]?\s*\d/i)],
    ['oximeter', 'finger', '血氧监测', snippets(/spo[₂2]|血氧|氧饱和度/i)],
    ['bp-cuff', 'upper-arm', '血压测量', snippets(/\bBP|血压/i)],
    ['stethoscope', 'chest', '心肺听诊', snippets(/呼吸音|啰音|罗音|哮鸣音|心音|心律|杂音/)],
    ['tongue-depressor', 'mouth', '口咽检查', snippets(/口|咽|扁桃体|舌/)],
    ['flashlight', 'forehead', '头面与瞳孔检查', snippets(/前囟|瞳孔|眼|结膜|巩膜|耳|鼻|头/).split('，').filter(part => !LYMPH_MAIN.test(part)).join('，')],
    ['inspection', 'neck', '颈部视诊', snippets(/颈.{0,3}(软|僵|抵抗|强直)|甲状腺|无抵抗/)],
    ['palpation', 'neck', '颈部及浅表淋巴结触诊', parts.filter((part, index) => absorbed.has(index) || LYMPH_MAIN.test(part)).join('，')],
    ['inspection', 'skin', '皮肤与一般状态视诊', snippets(/皮肤|黄染|皮疹|精神|神清|面色|青紫|反应/)],
    ['inspection', 'chest', '胸部视诊', snippets(/胸廓|三凹征|胸壁|呼吸费力|乳房.{0,6}发育|乳晕|Tanner/i)],
    ['palpation', 'chest', '胸部触诊', snippets(/乳房.{0,8}结节|胸壁.{0,5}压痛/)],
    ['inspection', 'abdomen', '腹部视诊', snippets(/腹.{0,3}(胀|平坦|膨隆|凹陷)|腹型/)],
    ['palpation', 'abdomen', '腹部触诊', snippets(/压痛|反跳痛|肌紧张|腹.{0,3}(软|硬)|肝脾|肝.{0,3}肋下|脾.{0,3}肋下/)],
    ['percussion', 'abdomen', '腹部叩诊', snippets(/移动.{0,2}浊音|叩诊|鼓音/)],
    ['stethoscope', 'abdomen', '腹部听诊', snippets(/肠鸣音|血管杂音/)],
    ['inspection', 'limbs', '四肢视诊', snippets(/四肢|双下肢|双上肢|肢体/).split('，').filter(part => !/反射|肌张力|神经/.test(part)).join('，')],
    ['palpation', 'limbs', '四肢触诊', snippets(/凹陷性水肿|肢体温度|末梢.{0,3}(凉|冷|温)|关节.{0,4}压痛/)],
    ['reflex-hammer', 'limbs', '神经反射检查', snippets(/腱反射|膝反射|踝反射|病理反射|巴氏|克氏|布氏/)],
  ];
}

export type ExamPosture = 'standing' | 'supine';
/** 历史事件未带姿势时不改写原始记录；新请求腹部检查必须明确仰卧。 */
export function postureAllows(bodyPart: string, posture?: ExamPosture): boolean {
  return !posture || bodyPart !== 'abdomen' || posture === 'supine';
}
