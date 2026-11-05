import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOSING_DISCLAIMER,
  DOSING_DRUG_IDS,
  DOSING_DRUGS,
  GENERAL_SAFETY_NOTES,
  calculateDose,
  calculateVolumePerDose,
  type DoseCalculation,
  type DoseRejection,
  type DoseResult,
  type DosingRejectionCode,
} from '@/domain/pediatric-dosing';

function expectOk(result: DoseResult): DoseCalculation {
  if (!result.ok) assert.fail(`期望计算成功，实际被拒绝（${result.code}）：${result.reason}`);
  return result;
}

function expectReject(result: DoseResult, code: DosingRejectionCode): DoseRejection {
  if (result.ok) assert.fail(`期望类型化拒绝（${code}），实际返回了剂量`);
  assert.equal(result.code, code);
  return result;
}

/** 药品目录：9 种教学药品，id 唯一且 kebab-case，元数据完整。 */
test('DOSING_DRUG_IDS / DOSING_DRUGS：9 种药品目录完整', () => {
  assert.equal(DOSING_DRUG_IDS.length, 9);
  assert.equal(new Set(DOSING_DRUG_IDS).size, 9);
  for (const id of DOSING_DRUG_IDS) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(DOSING_DRUGS.length, 9);
  for (const meta of DOSING_DRUGS) {
    assert.ok(meta.name.length > 0);
    assert.ok(meta.drugClass.length > 0);
    assert.ok(meta.summary.length > 0);
  }
});

/** 布洛芬 8 kg / 24 月龄：5–10 mg/kg/次 → 40–80 mg；日上限 40 mg/kg=320 mg 与 4 次×80 mg 等值封顶。 */
test('calculateDose：布洛芬 8 kg 单次范围与日上限', () => {
  const r = expectOk(calculateDose({ drug: 'ibuprofen', weightKg: 8, ageMonths: 24 }));
  assert.deepEqual(r.perDose, { min: 40, max: 80 });
  assert.deepEqual(r.dosesPerDay, { min: 3, max: 4 });
  assert.equal(r.maxDosesPerDay, 4);
  assert.deepEqual(r.dailyTotal, { min: 120, max: 320 });
  assert.equal(r.intervalLabel, '每 6–8 小时');
  const single = r.ceilings.find((c) => c.kind === 'single-dose-absolute');
  assert.ok(single && single.limit === 400 && single.binding === false);
  const dailyWeight = r.ceilings.find((c) => c.kind === 'daily-weight-cap');
  assert.ok(dailyWeight && dailyWeight.limit === 320 && dailyWeight.binding === true);
  const dailyCount = r.ceilings.find((c) => c.kind === 'daily-max-doses');
  assert.ok(dailyCount && dailyCount.limit === 320 && dailyCount.binding === true);
  assert.match(r.formula, /8 kg × 5–10 mg\/kg\/次 = 40–80 mg\/次/);
});

/** 布洛芬 7.5 kg：非整数体重的 0.1 mg 精度（37.5–75 mg）。 */
test('calculateDose：布洛芬 7.5 kg 小数体重', () => {
  const r = expectOk(calculateDose({ drug: 'ibuprofen', weightKg: 7.5, ageMonths: 12 }));
  assert.deepEqual(r.perDose, { min: 37.5, max: 75 });
});

/** 封顶逻辑：60 kg 时体重计算值 300–600 mg 被成人单次上限 400 mg 截住，日总量由「4 次×400 mg」封顶（1600 < 2400）。 */
test('calculateDose：布洛芬 60 kg 单次绝对上限与次数上限生效', () => {
  const r = expectOk(calculateDose({ drug: 'ibuprofen', weightKg: 60, ageMonths: 144 }));
  assert.deepEqual(r.perDose, { min: 300, max: 400 });
  assert.deepEqual(r.dailyTotal, { min: 900, max: 1600 });
  const single = r.ceilings.find((c) => c.kind === 'single-dose-absolute');
  assert.ok(single && single.binding === true);
  const dailyWeight = r.ceilings.find((c) => c.kind === 'daily-weight-cap');
  assert.ok(dailyWeight && dailyWeight.limit === 2400 && dailyWeight.binding === false);
  const dailyCount = r.ceilings.find((c) => c.kind === 'daily-max-doses');
  assert.ok(dailyCount && dailyCount.limit === 1600 && dailyCount.binding === true);
});

/** 布洛芬 <6 月龄直接拒绝（教材/说明书口径），恰好 6 月龄可计算。 */
test('calculateDose：布洛芬 <6 月龄拒绝，≥6 月龄通过', () => {
  const r = expectReject(calculateDose({ drug: 'ibuprofen', weightKg: 6, ageMonths: 5 }), 'AGE_CONTRAINDICATED');
  assert.match(r.reason, /6 个月/);
  assert.equal(r.disclaimer, DOSING_DISCLAIMER);
  expectOk(calculateDose({ drug: 'ibuprofen', weightKg: 7, ageMonths: 6 }));
});

/** 对乙酰氨基酚 10 kg：10–15 mg/kg/次 → 100–150 mg；日总量 400–600 mg（60 mg/kg 与 4 次上限等值）。 */
test('calculateDose：对乙酰氨基酚 10 kg 范围与警示', () => {
  const r = expectOk(calculateDose({ drug: 'acetaminophen', weightKg: 10, ageMonths: 30 }));
  assert.deepEqual(r.perDose, { min: 100, max: 150 });
  assert.deepEqual(r.dosesPerDay, { min: 4, max: 4 });
  assert.deepEqual(r.dailyTotal, { min: 400, max: 600 });
  assert.equal(r.intervalLabel, '每 4–6 小时');
  assert.ok(r.warnings.some((w) => w.includes('复方感冒药')));
  assert.ok(r.warnings.some((w) => w.includes('阿司匹林')));
});

/** 对乙酰氨基酚 <2 月龄拒绝（需医师指导），恰好 2 月龄通过。 */
test('calculateDose：对乙酰氨基酚 <2 月龄拒绝', () => {
  const r = expectReject(calculateDose({ drug: 'acetaminophen', weightKg: 4, ageMonths: 1.5 }), 'AGE_CONTRAINDICATED');
  assert.match(r.reason, /2 个月/);
  assert.match(r.reason, /医师指导/);
  expectOk(calculateDose({ drug: 'acetaminophen', weightKg: 4, ageMonths: 2 }));
});

/** 维生素D 预防量：<1 岁 400 IU/d，≥1 岁 600 IU/d（固定推荐值，不按体重）。 */
test('calculateDose：维生素D 预防量按月龄分档', () => {
  const infant = expectOk(calculateDose({ drug: 'vitamin-d', weightKg: 6, ageMonths: 3 }));
  assert.deepEqual(infant.dailyTotal, { min: 400, max: 400 });
  assert.equal(infant.unit, 'IU');
  const child = expectOk(calculateDose({ drug: 'vitamin-d', weightKg: 12, ageMonths: 24 }));
  assert.deepEqual(child.dailyTotal, { min: 600, max: 600 });
  assert.ok(infant.warnings.some((w) => w.includes('高钙血症')));
  assert.ok(infant.warnings.some((w) => w.includes('钙')));
});

/** 维生素D 佝偻病治疗量 2000–4000 IU/d 口服；突击疗法 15万–30万 IU 肌注一次。 */
test('calculateDose：维生素D 治疗量与突击疗法', () => {
  const treat = expectOk(calculateDose({ drug: 'vitamin-d', weightKg: 9, ageMonths: 10, severity: 'rickets-treatment' }));
  assert.deepEqual(treat.dailyTotal, { min: 2000, max: 4000 });
  assert.match(treat.route, /口服/);
  const stoss = expectOk(calculateDose({ drug: 'vitamin-d', weightKg: 9, ageMonths: 10, severity: 'stoss-therapy' }));
  assert.deepEqual(stoss.dailyTotal, { min: 150000, max: 300000 });
  assert.match(stoss.route, /肌/);
  assert.ok(stoss.warnings.some((w) => w.includes('医师')));
});

/** severity 仅对维生素D有意义：其他药品传入或未知取值一律拒绝（fail-closed）。 */
test('calculateDose：severity 参数误用拒绝', () => {
  expectReject(calculateDose({ drug: 'ibuprofen', weightKg: 10, ageMonths: 12, severity: 'rickets-treatment' }), 'INVALID_INPUT');
  expectReject(calculateDose({ drug: 'vitamin-d', weightKg: 10, ageMonths: 12, severity: 'high-dose' }), 'INVALID_INPUT');
});

/** 头孢氨苄 12 kg：25–50 mg/(kg·d) → 300–600 mg/d 分 4 次 → 75–150 mg/次；交叉过敏警示。 */
test('calculateDose：头孢氨苄 12 kg 分次计算', () => {
  const r = expectOk(calculateDose({ drug: 'cephalexin', weightKg: 12, ageMonths: 36 }));
  assert.deepEqual(r.dailyTotal, { min: 300, max: 600 });
  assert.deepEqual(r.perDose, { min: 75, max: 150 });
  assert.deepEqual(r.dosesPerDay, { min: 4, max: 4 });
  assert.ok(r.warnings.some((w) => w.includes('交叉过敏')));
});

/** 头孢克洛 15 kg（20–40 分 3 次）与头孢呋辛酯 20 kg（20–30 分 2 次）。 */
test('calculateDose：头孢克洛 / 头孢呋辛酯 分次计算', () => {
  const cefaclor = expectOk(calculateDose({ drug: 'cefaclor', weightKg: 15, ageMonths: 48 }));
  assert.deepEqual(cefaclor.dailyTotal, { min: 300, max: 600 });
  assert.deepEqual(cefaclor.perDose, { min: 100, max: 200 });
  assert.deepEqual(cefaclor.dosesPerDay, { min: 3, max: 3 });
  const cefuroxime = expectOk(calculateDose({ drug: 'cefuroxime-axetil', weightKg: 20, ageMonths: 60 }));
  assert.deepEqual(cefuroxime.dailyTotal, { min: 400, max: 600 });
  assert.deepEqual(cefuroxime.perDose, { min: 200, max: 300 });
  assert.deepEqual(cefuroxime.dosesPerDay, { min: 2, max: 2 });
});

/** 头孢曲松 10 kg 婴儿期：20–80 mg/(kg·d) → 200–800 mg/d，分 1–2 次；含钙溶液警示。 */
test('calculateDose：头孢曲松 婴儿期剂量与含钙警示', () => {
  const r = expectOk(calculateDose({ drug: 'ceftriaxone', weightKg: 10, ageMonths: 6 }));
  assert.deepEqual(r.dailyTotal, { min: 200, max: 800 });
  assert.deepEqual(r.perDose, { min: 100, max: 800 });
  assert.deepEqual(r.dosesPerDay, { min: 1, max: 2 });
  assert.ok(r.warnings.some((w) => w.includes('含钙溶液')));
});

/** 头孢曲松 新生儿：日剂量封顶 ≤50 mg/(kg·d)（封顶条目 binding），并警示高胆红素/早产儿禁用。 */
test('calculateDose：头孢曲松 新生儿封顶 50 mg/(kg·d)', () => {
  const r = expectOk(calculateDose({ drug: 'ceftriaxone', weightKg: 3, ageMonths: 0 }));
  assert.deepEqual(r.dailyTotal, { min: 60, max: 150 });
  const neonatal = r.ceilings.find((c) => c.kind === 'neonatal-daily-cap');
  assert.ok(neonatal && neonatal.limit === 150 && neonatal.binding === true);
  assert.ok(r.warnings.some((w) => w.includes('高胆红素血症')));
});

/** 头孢曲松：早产儿或高胆红素血症新生儿 → 禁用，直接拒绝。 */
test('calculateDose：头孢曲松 早产儿/高胆红素血症新生儿拒绝', () => {
  const preterm = expectReject(
    calculateDose({ drug: 'ceftriaxone', weightKg: 2, ageMonths: 0, premature: true }),
    'AGE_CONTRAINDICATED',
  );
  assert.match(preterm.reason, /禁用/);
  expectReject(
    calculateDose({ drug: 'ceftriaxone', weightKg: 3, ageMonths: 0, hyperbilirubinemia: true }),
    'AGE_CONTRAINDICATED',
  );
});

/** 头孢噻肟 8 kg（50–100 分 2–4 次）与头孢他啶 25 kg（30–100 分 2–3 次）：单次范围取每日范围除以次数包络。 */
test('calculateDose：头孢噻肟 / 头孢他啶 分次范围包络', () => {
  const cefotaxime = expectOk(calculateDose({ drug: 'cefotaxime', weightKg: 8, ageMonths: 24 }));
  assert.deepEqual(cefotaxime.dailyTotal, { min: 400, max: 800 });
  assert.deepEqual(cefotaxime.perDose, { min: 100, max: 400 });
  assert.deepEqual(cefotaxime.dosesPerDay, { min: 2, max: 4 });
  const ceftazidime = expectOk(calculateDose({ drug: 'ceftazidime', weightKg: 25, ageMonths: 120 }));
  assert.deepEqual(ceftazidime.dailyTotal, { min: 750, max: 2500 });
  assert.deepEqual(ceftazidime.perDose, { min: 250, max: 1250 });
  assert.deepEqual(ceftazidime.dosesPerDay, { min: 2, max: 3 });
});

/** 除头孢曲松外的头孢对新生儿（<1 月龄）不外推，一律拒绝。 */
test('calculateDose：头孢类新生儿拒绝（头孢曲松除外）', () => {
  for (const drug of ['cephalexin', 'cefaclor', 'cefuroxime-axetil', 'cefotaxime', 'ceftazidime']) {
    const r = expectReject(calculateDose({ drug, weightKg: 3.2, ageMonths: 0 }), 'AGE_CONTRAINDICATED');
    assert.match(r.reason, /新生儿/);
  }
});

/** 未收录药品拒绝（如阿莫西林），不猜测剂量。 */
test('calculateDose：未收录药品拒绝', () => {
  const r = expectReject(calculateDose({ drug: 'amoxicillin', weightKg: 10, ageMonths: 24 }), 'UNKNOWN_DRUG');
  assert.match(r.reason, /未收录/);
  expectReject(calculateDose({ drug: '', weightKg: 10, ageMonths: 24 }), 'UNKNOWN_DRUG');
});

/** 体重边界：1–120 kg 闭区间内通过；0.9/120.5/负数拒绝且不静默截断；NaN 拒绝。 */
test('calculateDose：体重范围 fail-closed', () => {
  expectOk(calculateDose({ drug: 'cephalexin', weightKg: 1, ageMonths: 3 }));
  expectOk(calculateDose({ drug: 'cephalexin', weightKg: 120, ageMonths: 200 }));
  expectReject(calculateDose({ drug: 'ibuprofen', weightKg: 0.9, ageMonths: 8 }), 'WEIGHT_OUT_OF_RANGE');
  expectReject(calculateDose({ drug: 'ibuprofen', weightKg: 120.5, ageMonths: 144 }), 'WEIGHT_OUT_OF_RANGE');
  expectReject(calculateDose({ drug: 'ibuprofen', weightKg: -8, ageMonths: 24 }), 'WEIGHT_OUT_OF_RANGE');
  expectReject(calculateDose({ drug: 'ibuprofen', weightKg: Number.NaN, ageMonths: 24 }), 'INVALID_INPUT');
});

/** 月龄边界：NaN / 负数 / >216 月龄拒绝。 */
test('calculateDose：月龄非法值拒绝', () => {
  expectReject(calculateDose({ drug: 'cephalexin', weightKg: 10, ageMonths: Number.NaN }), 'INVALID_INPUT');
  expectReject(calculateDose({ drug: 'cephalexin', weightKg: 10, ageMonths: -1 }), 'AGE_OUT_OF_RANGE');
  expectReject(calculateDose({ drug: 'cephalexin', weightKg: 10, ageMonths: 217 }), 'AGE_OUT_OF_RANGE');
});

/** 免责声明：成功与拒绝结果都不得缺失（教学计算，不构成处方）。 */
test('calculateDose：所有结果均携带教学免责声明', () => {
  const results: DoseResult[] = [
    calculateDose({ drug: 'ibuprofen', weightKg: 12, ageMonths: 36 }),
    calculateDose({ drug: 'vitamin-d', weightKg: 8, ageMonths: 18 }),
    calculateDose({ drug: 'ceftriaxone', weightKg: 3, ageMonths: 0 }),
    calculateDose({ drug: 'ibuprofen', weightKg: 3, ageMonths: 1 }),
    calculateDose({ drug: 'unknown', weightKg: 10, ageMonths: 12 }),
    calculateDose({ drug: 'cephalexin', weightKg: 200, ageMonths: 12 }),
  ];
  for (const r of results) {
    assert.equal(r.disclaimer, DOSING_DISCLAIMER);
    assert.ok(r.disclaimer.includes('教学计算'));
  }
});

/** 体重 ≥40 kg 且无绝对上限数据的药品：警示按成人剂量封顶（不虚构上限、不静默截断）。 */
test('calculateDose：大体重成人剂量收敛警示', () => {
  const r = expectOk(calculateDose({ drug: 'ceftazidime', weightKg: 45, ageMonths: 168 }));
  assert.ok(r.warnings.some((w) => w.includes('成人剂量')));
  const small = expectOk(calculateDose({ drug: 'ceftazidime', weightKg: 15, ageMonths: 48 }));
  assert.ok(!small.warnings.some((w) => w.includes('成人剂量')));
});

/** 单位换算：布洛芬 40–80 mg ÷ 20 mg/mL = 2–4 mL/次。 */
test('calculateVolumePerDose：mg 浓度换算', () => {
  const r = calculateVolumePerDose({ dose: { min: 40, max: 80 }, concentrationPerMl: 20, unit: 'mg' });
  if (!r.ok) assert.fail(r.reason);
  assert.deepEqual(r.volumeMl, { min: 2, max: 4 });
  assert.match(r.formula, /40–80 mg ÷ 20 mg\/mL = 2–4 mL\/次/);
  assert.equal(r.disclaimer, DOSING_DISCLAIMER);
});

/** 单位换算：IU 制剂（维生素D 400 IU ÷ 400 IU/mL = 1 mL）与小数保留两位。 */
test('calculateVolumePerDose：IU 换算与小数精度', () => {
  const iu = calculateVolumePerDose({ dose: { min: 400, max: 400 }, concentrationPerMl: 400, unit: 'IU' });
  if (!iu.ok) assert.fail(iu.reason);
  assert.deepEqual(iu.volumeMl, { min: 1, max: 1 });
  const frac = calculateVolumePerDose({ dose: { min: 125, max: 500 }, concentrationPerMl: 3, unit: 'mg' });
  if (!frac.ok) assert.fail(frac.reason);
  assert.deepEqual(frac.volumeMl, { min: 41.67, max: 166.67 });
});

/** 浓度未知/非法（0、负数、NaN）拒绝：不假设默认浓度。 */
test('calculateVolumePerDose：未知浓度 fail-closed', () => {
  for (const concentrationPerMl of [0, -20, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = calculateVolumePerDose({ dose: { min: 40, max: 80 }, concentrationPerMl, unit: 'mg' });
    expectRejectVolume(r, 'UNKNOWN_CONCENTRATION');
  }
  const r = calculateVolumePerDose({ dose: { min: 40, max: 80 }, concentrationPerMl: 0, unit: 'mg' });
  if (!r.ok) assert.match(r.reason, /浓度/);
});

/** 剂量非法（负数、NaN、min>max）拒绝。 */
test('calculateVolumePerDose：非法剂量拒绝', () => {
  expectRejectVolume(calculateVolumePerDose({ dose: { min: -5, max: 10 }, concentrationPerMl: 20, unit: 'mg' }), 'INVALID_INPUT');
  expectRejectVolume(calculateVolumePerDose({ dose: { min: Number.NaN, max: 10 }, concentrationPerMl: 20, unit: 'mg' }), 'INVALID_INPUT');
  expectRejectVolume(calculateVolumePerDose({ dose: { min: 80, max: 40 }, concentrationPerMl: 20, unit: 'mg' }), 'INVALID_INPUT');
});

function expectRejectVolume(
  result: ReturnType<typeof calculateVolumePerDose>,
  code: 'UNKNOWN_CONCENTRATION' | 'INVALID_INPUT',
): void {
  if (result.ok) assert.fail(`期望拒绝（${code}），实际返回了体积`);
  assert.equal(result.code, code);
  assert.equal(result.disclaimer, DOSING_DISCLAIMER);
  assert.ok(result.reason.length > 0);
}

/** 通用安全条目：阿司匹林禁用（瑞氏综合征）、过敏交叉、教学计算口径。 */
test('GENERAL_SAFETY_NOTES：通用安全条目齐备', () => {
  assert.ok(GENERAL_SAFETY_NOTES.length >= 3);
  assert.ok(GENERAL_SAFETY_NOTES.some((n) => n.includes('阿司匹林') && n.includes('瑞氏综合征')));
  assert.ok(GENERAL_SAFETY_NOTES.some((n) => n.includes('交叉过敏')));
  assert.ok(GENERAL_SAFETY_NOTES.some((n) => n.includes('教学计算')));
});

/** 结构性不变量：成功结果的单次/每日范围必须是 min ≤ max 的区间（永远是范围，不是单一数字字段）。 */
test('calculateDose：输出恒为范围结构', () => {
  for (const drug of DOSING_DRUG_IDS) {
    const r = calculateDose({ drug, weightKg: 14, ageMonths: 40 });
    const calc = expectOk(r);
    assert.ok(calc.perDose.min <= calc.perDose.max);
    assert.ok(calc.dailyTotal.min <= calc.dailyTotal.max);
    assert.ok(calc.formula.length > 0);
  }
});
