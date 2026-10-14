/** 将源记录按检查方法分开；结果始终为原始片段，不合成正常结论。 */
export function sourceExamDefinitions(text: string): string[][] {
  const snippets = (pattern: RegExp) => text.split(/[，,；;。\n]/).filter(part => pattern.test(part)).join('，');
  return [
    ['thermometer', 'forehead', '体温测量', snippets(/体温|\bT\s*[:：]?\s*\d/i)],
    ['oximeter', 'finger', '血氧监测', snippets(/spo[₂2]|血氧|氧饱和度/i)],
    ['bp-cuff', 'upper-arm', '血压测量', snippets(/\bBP|血压/i)],
    ['stethoscope', 'chest', '心肺听诊', snippets(/呼吸音|啰音|罗音|哮鸣音|心音|心律|杂音/)],
    ['tongue-depressor', 'mouth', '口咽检查', snippets(/口|咽|扁桃体|舌/)],
    ['flashlight', 'forehead', '头面与瞳孔检查', snippets(/前囟|瞳孔|眼|耳|鼻|头/)],
    ['inspection', 'skin', '皮肤与一般状态视诊', snippets(/皮肤|黄染|皮疹|精神|神清|面色|青紫|反应/)],
    ['inspection', 'chest', '胸部视诊', snippets(/胸廓|三凹征|胸壁|呼吸费力/)],
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
