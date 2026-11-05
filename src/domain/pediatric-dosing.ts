/**
 * 儿科用药剂量教学计算器（确定性计算，不经模型）。
 *
 * 口径来源：各药品中国上市药品说明书的儿童剂量项，以及《儿科学》教材维生素D缺乏性佝偻病
 * 防治剂量。输出是「教学计算」范围与手算过程，不是处方。
 * 安全红线：未收录的药品、越界的体重月龄、被禁用的情形一律类型化拒绝，绝不外推或猜测剂量。
 */

export const DOSING_DISCLAIMER =
  '本页面为教学计算工具：输出教材与说明书口径的剂量范围与手算过程，不构成处方。实际用药须核对最新药品说明书、患儿肝肾功能与过敏史，并由执业医师决定。';

export const GENERAL_SAFETY_NOTES: string[] = [
  '儿童禁用阿司匹林退热：病毒感染期使用与瑞氏综合征（Reye syndrome）相关，退热只用对乙酰氨基酚或布洛芬。',
  '青霉素类过敏者对头孢菌素可能存在交叉过敏，用药前必须逐例核实过敏史并备好抢救药品。',
  '剂量按近期实测体重计算，不得用年龄折算替代；肥胖患儿按理想体重或医嘱调整。',
  '复方感冒药常重复含同一退热成分，叠加使用是日总量超限的最常见原因。',
  '本页为教学计算，输出的是范围与手算过程，不是处方；任何给药以执业医师医嘱和药品说明书为准。',
];

export type DosingRejectionCode =
  | 'UNKNOWN_DRUG'
  | 'INVALID_INPUT'
  | 'WEIGHT_OUT_OF_RANGE'
  | 'AGE_OUT_OF_RANGE'
  | 'AGE_CONTRAINDICATED'
  | 'UNKNOWN_CONCENTRATION';

export type DoseRange = { min: number; max: number };
export type DoseUnit = 'mg' | 'IU';
export type VitaminDSeverity = 'rickets-treatment' | 'stoss-therapy';

export type CeilingKind =
  | 'single-dose-absolute'
  | 'daily-weight-cap'
  | 'daily-max-doses'
  | 'daily-absolute-cap'
  | 'neonatal-daily-cap';

export type DoseCeiling = { kind: CeilingKind; limit: number; binding: boolean; label: string };

export type DoseCalculation = {
  ok: true;
  drugId: string;
  drugName: string;
  unit: DoseUnit;
  route: string;
  intervalLabel: string;
  perDose: DoseRange;
  dailyTotal: DoseRange;
  dosesPerDay: DoseRange;
  maxDosesPerDay: number;
  ceilings: DoseCeiling[];
  warnings: string[];
  formula: string;
  steps: string[];
  disclaimer: string;
};

export type DoseRejection = { ok: false; code: DosingRejectionCode; reason: string; disclaimer: string };
export type DoseResult = DoseCalculation | DoseRejection;

export type DoseInput = {
  drug: string;
  weightKg: number;
  ageMonths: number;
  severity?: VitaminDSeverity | string;
  premature?: boolean;
  hyperbilirubinemia?: boolean;
};

export type VolumeInput = { dose: DoseRange; concentrationPerMl: number; unit: DoseUnit };
export type VolumeCalculation = { ok: true; volumeMl: DoseRange; formula: string; steps: string[]; disclaimer: string };
export type VolumeRejection = {
  ok: false;
  code: 'UNKNOWN_CONCENTRATION' | 'INVALID_INPUT';
  reason: string;
  disclaimer: string;
};
export type VolumeResult = VolumeCalculation | VolumeRejection;

type DrugBase = {
  id: string;
  name: string;
  drugClass: string;
  summary: string;
  unit: DoseUnit;
  route: string;
  intervalLabel: string;
  maxDosesPerDay: number;
  warnings: string[];
};

/** 按「mg/kg/次」给药：布洛芬、对乙酰氨基酚。 */
type PerDoseDrug = DrugBase & {
  kind: 'per-dose';
  perDosePerKg: DoseRange;
  dosesPerDay: DoseRange;
  dailyPerKgCap: number;
  singleDoseAbsoluteMax?: number;
  dailyAbsoluteMax?: number;
  minAgeMonths: number;
  minAgeReason: string;
};

/** 按「mg/(kg·d)」分次给药：头孢菌素类。 */
type DailyDrug = DrugBase & {
  kind: 'daily';
  dailyPerKg: DoseRange;
  dosesPerDay: DoseRange;
  neonatalDailyPerKg?: DoseRange;
  neonatalWarnings?: string[];
};

/** 固定推荐值（不按体重）：维生素D 预防量与治疗量。 */
type FixedDrug = DrugBase & {
  kind: 'fixed';
  ageBands: { fromMonths: number; toMonths: number; daily: DoseRange; label: string }[];
  severities: Record<VitaminDSeverity, { daily: DoseRange; route: string; intervalLabel: string; label: string; warnings: string[] }>;
};

export type DosingDrug = PerDoseDrug | DailyDrug | FixedDrug;

export const WEIGHT_KG_RANGE: DoseRange = { min: 1, max: 120 };
export const AGE_MONTHS_RANGE: DoseRange = { min: 0, max: 216 };

const CROSS_ALLERGY = '青霉素过敏者可能存在交叉过敏，用药前须核实过敏史并备好抢救药品。';

export const DOSING_DRUGS: DosingDrug[] = [
  {
    id: 'ibuprofen',
    name: '布洛芬',
    drugClass: '解热镇痛药（非甾体抗炎药）',
    summary: '6 个月以上婴幼儿退热与轻中度疼痛，5–10 mg/kg/次，每 6–8 小时一次，24 小时不超过 4 次。',
    unit: 'mg',
    route: '口服',
    intervalLabel: '每 6–8 小时',
    maxDosesPerDay: 4,
    kind: 'per-dose',
    perDosePerKg: { min: 5, max: 10 },
    dosesPerDay: { min: 3, max: 4 },
    dailyPerKgCap: 40,
    singleDoseAbsoluteMax: 400,
    minAgeMonths: 6,
    minAgeReason: '布洛芬不用于 6 个月以下婴儿（说明书口径）；该月龄段退热请改用对乙酰氨基酚并由医师评估。',
    warnings: [
      '餐后或与少量食物同服，减少胃肠道刺激；有消化道溃疡或出血史者禁用。',
      '脱水、呕吐腹泻明显、肾功能不全或正在使用其他非甾体抗炎药时须由医师评估后减量或停用。',
      '退热连续使用不超过 3 天，镇痛不超过 5 天；不得与对乙酰氨基酚长期交替使用而绕过日总量上限。',
    ],
  },
  {
    id: 'acetaminophen',
    name: '对乙酰氨基酚',
    drugClass: '解热镇痛药（苯胺类）',
    summary: '2 个月以上婴幼儿退热与轻中度疼痛，10–15 mg/kg/次，每 4–6 小时一次，24 小时不超过 4 次。',
    unit: 'mg',
    route: '口服',
    intervalLabel: '每 4–6 小时',
    maxDosesPerDay: 4,
    kind: 'per-dose',
    perDosePerKg: { min: 10, max: 15 },
    dosesPerDay: { min: 4, max: 4 },
    dailyPerKgCap: 60,
    dailyAbsoluteMax: 2000,
    minAgeMonths: 2,
    minAgeReason: '2 个月以下婴儿使用对乙酰氨基酚须在医师指导下进行，本计算器不外推该月龄段剂量。',
    warnings: [
      '避免与含对乙酰氨基酚的复方感冒药同时使用，日总量叠加是最常见的过量原因。',
      '儿童退热不得用阿司匹林替代（瑞氏综合征风险）。',
      '肝功能不全、长期营养不良或脱水患儿须减量并由医师评估；过量可致急性肝损伤。',
    ],
  },
  {
    id: 'vitamin-d',
    name: '维生素D',
    drugClass: '维生素类（钙磷代谢调节）',
    summary: '预防量按固定推荐值（不按体重）：1 岁以下 400 IU/日，1 岁以上 600 IU/日；佝偻病治疗量 2000–4000 IU/日口服，突击疗法 15万–30万 IU 肌注一次。',
    unit: 'IU',
    route: '口服',
    intervalLabel: '每日 1 次',
    maxDosesPerDay: 1,
    kind: 'fixed',
    ageBands: [
      { fromMonths: 0, toMonths: 12, daily: { min: 400, max: 400 }, label: '1 岁以下预防量 400 IU/日' },
      { fromMonths: 12, toMonths: 216, daily: { min: 600, max: 600 }, label: '1 岁以上预防量 600 IU/日' },
    ],
    severities: {
      'rickets-treatment': {
        daily: { min: 2000, max: 4000 },
        route: '口服',
        intervalLabel: '每日 1 次',
        label: '维生素D缺乏性佝偻病治疗量 2000–4000 IU/日口服',
        warnings: ['治疗 1 个月后复查血钙、磷、碱性磷酸酶与 25-(OH)D，达标后回到预防量，不得长期维持治疗量。'],
      },
      'stoss-therapy': {
        daily: { min: 150000, max: 300000 },
        route: '肌内注射（一次给药，须由医师执行）',
        intervalLabel: '一次给药（突击疗法）',
        label: '突击疗法 15万–30万 IU 肌内注射一次',
        warnings: [
          '突击疗法须由医师评估适应证（不能口服、依从性差或需快速纠正）并执行，用药后 3 个月复查血钙与 25-(OH)D。',
          '不得与口服治疗量叠加；短期内重复突击给药可致维生素D中毒。',
        ],
      },
    },
    warnings: [
      '长期超量可致高钙血症、高钙尿症与肾钙化；同时补钙时须一并核算元素钙总摄入量。',
      '预防量与治疗量口径不同，不得把治疗量当作日常补充；早产儿、低出生体重儿的补充方案由医师另行制定。',
    ],
  },
  {
    id: 'cephalexin',
    name: '头孢氨苄',
    drugClass: '第一代头孢菌素（口服）',
    summary: '25–50 mg/(kg·d) 分 4 次口服，用于敏感菌所致呼吸道、皮肤软组织与尿路感染。',
    unit: 'mg',
    route: '口服',
    intervalLabel: '每 6 小时',
    maxDosesPerDay: 4,
    kind: 'daily',
    dailyPerKg: { min: 25, max: 50 },
    dosesPerDay: { min: 4, max: 4 },
    warnings: [CROSS_ALLERGY, '肾功能不全者须延长给药间隔；对头孢菌素类过敏史者禁用。'],
  },
  {
    id: 'cefaclor',
    name: '头孢克洛',
    drugClass: '第二代头孢菌素（口服）',
    summary: '20–40 mg/(kg·d) 分 3 次口服，用于敏感菌所致中耳炎、下呼吸道与尿路感染。',
    unit: 'mg',
    route: '口服',
    intervalLabel: '每 8 小时',
    maxDosesPerDay: 3,
    kind: 'daily',
    dailyPerKg: { min: 20, max: 40 },
    dosesPerDay: { min: 3, max: 3 },
    warnings: [CROSS_ALLERGY, '干混悬剂须按说明配制并冷藏，配制后按有效期使用。'],
  },
  {
    id: 'cefuroxime-axetil',
    name: '头孢呋辛酯',
    drugClass: '第二代头孢菌素（口服）',
    summary: '20–30 mg/(kg·d) 分 2 次口服，餐后服用可提高吸收。',
    unit: 'mg',
    route: '口服',
    intervalLabel: '每 12 小时',
    maxDosesPerDay: 2,
    kind: 'daily',
    dailyPerKg: { min: 20, max: 30 },
    dosesPerDay: { min: 2, max: 2 },
    warnings: [CROSS_ALLERGY, '餐后服用吸收更好；片剂不宜碾碎，低龄患儿选用口服混悬液剂型。'],
  },
  {
    id: 'ceftriaxone',
    name: '头孢曲松',
    drugClass: '第三代头孢菌素（注射）',
    summary: '婴幼儿 20–80 mg/(kg·d) 分 1–2 次；新生儿不超过 50 mg/(kg·d)。早产儿与高胆红素血症新生儿禁用。',
    unit: 'mg',
    route: '静脉滴注或肌内注射',
    intervalLabel: '每 12–24 小时',
    maxDosesPerDay: 2,
    kind: 'daily',
    dailyPerKg: { min: 20, max: 80 },
    dosesPerDay: { min: 1, max: 2 },
    neonatalDailyPerKg: { min: 20, max: 50 },
    neonatalWarnings: [
      '新生儿日剂量不超过 50 mg/(kg·d)；高胆红素血症、早产儿及正在或即将静脉补钙者禁用（胆红素置换与钙-头孢曲松沉淀风险）。',
    ],
    warnings: [
      CROSS_ALLERGY,
      '禁与含钙溶液（乳酸林格液、葡萄糖酸钙等）同瓶或经同一通路先后输注，须充分冲管并间隔给药。',
      '肌内注射须以利多卡因溶剂配制时核对浓度与注射部位，避开神经血管。',
    ],
  },
  {
    id: 'cefotaxime',
    name: '头孢噻肟',
    drugClass: '第三代头孢菌素（注射）',
    summary: '50–100 mg/(kg·d) 分 2–4 次静脉给药，用于敏感菌所致中重度感染。',
    unit: 'mg',
    route: '静脉滴注',
    intervalLabel: '每 6–12 小时',
    maxDosesPerDay: 4,
    kind: 'daily',
    dailyPerKg: { min: 50, max: 100 },
    dosesPerDay: { min: 2, max: 4 },
    warnings: [CROSS_ALLERGY, '重症感染可按医嘱上调至日剂量上限，须由医师评估并监测肝肾功能。'],
  },
  {
    id: 'ceftazidime',
    name: '头孢他啶',
    drugClass: '第三代头孢菌素（注射，抗铜绿假单胞菌）',
    summary: '30–100 mg/(kg·d) 分 2–3 次静脉给药，用于铜绿假单胞菌等革兰阴性菌重症感染。',
    unit: 'mg',
    route: '静脉滴注',
    intervalLabel: '每 8–12 小时',
    maxDosesPerDay: 3,
    kind: 'daily',
    dailyPerKg: { min: 30, max: 100 },
    dosesPerDay: { min: 2, max: 3 },
    warnings: [CROSS_ALLERGY, '肾功能不全者须按肌酐清除率调整给药间隔，避免蓄积致神经毒性。'],
  },
];

export const DOSING_DRUG_IDS: string[] = DOSING_DRUGS.map((drug) => drug.id);

/** 体重达到该值即进入成人剂量收敛区间，须提示不得继续按 mg/kg 线性外推。 */
const ADULT_WEIGHT_THRESHOLD_KG = 40;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatNumber(value: number): string {
  return String(round2(value));
}

function reject(code: DosingRejectionCode, reason: string): DoseRejection {
  return { ok: false, code, reason, disclaimer: DOSING_DISCLAIMER };
}

function calculation(partial: Omit<DoseCalculation, 'ok' | 'disclaimer'>): DoseCalculation {
  return { ok: true, ...partial, disclaimer: DOSING_DISCLAIMER };
}

function adultConvergenceWarning(weight: number): string {
  return `体重 ${formatNumber(weight)} kg 已进入成人剂量范围：本教学表未收录该药的成人绝对上限，须按说明书成人剂量收敛后由医师核定，不得继续按 mg/kg 线性外推。`;
}

export function calculateDose(input: DoseInput): DoseResult {
  const drug = DOSING_DRUGS.find((item) => item.id === String(input.drug ?? '').trim().toLowerCase());
  if (!drug) {
    const label = String(input.drug ?? '').trim() || '（空值）';
    return reject(
      'UNKNOWN_DRUG',
      `未收录药品「${label}」：本教学计算器只覆盖 ${DOSING_DRUGS.length} 种药品（${DOSING_DRUGS.map((item) => item.name).join('、')}），不对未收录药品外推或猜测剂量。`,
    );
  }
  if (!Number.isFinite(input.weightKg) || !Number.isFinite(input.ageMonths)) {
    return reject('INVALID_INPUT', '体重与月龄必须是有效数字，不接受空值、NaN 或无穷大。');
  }
  const weight = input.weightKg;
  const age = input.ageMonths;
  if (weight < WEIGHT_KG_RANGE.min || weight > WEIGHT_KG_RANGE.max) {
    return reject(
      'WEIGHT_OUT_OF_RANGE',
      `体重 ${formatNumber(weight)} kg 超出教学计算范围 ${WEIGHT_KG_RANGE.min}–${WEIGHT_KG_RANGE.max} kg；不做静默截断，请按说明书与医师核定。`,
    );
  }
  if (age < AGE_MONTHS_RANGE.min || age > AGE_MONTHS_RANGE.max) {
    return reject(
      'AGE_OUT_OF_RANGE',
      `月龄 ${formatNumber(age)} 个月超出教学计算范围 ${AGE_MONTHS_RANGE.min}–${AGE_MONTHS_RANGE.max} 个月（0–18 岁）。`,
    );
  }
  if (input.severity !== undefined) {
    if (drug.kind !== 'fixed') {
      return reject('INVALID_INPUT', `${drug.name}不按严重程度分档：severity 参数仅对维生素D（佝偻病治疗量 / 突击疗法）有意义。`);
    }
    if (input.severity !== 'rickets-treatment' && input.severity !== 'stoss-therapy') {
      return reject(
        'INVALID_INPUT',
        `未知的 severity 取值「${String(input.severity)}」：维生素D仅支持 rickets-treatment（佝偻病治疗量）与 stoss-therapy（突击疗法）。`,
      );
    }
  }
  if (drug.kind === 'fixed') return fixedCalculation(drug, age, input.severity);
  if (drug.kind === 'per-dose') {
    if (age < drug.minAgeMonths) return reject('AGE_CONTRAINDICATED', drug.minAgeReason);
    return perDoseCalculation(drug, weight);
  }
  return dailyCalculation(drug, weight, age, input);
}

/** mg/kg/次 口径：先算单次范围，再用「按体重日总量」与「按次数日总量」双重封顶。 */
function perDoseCalculation(drug: PerDoseDrug, weight: number): DoseCalculation {
  const fw = formatNumber(weight);
  const unit = drug.unit;
  const rawMin = round2(weight * drug.perDosePerKg.min);
  const rawMax = round2(weight * drug.perDosePerKg.max);
  const ceilings: DoseCeiling[] = [];
  const warnings = [...drug.warnings];
  const steps: string[] = [
    `单次剂量下限：${fw} kg × ${formatNumber(drug.perDosePerKg.min)} ${unit}/kg/次 = ${formatNumber(rawMin)} ${unit}/次`,
    `单次剂量上限：${fw} kg × ${formatNumber(drug.perDosePerKg.max)} ${unit}/kg/次 = ${formatNumber(rawMax)} ${unit}/次`,
  ];
  let perDoseMax = rawMax;
  if (drug.singleDoseAbsoluteMax !== undefined) {
    const binding = rawMax > drug.singleDoseAbsoluteMax;
    if (binding) perDoseMax = drug.singleDoseAbsoluteMax;
    ceilings.push({
      kind: 'single-dose-absolute',
      limit: drug.singleDoseAbsoluteMax,
      binding,
      label: `单次绝对上限 ${formatNumber(drug.singleDoseAbsoluteMax)} ${unit}/次`,
    });
    steps.push(
      `单次绝对上限核对：${formatNumber(drug.singleDoseAbsoluteMax)} ${unit}/次，${binding ? '计算值已超出，按上限截断' : '本次计算值未触及'}`,
    );
  }
  const perDoseMin = Math.min(rawMin, perDoseMax);
  steps.push(`给药次数：${drug.intervalLabel}，每日 ${drug.dosesPerDay.min}–${drug.dosesPerDay.max} 次，24 小时不超过 ${drug.maxDosesPerDay} 次`);

  const weightCap = round2(weight * drug.dailyPerKgCap);
  const countCap = round2(drug.maxDosesPerDay * perDoseMax);
  const daily: DoseCeiling[] = [
    { kind: 'daily-weight-cap', limit: weightCap, binding: false, label: `按体重日总量上限 ${drug.dailyPerKgCap} ${unit}/(kg·d) × ${fw} kg = ${formatNumber(weightCap)} ${unit}/日` },
    { kind: 'daily-max-doses', limit: countCap, binding: false, label: `按次数日总量上限 ${drug.maxDosesPerDay} 次 × ${formatNumber(perDoseMax)} ${unit}/次 = ${formatNumber(countCap)} ${unit}/日` },
  ];
  steps.push(`每日上限一（按体重）：${drug.dailyPerKgCap} ${unit}/(kg·d) × ${fw} kg = ${formatNumber(weightCap)} ${unit}/日`);
  steps.push(`每日上限二（按次数）：${drug.maxDosesPerDay} 次 × ${formatNumber(perDoseMax)} ${unit}/次 = ${formatNumber(countCap)} ${unit}/日`);
  if (drug.dailyAbsoluteMax !== undefined) {
    daily.push({ kind: 'daily-absolute-cap', limit: drug.dailyAbsoluteMax, binding: false, label: `成人日总量上限 ${formatNumber(drug.dailyAbsoluteMax)} ${unit}/日` });
    steps.push(`每日上限三（成人日总量）：${formatNumber(drug.dailyAbsoluteMax)} ${unit}/日`);
  }
  const dailyMax = Math.min(...daily.map((item) => item.limit));
  for (const item of daily) item.binding = item.limit <= dailyMax;
  ceilings.push(...daily);
  const dailyMin = Math.min(round2(drug.dosesPerDay.min * perDoseMin), dailyMax);
  steps.push(`取各上限最小值 → 每日不超过 ${formatNumber(dailyMax)} ${unit}/日；按每日 ${drug.dosesPerDay.min} 次起算，每日总量范围 ${formatNumber(dailyMin)}–${formatNumber(dailyMax)} ${unit}/日`);

  if (weight >= ADULT_WEIGHT_THRESHOLD_KG && drug.singleDoseAbsoluteMax === undefined && drug.dailyAbsoluteMax === undefined) {
    warnings.push(adultConvergenceWarning(weight));
  }

  return calculation({
    drugId: drug.id,
    drugName: drug.name,
    unit,
    route: drug.route,
    intervalLabel: drug.intervalLabel,
    perDose: { min: perDoseMin, max: perDoseMax },
    dailyTotal: { min: dailyMin, max: dailyMax },
    dosesPerDay: drug.dosesPerDay,
    maxDosesPerDay: drug.maxDosesPerDay,
    ceilings,
    warnings,
    formula: `${fw} kg × ${formatNumber(drug.perDosePerKg.min)}–${formatNumber(drug.perDosePerKg.max)} ${unit}/kg/次 = ${formatNumber(perDoseMin)}–${formatNumber(perDoseMax)} ${unit}/次`,
    steps,
  });
}

/** mg/(kg·d) 分次口径：先算每日总量，再除以次数得单次包络；新生儿只在收录了封顶数据时放行。 */
function dailyCalculation(drug: DailyDrug, weight: number, age: number, input: DoseInput): DoseResult {
  const fw = formatNumber(weight);
  const unit = drug.unit;
  const warnings = [...drug.warnings];
  const ceilings: DoseCeiling[] = [];
  const steps: string[] = [];
  let perKg = drug.dailyPerKg;
  const neonatal = age < 1;

  if (neonatal) {
    if (!drug.neonatalDailyPerKg) {
      return reject(
        'AGE_CONTRAINDICATED',
        `${drug.name}的新生儿（<1 月龄）剂量未收录于本教学表，不做外推；如确需使用请核对说明书并由新生儿专业医师决定。`,
      );
    }
    if (input.premature) {
      return reject('AGE_CONTRAINDICATED', `早产儿禁用${drug.name}（胆红素置换与钙-头孢曲松沉淀风险），本计算器不给剂量。`);
    }
    if (input.hyperbilirubinemia) {
      return reject('AGE_CONTRAINDICATED', `新生儿高胆红素血症者禁用${drug.name}，须改用其他抗菌药物并由医师决定。`);
    }
    perKg = drug.neonatalDailyPerKg;
    const limit = round2(weight * perKg.max);
    if (drug.neonatalWarnings) warnings.push(...drug.neonatalWarnings);
    ceilings.push({ kind: 'neonatal-daily-cap', limit, binding: true, label: `新生儿日剂量封顶 ${perKg.max} ${unit}/(kg·d) × ${fw} kg = ${formatNumber(limit)} ${unit}/日` });
  }

  const dailyMin = round2(weight * perKg.min);
  const dailyMax = round2(weight * perKg.max);
  const perDoseMin = round2(dailyMin / drug.dosesPerDay.max);
  const perDoseMax = round2(dailyMax / drug.dosesPerDay.min);

  steps.push(`每日总量下限：${fw} kg × ${formatNumber(perKg.min)} ${unit}/(kg·d) = ${formatNumber(dailyMin)} ${unit}/日`);
  steps.push(`每日总量上限：${fw} kg × ${formatNumber(perKg.max)} ${unit}/(kg·d) = ${formatNumber(dailyMax)} ${unit}/日`);
  if (neonatal) steps.push(`新生儿封顶：日剂量不超过 ${perKg.max} ${unit}/(kg·d)，即 ${fw} kg × ${perKg.max} = ${formatNumber(dailyMax)} ${unit}/日`);
  steps.push(`分次：${drug.intervalLabel}，每日 ${drug.dosesPerDay.min}–${drug.dosesPerDay.max} 次`);
  steps.push(`单次剂量下限：${formatNumber(dailyMin)} ${unit}/日 ÷ ${drug.dosesPerDay.max} 次 = ${formatNumber(perDoseMin)} ${unit}/次`);
  steps.push(`单次剂量上限：${formatNumber(dailyMax)} ${unit}/日 ÷ ${drug.dosesPerDay.min} 次 = ${formatNumber(perDoseMax)} ${unit}/次`);

  if (!neonatal && weight >= ADULT_WEIGHT_THRESHOLD_KG) warnings.push(adultConvergenceWarning(weight));

  return calculation({
    drugId: drug.id,
    drugName: drug.name,
    unit,
    route: drug.route,
    intervalLabel: drug.intervalLabel,
    perDose: { min: perDoseMin, max: perDoseMax },
    dailyTotal: { min: dailyMin, max: dailyMax },
    dosesPerDay: drug.dosesPerDay,
    maxDosesPerDay: drug.maxDosesPerDay,
    ceilings,
    warnings,
    formula: `${fw} kg × ${formatNumber(perKg.min)}–${formatNumber(perKg.max)} ${unit}/(kg·d) = ${formatNumber(dailyMin)}–${formatNumber(dailyMax)} ${unit}/日；分 ${drug.dosesPerDay.min}–${drug.dosesPerDay.max} 次 → ${formatNumber(perDoseMin)}–${formatNumber(perDoseMax)} ${unit}/次`,
    steps,
  });
}

/** 固定推荐值口径：按年龄分档或治疗分档，不按体重计算。 */
function fixedCalculation(drug: FixedDrug, age: number, severity?: string): DoseCalculation {
  const warnings = [...drug.warnings];
  const steps: string[] = [];
  let daily: DoseRange;
  let route = drug.route;
  let intervalLabel = drug.intervalLabel;
  let label: string;

  if (severity === 'rickets-treatment' || severity === 'stoss-therapy') {
    const spec = drug.severities[severity];
    daily = spec.daily;
    route = spec.route;
    intervalLabel = spec.intervalLabel;
    label = spec.label;
    warnings.push(...spec.warnings);
    steps.push(`按治疗分档（${formatNumber(age)} 个月）：${label}`);
  } else {
    const band = drug.ageBands.find((item) => age >= item.fromMonths && age < item.toMonths) ?? drug.ageBands[drug.ageBands.length - 1];
    daily = band.daily;
    label = band.label;
    steps.push(`按年龄分档（${formatNumber(age)} 个月）：${label}`);
  }
  steps.push('固定推荐值，不按体重计算；单次即每日总量。');
  steps.push(`分次：${intervalLabel}，每日 ${drug.maxDosesPerDay} 次`);

  return calculation({
    drugId: drug.id,
    drugName: drug.name,
    unit: drug.unit,
    route,
    intervalLabel,
    perDose: { min: daily.min, max: daily.max },
    dailyTotal: { min: daily.min, max: daily.max },
    dosesPerDay: { min: 1, max: 1 },
    maxDosesPerDay: drug.maxDosesPerDay,
    ceilings: [],
    warnings,
    formula: label,
    steps,
  });
}

function volumeReject(code: 'UNKNOWN_CONCENTRATION' | 'INVALID_INPUT', reason: string): VolumeRejection {
  return { ok: false, code, reason, disclaimer: DOSING_DISCLAIMER };
}

/** 剂量 ÷ 浓度 = 体积；浓度未知一律拒绝，不假设默认规格。 */
export function calculateVolumePerDose(input: VolumeInput): VolumeResult {
  const { dose, concentrationPerMl, unit } = input;
  if (!Number.isFinite(dose.min) || !Number.isFinite(dose.max) || dose.min < 0 || dose.min > dose.max) {
    return volumeReject(
      'INVALID_INPUT',
      `剂量区间非法（${formatNumber(dose.min)}–${formatNumber(dose.max)} ${unit}）：须为 min ≤ max 的非负数值。`,
    );
  }
  if (!Number.isFinite(concentrationPerMl) || concentrationPerMl <= 0) {
    return volumeReject(
      'UNKNOWN_CONCENTRATION',
      `制剂浓度未知或非法（${String(concentrationPerMl)} ${unit}/mL）：不假设默认浓度，请按实际制剂规格填写后再换算。`,
    );
  }
  const min = round2(dose.min / concentrationPerMl);
  const max = round2(dose.max / concentrationPerMl);
  return {
    ok: true,
    volumeMl: { min, max },
    formula: `${formatNumber(dose.min)}–${formatNumber(dose.max)} ${unit} ÷ ${formatNumber(concentrationPerMl)} ${unit}/mL = ${formatNumber(min)}–${formatNumber(max)} mL/次`,
    steps: [
      `每次剂量：${formatNumber(dose.min)}–${formatNumber(dose.max)} ${unit}`,
      `制剂规格：${formatNumber(concentrationPerMl)} ${unit}/mL`,
      `换算：剂量 ÷ 浓度 = 体积 → ${formatNumber(min)}–${formatNumber(max)} mL/次`,
      '抽取时按实际制剂规格与最小可测刻度取整，必要时稀释后双人核对。',
    ],
    disclaimer: DOSING_DISCLAIMER,
  };
}
