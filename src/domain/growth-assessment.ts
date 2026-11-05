/**
 * 生长发育评估（双向）：按年龄推算典型体格指标并给出手算过程，或按实测值反推月龄区间。
 *
 * 口径：人卫《儿科学》教材的体格生长规律与常用估算公式（确定性计算，不经模型）。
 * 这不是标准差曲线：教材公式是粗略估算，个体评估须用同性别年龄别标准差曲线与骨龄。
 * 超出教材公式适用范围（>10 岁青春期突增）与超出锚点范围的实测值一律类型化拒绝，不外推。
 */

export const GROWTH_DISCLAIMER =
  '本页为教学评估工具：输出教材口径的估算公式、典型值与手算过程，用于执业医师实践技能考试第二站的生长发育评估训练，不作为个体患儿的诊断或营养评定依据；实际评估须使用同性别年龄别标准差曲线（WHO / 中国九市）并结合骨龄与营养状况。';

/** 教材线性公式与典型值适用上限：10 岁以后进入青春期突增，不外推。 */
export const GROWTH_AGE_MONTHS_MAX = 120;

export type GrowthRejectionCode = 'INVALID_INPUT' | 'AGE_OUT_OF_RANGE' | 'VALUE_OUT_OF_RANGE' | 'UNKNOWN_MEASUREMENT';

export type GrowthMetric = {
  kind: string;
  label: string;
  typical: string;
  /** 教材线性公式的估算值；与 typical（锚点内插典型值）并列展示，用于讲清公式是粗略估算。 */
  estimate?: string;
  formula?: string;
  steps: string[];
  note?: string;
};

export type Milestone = { ageMonths: number; ageLabel: string; motor: string; language: string };

export type GrowthAssessment = {
  ok: true;
  ageMonths: number;
  ageLabel: string;
  metrics: GrowthMetric[];
  milestones: Milestone[];
  warnings: string[];
  disclaimer: string;
};

export type GrowthRejection = { ok: false; code: GrowthRejectionCode; reason: string; disclaimer: string };
export type GrowthResult = GrowthAssessment | GrowthRejection;

export type InferenceKind = 'weight' | 'height' | 'head' | 'teeth';
export type AgeInference = {
  ok: true;
  kind: InferenceKind;
  label: string;
  value: number;
  band: { min: number; max: number };
  estimatedMonths: number;
  formula?: string;
  steps: string[];
  disclaimer: string;
};
export type InferenceResult = AgeInference | GrowthRejection;

export const GROWTH_ANCHORS = [
  { ageMonths: 0, weightKg: 3.3, heightCm: 50, headCm: 34 },
  { ageMonths: 3, weightKg: 6.5, heightCm: 62, headCm: 40 },
  { ageMonths: 6, weightKg: 7.5, heightCm: 67, headCm: 44 },
  { ageMonths: 12, weightKg: 9.5, heightCm: 75, headCm: 46 },
  { ageMonths: 24, weightKg: 12, heightCm: 87, headCm: 48 },
  { ageMonths: 36, weightKg: 14, heightCm: 96, headCm: 49 },
  { ageMonths: 48, weightKg: 16, heightCm: 103, headCm: 49.5 },
  { ageMonths: 60, weightKg: 18, heightCm: 110, headCm: 50 },
  { ageMonths: 72, weightKg: 20, heightCm: 117, headCm: 51 },
  { ageMonths: 84, weightKg: 22, heightCm: 122, headCm: 51.5 },
  { ageMonths: 96, weightKg: 24, heightCm: 128, headCm: 52 },
  { ageMonths: 108, weightKg: 26, heightCm: 134, headCm: 52.5 },
  { ageMonths: 120, weightKg: 28, heightCm: 140, headCm: 53 },
];

export const MOTOR_MNEMONIC = '二抬四翻六会坐，七滚八爬周会走';

export const MILESTONES: Milestone[] = [
  { ageMonths: 2, ageLabel: '2 个月', motor: '俯卧抬头', language: '发喉音' },
  { ageMonths: 4, ageLabel: '4 个月', motor: '翻身', language: '咿呀发音、大笑' },
  { ageMonths: 6, ageLabel: '6 个月', motor: '双手前撑独坐片刻', language: '发单音' },
  { ageMonths: 8, ageLabel: '8 个月', motor: '会爬、会翻身', language: '无意识发「爸爸」「妈妈」复音' },
  { ageMonths: 12, ageLabel: '12 个月', motor: '独走', language: '有意识叫爸爸妈妈、说单词' },
  { ageMonths: 15, ageLabel: '15 个月', motor: '独走稳、能蹲', language: '说单词句、能指身体部位' },
  { ageMonths: 18, ageLabel: '18 个月', motor: '会跑、扶栏上楼', language: '说 10–20 个词、会指图' },
  { ageMonths: 24, ageLabel: '2 岁', motor: '双脚跳、自己用勺吃饭', language: '说简单句（2–3 个词）' },
  { ageMonths: 36, ageLabel: '3 岁', motor: '骑三轮车、会洗手', language: '说复杂句、会数数' },
  { ageMonths: 48, ageLabel: '4 岁', motor: '单脚跳、会穿衣', language: '讲故事、认字' },
  { ageMonths: 60, ageLabel: '5 岁', motor: '跳绳、会用筷子', language: '追问为什么、能叙述简单情节' },
];

export const FONTANEL_FACTS = '前囟出生时约 1.5–2.0 cm（对边中点连线），12–18 个月闭合；后囟出生时已很小或已闭，最迟 6–8 周闭合；颅骨缝 3–4 个月闭合。前囟早闭见于小头畸形，晚闭见于佝偻病、先天性甲状腺功能减低症；饱满提示颅内压增高，凹陷提示脱水。';
export const UPPER_ARM_FACTS = '上臂围 1 岁内约 12–15 cm，1–5 岁共增长 1–2 cm。5 岁以下筛查口径：>13.5 cm 营养良好，12.5–13.5 cm 中等，<12.5 cm 营养不良。';

function reject(code: GrowthRejectionCode, reason: string): GrowthRejection {
  return { ok: false, code, reason, disclaimer: GROWTH_DISCLAIMER };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function num(value: number): string {
  return String(round1(value));
}

export function ageLabel(ageMonths: number): string {
  const years = Math.floor(ageMonths / 12);
  const rest = Math.round(ageMonths % 12);
  if (years === 0) return `${ageMonths} 个月`;
  if (rest === 0) return `${years} 岁`;
  return `${years} 岁 ${rest} 个月`;
}

function weightMetric(ageMonths: number): GrowthMetric {
  const typical = `${num(interpolateAnchor(ageMonths, 'weightKg'))} kg`;
  if (ageMonths <= 6) {
    const computed = 3.3 + ageMonths * 0.7;
    const anchor = interpolateAnchor(ageMonths, 'weightKg');
    const deviation = Math.abs(computed - anchor);
    return {
      kind: 'weight',
      label: '体重',
      typical,
      estimate: `${num(computed)} kg`,
      formula: '1–6 个月：体重(kg) = 出生体重 + 月龄 × 0.7',
      steps: [
        `月龄 ${ageMonths} 个月 → 适用 1–6 个月公式`,
        `按出生体重 3.3 kg 代入：3.3 + ${ageMonths} × 0.7 = ${num(computed)} kg`,
        `教材锚点典型值 ${typical}（3 个月时约为出生体重的 2 倍，6–7 kg）`,
        deviation >= 0.05 ? `公式估算与典型值相差 ${num(deviation)} kg → 判读以典型值与标准差曲线为准` : '',
      ].filter(Boolean) as string[],
      note: '出生体重按足月均值 3.3 kg（男 3.3±0.4、女 3.2±0.4）代入；实测时须用患儿本人出生体重。公式为粗略估算，1–3 个月常低于实测均值。',
    };
  }
  if (ageMonths <= 12) {
    const computed = 6 + ageMonths * 0.25;
    return {
      kind: 'weight',
      label: '体重',
      typical,
      estimate: `${num(computed)} kg`,
      formula: '7–12 个月：体重(kg) = 6 + 月龄 × 0.25',
      steps: [
        `月龄 ${ageMonths} 个月 → 适用 7–12 个月公式`,
        `6 + ${ageMonths} × 0.25 = ${num(computed)} kg`,
        `教材锚点典型值 ${typical}（1 岁时约为出生体重的 3 倍，9–10 kg）`,
      ],
      note: '公式为粗略估算，与教材典型值可差约 0.5 kg；判读以标准差曲线为准。',
    };
  }
  if (ageMonths <= GROWTH_AGE_MONTHS_MAX) {
    const years = ageMonths / 12;
    const computed = years * 2 + 8;
    return {
      kind: 'weight',
      label: '体重',
      typical,
      estimate: `${num(computed)} kg`,
      formula: '2–12 岁：体重(kg) = 年龄(岁) × 2 + 8',
      steps: [
        `月龄 ${ageMonths} 个月 = ${num(years)} 岁 → 适用 2–12 岁公式`,
        `${num(years)} × 2 + 8 = ${num(computed)} kg`,
        `教材锚点典型值 ${typical}（2 岁时约为出生体重的 4 倍，12 kg）`,
      ],
      note: '青春期前适用；进入青春期后个体差异显著，须按性别与 Tanner 分期评估。',
    };
  }
  return { kind: 'weight', label: '体重', typical, steps: ['超出教材公式适用范围'] };
}

function heightMetric(ageMonths: number): GrowthMetric {
  const typical = `${num(interpolateAnchor(ageMonths, 'heightCm'))} cm`;
  if (ageMonths <= 24) {
    return {
      kind: 'height',
      label: '身高（身长）',
      typical,
      steps: [
        '出生时身长约 50 cm',
        '前 3 个月增长 11–13 cm，约等于后 9 个月的增长量',
        ageMonths >= 12 ? '1 岁时约 75 cm（出生时的 1.5 倍）' : `月龄 ${ageMonths} 个月 → 按教材锚点内插得 ${typical}`,
        ageMonths >= 24 ? '2 岁时约 87 cm（出生时的 1.75 倍）' : '',
      ].filter(Boolean) as string[],
      note: '2 岁以下用卧位量床测身长，2 岁及以上立位测身高，两者相差约 1 cm。',
    };
  }
  const years = ageMonths / 12;
  const useLate = ageMonths > 72;
  const formula = useLate ? '7–10 岁：身高(cm) = 年龄(岁) × 6 + 80' : '2–6 岁：身高(cm) = 年龄(岁) × 7 + 75';
  const computed = useLate ? years * 6 + 80 : years * 7 + 75;
  return {
    kind: 'height',
    label: '身高（身长）',
    typical,
    estimate: `${num(computed)} cm`,
    formula,
    steps: [
      `月龄 ${ageMonths} 个月 = ${num(years)} 岁 → 适用 ${useLate ? '7–10 岁' : '2–6 岁'}公式`,
      `${num(years)} × ${useLate ? 6 : 7} + ${useLate ? 80 : 75} = ${num(computed)} cm`,
      `教材锚点典型值 ${typical}（2 岁以上公式与锚点基本吻合）`,
    ],
    note: '公式为粗略估算；10 岁以后进入青春期突增，线性公式不再适用。',
  };
}

function headMetric(ageMonths: number): GrowthMetric {
  return {
    kind: 'head',
    label: '头围',
    typical: `${num(interpolateAnchor(ageMonths, 'headCm'))} cm`,
    steps: [
      '出生时头围约 33–34 cm',
      '3 个月约 40 cm，1 岁约 46 cm，2 岁约 48 cm',
      '5 岁约 50 cm，15 岁约 54–58 cm（接近成人）',
      `月龄 ${ageMonths} 个月 → 教材锚点内插典型值 ${num(interpolateAnchor(ageMonths, 'headCm'))} cm`,
    ],
    note: '1 岁内头围增长最快，前 3 个月的增长量约等于后 9 个月；过大提示脑积水，过小提示小头畸形。',
  };
}

function chestMetric(ageMonths: number): GrowthMetric {
  const head = interpolateAnchor(ageMonths, 'headCm');
  if (ageMonths < 12) {
    return {
      kind: 'chest',
      label: '胸围',
      typical: ageMonths === 0 ? '约 32 cm' : `${num(head - 1)}–${num(head)} cm`,
      steps: ['出生时胸围约 32 cm，比头围小 1–2 cm', `月龄 ${ageMonths} 个月 → 仍小于或接近头围 ${num(head)} cm`],
      note: '1 岁时胸围约等于头围，此为交叉点。',
    };
  }
  const years = ageMonths / 12;
  return {
    kind: 'chest',
    label: '胸围',
    typical: `约 ${num(head + Math.max(0, years - 1))} cm`,
    estimate: `${num(head + Math.max(0, years - 1))} cm`,
    formula: '1 岁后：胸围 ≈ 头围 + (年龄岁数 − 1)',
    steps: [
      `1 岁时胸围 ≈ 头围（约 46 cm），此后胸围超过头围`,
      `${num(head)} cm + (${num(years)} − 1) = ${num(head + Math.max(0, years - 1))} cm`,
    ],
    note: '胸围过小提示营养不良或胸廓发育异常。',
  };
}

function teethMetric(ageMonths: number): GrowthMetric {
  const min = Math.max(0, Math.min(20, ageMonths - 6));
  const max = Math.max(0, Math.min(20, ageMonths - 4));
  const typical = ageMonths <= 5 ? '尚未萌出或刚萌出（乳牙 4–10 个月开始萌出）'
    : ageMonths >= 30 ? '乳牙 20 颗已出齐'
    : `约 ${min === max ? max : `${min}–${max}`} 颗`;
  return {
    kind: 'teeth',
    label: '牙齿',
    typical,
    formula: '乳牙数 ≈ 月龄 − (4~6)',
    steps: [
      `月龄 ${ageMonths} 个月 → ${ageMonths} − 6 = ${ageMonths - 6}，${ageMonths} − 4 = ${ageMonths - 4}`,
      `取 0–20 颗区间 → ${typical}`,
      '乳牙 4–10 个月开始萌出，20–30 个月出齐 20 颗',
      ageMonths >= 72 ? '6 岁左右第一恒磨牙（六龄牙）萌出，7–8 岁开始按顺序替换乳牙，12 岁出第二恒磨牙' : '',
    ].filter(Boolean) as string[],
    note: '出牙延迟（>13 个月未萌出）见于佝偻病、先天性甲状腺功能减低症、营养不良等。',
  };
}

function fontanelMetric(ageMonths: number): GrowthMetric {
  return {
    kind: 'fontanel',
    label: '前囟与颅骨缝',
    typical: ageMonths < 12 ? '前囟未闭（约 1.5–2.0 cm 起逐渐缩小）' : ageMonths <= 18 ? '前囟正在闭合（12–18 个月闭合）' : '前囟已闭合',
    steps: [
      `月龄 ${ageMonths} 个月 → ${ageMonths < 12 ? '前囟应仍未闭合' : ageMonths <= 18 ? '处于闭合窗口' : '应已闭合'}`,
      '后囟最迟 6–8 周闭合，颅骨缝 3–4 个月闭合',
    ],
    note: FONTANEL_FACTS,
  };
}

function upperArmMetric(ageMonths: number): GrowthMetric {
  return {
    kind: 'upper-arm',
    label: '上臂围',
    typical: ageMonths < 12 ? '约 12–15 cm' : ageMonths <= 60 ? '约 13.5–16 cm（1–5 岁共增长 1–2 cm）' : '按实测值与营养筛查口径判读',
    steps: [`月龄 ${ageMonths} 个月 → 参照 1 岁内 12–15 cm、1–5 岁共增长 1–2 cm 的教材口径`],
    note: UPPER_ARM_FACTS,
  };
}

/** 典型值按同一套锚点线性内插，保证与 inferAgeFromGrowth 的反推口径互洽。 */
function interpolateAnchor(ageMonths: number, key: 'weightKg' | 'heightCm' | 'headCm'): number {
  const last = GROWTH_ANCHORS[GROWTH_ANCHORS.length - 1];
  if (ageMonths <= GROWTH_ANCHORS[0].ageMonths) return GROWTH_ANCHORS[0][key];
  if (ageMonths >= last.ageMonths) return last[key];
  for (let i = 0; i < GROWTH_ANCHORS.length - 1; i += 1) {
    const lower = GROWTH_ANCHORS[i];
    const upper = GROWTH_ANCHORS[i + 1];
    if (ageMonths > upper.ageMonths) continue;
    const span = upper.ageMonths - lower.ageMonths;
    const ratio = span === 0 ? 0 : (ageMonths - lower.ageMonths) / span;
    return lower[key] + ratio * (upper[key] - lower[key]);
  }
  return last[key];
}

export function assessGrowth(input: { ageMonths: number }): GrowthResult {
  if (!Number.isFinite(input.ageMonths)) {
    return reject('INVALID_INPUT', '月龄必须是有效数字，不接受空值、NaN 或无穷大。');
  }
  const ageMonths = Math.round(input.ageMonths);
  if (ageMonths < 0) return reject('AGE_OUT_OF_RANGE', `月龄 ${ageMonths} 个月非法：不接受负数。`);
  if (ageMonths > GROWTH_AGE_MONTHS_MAX) {
    return reject(
      'AGE_OUT_OF_RANGE',
      `月龄 ${ageMonths} 个月（${ageLabel(ageMonths)}）已进入青春期生长突增期：教材线性公式与典型值不适用，须按性别、Tanner 分期与骨龄评估，本工具不外推。`,
    );
  }
  const warnings: string[] = [
    '教材公式与典型值为群体粗略估算，个体判读须用同性别年龄别标准差曲线，并核对实测值的测量方法（身长卧位 / 身高立位相差约 1 cm）。',
  ];
  if (ageMonths >= 96) warnings.push('已接近 10 岁，公式估算误差增大；青春期启动早晚可使身高体重显著偏离公式值。');
  return {
    ok: true,
    ageMonths,
    ageLabel: ageLabel(ageMonths),
    metrics: [
      weightMetric(ageMonths),
      heightMetric(ageMonths),
      headMetric(ageMonths),
      chestMetric(ageMonths),
      teethMetric(ageMonths),
      fontanelMetric(ageMonths),
      upperArmMetric(ageMonths),
    ],
    milestones: MILESTONES.filter((item) => item.ageMonths <= ageMonths).slice(-3),
    warnings,
    disclaimer: GROWTH_DISCLAIMER,
  };
}

const INFERENCE_LABELS: Record<Exclude<InferenceKind, 'teeth'>, { label: string; unit: string; key: 'weightKg' | 'heightCm' | 'headCm' }> = {
  weight: { label: '体重', unit: 'kg', key: 'weightKg' },
  height: { label: '身高（身长）', unit: 'cm', key: 'heightCm' },
  head: { label: '头围', unit: 'cm', key: 'headCm' },
};

/** 反向推断：按实测体格值在教材锚点间线性内插得到月龄区间；乳牙数按「月龄 − 4~6」反解。 */
export function inferAgeFromGrowth(input: { kind: string; value: number }): InferenceResult {
  if (!Number.isFinite(input.value)) {
    return reject('INVALID_INPUT', '实测值必须是有效数字，不接受空值、NaN 或无穷大。');
  }
  if (input.kind === 'teeth') {
    const teeth = Math.trunc(input.value);
    if (teeth < 0 || teeth > 20) return reject('VALUE_OUT_OF_RANGE', `乳牙数 ${teeth} 颗超出 0–20 颗范围（乳牙共 20 颗）。`);
    if (teeth === 0) {
      return {
        ok: true, kind: 'teeth', label: '乳牙数', value: teeth,
        band: { min: 0, max: 10 }, estimatedMonths: 6,
        formula: '乳牙数 ≈ 月龄 − (4~6)',
        steps: ['尚未见乳牙萌出', '乳牙正常于 4–10 个月开始萌出，故月龄多 ≤10 个月', '若 >13 个月仍未萌出，属出牙延迟，需查佝偻病、先天性甲状腺功能减低症、营养不良'],
        disclaimer: GROWTH_DISCLAIMER,
      };
    }
    if (teeth >= 20) {
      return {
        ok: true, kind: 'teeth', label: '乳牙数', value: teeth,
        band: { min: 24, max: 30 }, estimatedMonths: 30,
        formula: '乳牙数 ≈ 月龄 − (4~6)',
        steps: ['乳牙 20 颗已出齐', '乳牙于 20–30 个月出齐，故月龄约 24–30 个月', '出齐后不再随月龄增加，反推到此为止；6 岁左右开始萌出第一恒磨牙'],
        disclaimer: GROWTH_DISCLAIMER,
      };
    }
    return {
      ok: true, kind: 'teeth', label: '乳牙数', value: teeth,
      band: { min: teeth + 4, max: teeth + 6 }, estimatedMonths: teeth + 5,
      formula: '乳牙数 ≈ 月龄 − (4~6)',
      steps: [`乳牙 ${teeth} 颗 → 月龄 ≈ ${teeth} + (4~6)`, `即 ${teeth + 4}–${teeth + 6} 个月（约 ${ageLabel(teeth + 5)}）`, '出牙个体差异大，反推结果为粗略区间，须与体重身高一并判读'],
      disclaimer: GROWTH_DISCLAIMER,
    };
  }

  const spec = INFERENCE_LABELS[input.kind as Exclude<InferenceKind, 'teeth'>];
  if (!spec) {
    return reject('UNKNOWN_MEASUREMENT', `未收录的推断指标「${String(input.kind)}」：只支持 weight（kg）、height（cm）、head（cm）、teeth（乳牙颗数）。`);
  }
  if (input.value <= 0) {
    return reject('VALUE_OUT_OF_RANGE', `${spec.label} ${input.value} ${spec.unit} 非法：须为大于 0 的实测值。`);
  }
  const values = GROWTH_ANCHORS.map((anchor) => anchor[spec.key]);
  const first = values[0];
  const last = values[values.length - 1];
  if (input.value < first) {
    return reject('VALUE_OUT_OF_RANGE', `${spec.label} ${num(input.value)} ${spec.unit} 低于出生时典型值 ${num(first)} ${spec.unit}：不做外推，请先核对测量与记录单位。`);
  }
  if (input.value > last) {
    return reject('VALUE_OUT_OF_RANGE', `${spec.label} ${num(input.value)} ${spec.unit} 高于 10 岁典型值 ${num(last)} ${spec.unit}：已进入青春期突增范围，教材锚点不适用，不做外推。`);
  }
  for (let i = 0; i < values.length - 1; i += 1) {
    if (input.value > values[i + 1]) continue;
    const lower = GROWTH_ANCHORS[i];
    const upper = GROWTH_ANCHORS[i + 1];
    const ratio = values[i + 1] === values[i] ? 0 : (input.value - values[i]) / (values[i + 1] - values[i]);
    const estimated = Math.round(lower.ageMonths + ratio * (upper.ageMonths - lower.ageMonths));
    return {
      ok: true,
      kind: input.kind as InferenceKind,
      label: spec.label,
      value: input.value,
      band: { min: lower.ageMonths, max: upper.ageMonths },
      estimatedMonths: estimated,
      steps: [
        `实测${spec.label} ${num(input.value)} ${spec.unit}`,
        `落在教材锚点 ${lower.ageMonths} 个月（${num(values[i])} ${spec.unit}）与 ${upper.ageMonths} 个月（${num(values[i + 1])} ${spec.unit}）之间`,
        `线性内插：${lower.ageMonths} + (${num(input.value)} − ${num(values[i])}) ÷ (${num(values[i + 1])} − ${num(values[i])}) × ${upper.ageMonths - lower.ageMonths} = ${estimated} 个月`,
        `即约 ${ageLabel(estimated)}（区间 ${ageLabel(lower.ageMonths)}–${ageLabel(upper.ageMonths)}）`,
      ],
      disclaimer: GROWTH_DISCLAIMER,
    };
  }
  return reject('VALUE_OUT_OF_RANGE', `${spec.label} ${num(input.value)} ${spec.unit} 无法在教材锚点间定位，不外推。`);
}
