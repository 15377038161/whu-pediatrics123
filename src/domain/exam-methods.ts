import { SUPINE_ONLY_PARTS } from '@/domain/exam-regions';

/** 将源记录按检查方法分开；结果始终为原始片段，不合成正常结论。 */

/** 淋巴结/肿块触诊的主命中：明确淋巴结记录，或特定部位的可触及肿块/结节/肿大。 */
const LYMPH_MAIN = /淋巴结|(?:枕部|颌下|耳后|耳前|腋下|腹股沟|颈部|锁骨上|腘窝)[^，。]{0,12}(?:肿块|结节|肿大)/;
/** 淋巴结/肿块的续段描述（大小、质地、活动度、融合、触痛、边界）。
 *  仅在紧接主命中、且该片段不属于任何其他查体规则时吸收，避免跨器官串味。 */
const LYMPH_CONTINUATION = /^大小|约?\d+(?:\.\d+)?\s*[*×xX]\s*\d|质\s*[硬韧中软]|活动|固定|融合|触痛|压痛|边界|表面|光滑/;
/** 阴性淋巴结记录（未扪及/未触及/无肿大）不吸收续段：其后片段属于其他器官。 */
const LYMPH_NEGATIVE = /未扪及|未触及|未及|无肿大|不大/;

/** 其他查体规则的主关键词；命中即归属该查体，淋巴结续段吸收不得越过。 */
const OTHER_EXAM_MARKERS = /体温|\bT\s*[:：]?\s*\d|spo[₂2]|血氧|氧饱和度|\bBP|血压|呼吸音|啰音|罗音|哮鸣音|痰鸣音|心音|心律|杂音|震颤|语颤|口|咽|扁桃体|舌|牙龈|黏膜|唇|前囟|颅|头围|瞳孔|眼|结膜|巩膜|鼓膜|外耳道|耳|鼻|颈|甲状腺|气管|皮肤|黄染|黄疸|皮疹|出血点|瘀点|瘀斑|紫癜|咖啡斑|精神|神志|神清|嗜睡|昏睡|昏迷|意识|面色|青紫|反应|胸廓|三凹征|胸壁|呼吸费力|气促|乳房|乳晕|乳核|Tanner|腹|脐|反跳痛|肌紧张|肝|脾|腹股沟|疝|阴囊|睾丸|移动.{0,2}浊音|叩诊|鼓音|肠鸣音|四肢|双下肢|双上肢|肢体|关节|脊柱|指甲|甲床|杵状|反射|肌张力|肌力|抽搐|惊厥|瘫痪|神经|巴氏|巴宾斯基|克氏|布氏|水肿/i;

const MOUTH_MAIN = /口|咽|扁桃体|舌|牙龈|黏膜|疱疹|溃疡|鹅口疮|Koplik/i;
/** 仅吸收紧跟口咽原文的分度、侧别与局部分泌物续段，不跨到其他器官。 */
const MOUTH_CONTINUATION = /^(?:表面|左侧|右侧|双侧|可见|伴|充血|肿胀|无(?:脓|溃疡|疱疹|斑膜)|有(?:脓|溃疡|疱疹|斑膜)|[ⅠⅡⅢ]+度)/;
const MOUTH_BOUNDARY = /^(?:双?肺|心|腹|皮肤|精神|结膜|巩膜|颈|四肢|神经|鼻|耳|眼|前囟|血压|体温|血氧)/;

/** 腹部触诊/叩诊的关键词（压痛、叩诊）是裸词，必须挡掉带其他部位标记的片段，
 *  否则「棘突压痛」「膝关节压痛」「右下肺叩诊浊音」会串进腹部结果。 */
const NON_ABDOMINAL_SITE = /棘突|脊柱|腰骶|关节|肢体|四肢|胸|肺|心|乳房|颈|咽|扁桃|耳|眼|鼻|唇|睾丸|阴囊|颅|前囟/;

/** 只取该片段自己的原文；已被淋巴结触诊吸收的片段不再进入其他查体结果。 */
function pick(parts: string[], pattern: RegExp, absorbed: ReadonlySet<number>, exclude?: RegExp): string {
  return parts
    .filter((part, index) => pattern.test(part) && !absorbed.has(index) && !(exclude && exclude.test(part)))
    .join('，');
}

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
  const mouthContinuations = new Set<number>();
  for (let i = 0; i < parts.length; i += 1) {
    if (!MOUTH_MAIN.test(parts[i]) || absorbed.has(i)) continue;
    for (let j = i + 1; j < parts.length; j += 1) {
      const next = parts[j].trim();
      if (absorbed.has(j) || MOUTH_BOUNDARY.test(next) || !MOUTH_CONTINUATION.test(next)) break;
      absorbed.add(j);
      mouthContinuations.add(j);
    }
  }
  const snippets = (pattern: RegExp, exclude?: RegExp) => pick(parts, pattern, absorbed, exclude);
  const mouthSnippets = () => parts
    .filter((part, index) => (MOUTH_MAIN.test(part) && !absorbed.has(index)) || mouthContinuations.has(index))
    .join('，');
  return [
    // 头面颈部
    ['thermometer', 'forehead', '体温测量', snippets(/体温|\bT\s*[:：]?\s*\d/i)],
    ['inspection', 'forehead', '头颅与前囟视诊', snippets(/前囟|颅|头颅|方颅|颅骨软化/)],
    ['measuring-tape', 'forehead', '头围测量', snippets(/头围/)],
    ['flashlight', 'eyes', '眼部与瞳孔检查', snippets(/眼|结膜|巩膜|瞳孔|对光反射|光反射/, LYMPH_MAIN)],
    ['otoscope', 'ears', '耳镜检查', snippets(/鼓膜|外耳道|耳|听力/, LYMPH_MAIN)],
    ['inspection', 'nose', '鼻部视诊', snippets(/鼻/, LYMPH_MAIN)],
    ['tongue-depressor', 'mouth', '口咽检查', mouthSnippets()],
    ['inspection', 'neck', '颈部视诊', snippets(/颈[^，。]{0,3}(软|僵|抵抗|强直)|无抵抗|颈静脉|气管/)],
    ['palpation', 'neck', '颈部触诊', snippets(/甲状腺|颈[^，。]{0,4}(肿块|包块|压痛)/)],
    ['palpation', 'lymph-nodes', '浅表淋巴结触诊', parts.filter((part, index) => absorbed.has(index) || LYMPH_MAIN.test(part)).join('，')],
    // 胸部
    ['inspection', 'chest', '胸部视诊', snippets(/胸廓|三凹征|胸壁|呼吸费力|呼吸(?:稍|急)?促|气促|肋间隙|桶状胸|赫氏沟|串珠/i)],
    ['palpation', 'chest', '胸部触诊', snippets(/胸壁[^，。]{0,5}压痛|震颤|语颤|皮下气肿|握雪感/)],
    ['percussion', 'chest', '胸部叩诊', snippets(/胸[^，。]{0,4}叩诊|叩诊[^，。]{0,4}(胸|肺)|肺[^，。]{0,3}叩诊/)],
    ['stethoscope', 'chest-lung', '肺部听诊', snippets(/呼吸音|啰音|罗音|哮鸣音|痰鸣音|喘鸣|肺/)],
    ['stethoscope', 'chest-heart', '心脏听诊', snippets(/心音|心律|杂音|心率|心界|奔马律|早搏|心前区/, /血管杂音|肠鸣/)],
    ['inspection', 'breast', '乳房与青春发育视诊', snippets(/乳房[^，。]{0,6}发育|乳晕|Tanner|性征|青春期/i)],
    ['palpation', 'breast', '乳房触诊', snippets(/乳房[^，。]{0,8}结节|乳核|乳房[^，。]{0,5}(压痛|质)/)],
    // 腹部
    ['inspection', 'abdomen', '腹部视诊', snippets(/腹[^，。]{0,3}(胀|平坦|膨隆|凹陷)|腹型|脐|胃肠型|蠕动波/)],
    ['palpation', 'abdomen', '腹部触诊', snippets(/压痛|反跳痛|肌\s*稍?\s*紧张|腹\s*稍?\s*(软|硬|紧张)|腹[^，。]{0,3}(软|硬)|包块|腹部触诊/, NON_ABDOMINAL_SITE)],
    ['percussion', 'abdomen', '腹部叩诊', snippets(/移动[^，。]{0,2}浊音|叩诊|鼓音/, /胸|肺|心/)],
    ['stethoscope', 'abdomen', '腹部听诊', snippets(/肠鸣音|血管杂音|肠鸣/)],
    ['palpation', 'liver-spleen', '肝脾触诊', snippets(/肝[^，。]{0,4}(肋下|肿大|不大|未及|未触及|触诊|质)|脾[^，。]{0,4}(肋下|肿大|不大|未及|未触及|触诊|质)|肝脾/)],
    ['palpation', 'groin', '腹股沟与外生殖器触诊', snippets(/腹股沟[^，。]{0,8}(肿块|结节|肿大|压痛|疝)|疝|阴囊|睾丸/)],
    // 四肢与神经
    ['inspection', 'limbs', '四肢视诊', snippets(/四肢|双下肢|双上肢|肢体/, /反射|肌张力|肌力|神经/)],
    ['palpation', 'limbs', '四肢触诊', snippets(/凹陷性水肿|肢体温度|末梢[^，。]{0,3}(凉|冷|温)|毛细血管充盈|桡动脉|足背动脉/)],
    ['palpation', 'joints', '关节触诊', snippets(/关节|浮髌/)],
    ['inspection', 'spine', '脊柱视诊', snippets(/脊柱|脊背|侧弯|后凸|前凸|腰骶|棘突/, /压痛|叩击痛/)],
    ['palpation', 'spine', '脊柱触诊', snippets(/棘突[^，。]{0,4}(压痛|叩击痛)|脊柱[^，。]{0,4}(压痛|叩痛|叩击痛)|腰骶[^，。]{0,4}(压痛|凹陷|包块)/)],
    ['reflex-hammer', 'neuro', '神经系统与反射检查', snippets(/腱反射|膝反射|踝反射|腹壁反射|提睾反射|病理反射|巴氏|巴宾斯基|Babinski|病理征|脑膜刺激征|克氏|布氏|神经系统|肌力|肌张力|(?:拥抱|吸吮|握持|觅食|颈肢|抬颈|原始)反射/i)],
    // 皮肤与全身
    ['inspection', 'skin', '皮肤与黄疸视诊', snippets(/皮肤|黄染|黄疸|皮疹|出血点|瘀点|瘀斑|紫癜|湿疹|荨麻疹|苍白|发绀|青紫|花斑|弹性|面色|咖啡斑/, /巩膜/)],
    ['inspection', 'general-state', '一般状态与精神反应', snippets(/精神|神志|神清|嗜睡|昏睡|昏迷|烦躁|萎靡|意识|反应|哭闹|呻吟|营养状况|一般状态/)],
    ['inspection', 'nails', '指甲与甲床视诊', snippets(/指甲|甲床|杵状|指端|趾端/)],
    // 生命体征
    ['bp-cuff', 'upper-arm', '血压测量', snippets(/\bBP|血压/i)],
    ['oximeter', 'finger', '血氧监测', snippets(/spo[₂2]|血氧|氧饱和度/i)],
  ];
}

export type ExamPosture = 'standing' | 'supine';
/** 历史事件未带姿势时不改写原始记录；新请求腹部类检查必须明确仰卧。 */
export function postureAllows(bodyPart: string, posture?: ExamPosture): boolean {
  const requiresSupine = SUPINE_ONLY_PARTS.has(bodyPart)
    || bodyPart.startsWith('abdomen-')
    || bodyPart === 'umbilicus'
    || bodyPart === 'external-genitalia';
  return !posture || !requiresSupine || posture === 'supine';
}
