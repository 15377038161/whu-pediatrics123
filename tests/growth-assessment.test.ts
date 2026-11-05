import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FONTANEL_FACTS,
  GROWTH_ANCHORS,
  GROWTH_AGE_MONTHS_MAX,
  GROWTH_DISCLAIMER,
  MILESTONES,
  MOTOR_MNEMONIC,
  UPPER_ARM_FACTS,
  ageLabel,
  assessGrowth,
  inferAgeFromGrowth,
  type AgeInference,
  type GrowthAssessment,
  type GrowthRejection,
  type GrowthRejectionCode,
  type GrowthResult,
  type InferenceResult,
} from '@/domain/growth-assessment';

function expectAssessment(result: GrowthResult): GrowthAssessment {
  if (!result.ok) assert.fail(`期望评估成功，实际被拒绝（${result.code}）：${result.reason}`);
  return result;
}

function expectGrowthRejection(result: GrowthResult | InferenceResult, code: GrowthRejectionCode): GrowthRejection {
  if (result.ok) assert.fail(`期望类型化拒绝（${code}），实际返回了评估结果`);
  assert.equal(result.code, code);
  return result;
}

function expectInference(result: InferenceResult): AgeInference {
  if (!result.ok) assert.fail(`期望反推成功，实际被拒绝（${result.code}）：${result.reason}`);
  return result;
}

function metric(assessment: GrowthAssessment, kind: string) {
  const found = assessment.metrics.find((item) => item.kind === kind);
  if (!found) assert.fail(`缺少指标 ${kind}`);
  return found;
}

/** 教材锚点：13 行、月龄严格递增、覆盖 0–120 个月，出生与 10 岁端点为教材典型值。 */
test('GROWTH_ANCHORS：0–120 个月教材锚点单调且端点正确', () => {
  assert.equal(GROWTH_ANCHORS.length, 13);
  assert.equal(GROWTH_ANCHORS[0].ageMonths, 0);
  assert.equal(GROWTH_ANCHORS[GROWTH_ANCHORS.length - 1].ageMonths, GROWTH_AGE_MONTHS_MAX);
  assert.equal(GROWTH_AGE_MONTHS_MAX, 120);
  for (let i = 1; i < GROWTH_ANCHORS.length; i += 1) {
    assert.ok(GROWTH_ANCHORS[i].ageMonths > GROWTH_ANCHORS[i - 1].ageMonths, '月龄必须递增');
    assert.ok(GROWTH_ANCHORS[i].weightKg > GROWTH_ANCHORS[i - 1].weightKg, '体重必须递增');
    assert.ok(GROWTH_ANCHORS[i].heightCm >= GROWTH_ANCHORS[i - 1].heightCm, '身高不得回退');
    assert.ok(GROWTH_ANCHORS[i].headCm >= GROWTH_ANCHORS[i - 1].headCm, '头围不得回退');
  }
  assert.deepEqual(GROWTH_ANCHORS[0], { ageMonths: 0, weightKg: 3.3, heightCm: 50, headCm: 34 });
  assert.deepEqual(GROWTH_ANCHORS[3], { ageMonths: 12, weightKg: 9.5, heightCm: 75, headCm: 46 });
  assert.deepEqual(GROWTH_ANCHORS[12], { ageMonths: 120, weightKg: 28, heightCm: 140, headCm: 53 });
});

/** 免责声明必须点明「教学估算」与「须用标准差曲线」，否则会被当成诊断依据。 */
test('GROWTH_DISCLAIMER：声明教学口径并要求标准差曲线', () => {
  assert.match(GROWTH_DISCLAIMER, /教学/);
  assert.match(GROWTH_DISCLAIMER, /标准差曲线/);
  assert.match(GROWTH_DISCLAIMER, /不作为个体患儿的诊断/);
  assert.match(MOTOR_MNEMONIC, /^二抬四翻六会坐，七滚八爬周会走$/);
});

/** 里程碑口诀表：月龄递增、运动与语言两栏都不得留空。 */
test('MILESTONES：11 条里程碑双栏完整且月龄递增', () => {
  assert.equal(MILESTONES.length, 11);
  for (let i = 1; i < MILESTONES.length; i += 1) {
    assert.ok(MILESTONES[i].ageMonths > MILESTONES[i - 1].ageMonths);
  }
  for (const item of MILESTONES) {
    assert.ok(item.motor.trim().length > 0, `${item.ageLabel} 运动发育留空`);
    assert.ok(item.language.trim().length > 0, `${item.ageLabel} 语言发育留空`);
    assert.ok(item.ageLabel.length > 0);
  }
});

test('ageLabel：整岁不带月、非整岁带月', () => {
  assert.equal(ageLabel(0), '0 个月');
  assert.equal(ageLabel(6), '6 个月');
  assert.equal(ageLabel(12), '1 岁');
  assert.equal(ageLabel(18), '1 岁 6 个月');
  assert.equal(ageLabel(24), '2 岁');
  assert.equal(ageLabel(72), '6 岁');
  assert.equal(ageLabel(120), '10 岁');
});

/** 评估输出七项指标，顺序固定，方便界面稳定渲染。 */
test('assessGrowth：七项指标齐备且顺序固定', () => {
  const result = expectAssessment(assessGrowth({ ageMonths: 24 }));
  assert.deepEqual(result.metrics.map((item) => item.kind), [
    'weight', 'height', 'head', 'chest', 'teeth', 'fontanel', 'upper-arm',
  ]);
  assert.equal(result.ageLabel, '2 岁');
  assert.equal(result.disclaimer, GROWTH_DISCLAIMER);
  for (const item of result.metrics) {
    assert.ok(item.label.trim().length > 0);
    assert.ok(item.typical.trim().length > 0, `${item.kind} 典型值留空`);
    assert.ok(item.steps.length > 0, `${item.kind} 缺少手算过程`);
    for (const step of item.steps) assert.ok(step.trim().length > 0);
  }
});

/** 1–6 个月体重公式：出生体重 3.3 + 月龄 × 0.7，手算过程必须逐步可见。 */
test('assessGrowth(6)：体重走 1–6 个月公式并展示手算', () => {
  const result = expectAssessment(assessGrowth({ ageMonths: 6 }));
  const weight = metric(result, 'weight');
  assert.match(weight.formula ?? '', /1–6 个月：体重\(kg\) = 出生体重 \+ 月龄 × 0\.7/);
  assert.equal(weight.typical, '7.5 kg');
  assert.equal(weight.estimate, '7.5 kg');
  assert.ok(weight.steps.some((step) => step.includes('3.3 + 6 × 0.7 = 7.5 kg')));
  assert.ok(!weight.steps.some((step) => step.includes('相差')), '公式与典型值一致时不得输出偏差步骤');
  assert.match(weight.note ?? '', /出生体重/);
});

/** 公式在 1–3 个月明显低估，必须把偏差讲出来，不能让学生以为公式等于典型值。 */
test('assessGrowth(3)：公式估算与锚点典型值的偏差被明示', () => {
  const weight = metric(expectAssessment(assessGrowth({ ageMonths: 3 })), 'weight');
  assert.equal(weight.estimate, '5.4 kg');
  assert.equal(weight.typical, '6.5 kg');
  assert.ok(weight.steps.some((step) => step.includes('相差 1.1 kg')));
});

/** 7–12 个月体重公式：6 + 月龄 × 0.25；典型值由锚点内插给出，两者并列展示。 */
test('assessGrowth(9)：体重走 7–12 个月公式，典型值按锚点内插', () => {
  const weight = metric(expectAssessment(assessGrowth({ ageMonths: 9 })), 'weight');
  assert.match(weight.formula ?? '', /7–12 个月：体重\(kg\) = 6 \+ 月龄 × 0\.25/);
  assert.ok(weight.steps.some((step) => step.includes('6 + 9 × 0.25 = 8.3 kg')));
  assert.equal(weight.estimate, '8.3 kg');
  assert.equal(weight.typical, '8.5 kg');
});

/** 2–12 岁体重公式：年龄 × 2 + 8；身高 2–6 岁走 ×7+75。 */
test('assessGrowth(36)：3 岁体重 14 kg、身高走 2–6 岁公式 96 cm', () => {
  const result = expectAssessment(assessGrowth({ ageMonths: 36 }));
  const weight = metric(result, 'weight');
  assert.match(weight.formula ?? '', /2–12 岁：体重\(kg\) = 年龄\(岁\) × 2 \+ 8/);
  assert.ok(weight.steps.some((step) => step.includes('3 × 2 + 8 = 14 kg')));
  assert.equal(weight.typical, '14 kg');
  const height = metric(result, 'height');
  assert.match(height.formula ?? '', /2–6 岁：身高\(cm\) = 年龄\(岁\) × 7 \+ 75/);
  assert.ok(height.steps.some((step) => step.includes('3 × 7 + 75 = 96 cm')));
  assert.equal(height.typical, '96 cm');
});

/** 7–10 岁身高改走 ×6+80；≥8 岁追加青春期误差警示。 */
test('assessGrowth(96)：8 岁身高走 7–10 岁公式并给出青春期警示', () => {
  const result = expectAssessment(assessGrowth({ ageMonths: 96 }));
  const height = metric(result, 'height');
  assert.match(height.formula ?? '', /7–10 岁：身高\(cm\) = 年龄\(岁\) × 6 \+ 80/);
  assert.ok(height.steps.some((step) => step.includes('8 × 6 + 80 = 128 cm')));
  assert.equal(height.typical, '128 cm');
  assert.ok(result.warnings.some((text) => text.includes('青春期')));
  assert.ok(result.warnings.some((text) => text.includes('标准差曲线')));
});

/** 2 岁以下身高不给线性公式，只给锚点内插典型值与卧位/立位测量口径。 */
test('assessGrowth(18)：2 岁内身高不给线性公式，典型值由锚点内插', () => {
  const height = metric(expectAssessment(assessGrowth({ ageMonths: 18 })), 'height');
  assert.equal(height.formula, undefined);
  assert.equal(height.estimate, undefined);
  assert.equal(height.typical, '81 cm');
  assert.match(height.note ?? '', /卧位量床/);
  assert.match(height.note ?? '', /相差约 1 cm/);
});

/** 头围、胸围交叉、乳牙数、前囟、上臂围均须给出教材口径正文。 */
test('assessGrowth(12)：头围 46 cm、胸围≈头围交叉点、乳牙 6–8 颗', () => {
  const result = expectAssessment(assessGrowth({ ageMonths: 12 }));
  assert.equal(metric(result, 'head').typical, '46 cm');
  assert.match(metric(result, 'head').note ?? '', /脑积水/);
  const chest = metric(result, 'chest');
  assert.match(chest.formula ?? '', /1 岁后：胸围 ≈ 头围 \+ \(年龄岁数 − 1\)/);
  assert.equal(chest.typical, '约 46 cm');
  assert.equal(metric(result, 'teeth').typical, '约 6–8 颗');
  assert.match(metric(result, 'teeth').formula ?? '', /乳牙数 ≈ 月龄 − \(4~6\)/);
});

test('assessGrowth(60)：5 岁胸围按头围 + (岁数 − 1) 推算', () => {
  const chest = metric(expectAssessment(assessGrowth({ ageMonths: 60 })), 'chest');
  assert.equal(chest.typical, '约 54 cm');
  assert.ok(chest.steps.some((step) => step.includes('50 cm + (5 − 1) = 54 cm')));
});

/** 4–5 个月乳牙公式结果为 0，必须写成「尚未萌出或刚萌出」而不是「约 0 颗」。 */
test('assessGrowth(5)：乳牙尚未萌出的表述不写成 0 颗', () => {
  const teeth = metric(expectAssessment(assessGrowth({ ageMonths: 5 })), 'teeth');
  assert.equal(teeth.typical, '尚未萌出或刚萌出（乳牙 4–10 个月开始萌出）');
  assert.match(teeth.note ?? '', /出牙延迟/);
});

test('assessGrowth(30)：乳牙出齐；assessGrowth(84)：补恒牙替换正文', () => {
  assert.equal(metric(expectAssessment(assessGrowth({ ageMonths: 30 })), 'teeth').typical, '乳牙 20 颗已出齐');
  const teeth = metric(expectAssessment(assessGrowth({ ageMonths: 84 })), 'teeth');
  assert.ok(teeth.steps.some((step) => step.includes('六龄牙')));
});

/** 前囟与上臂围正文直接引用教材事实串，避免界面与领域层各写一份。 */
test('assessGrowth：前囟/上臂围正文与教材事实串一致', () => {
  const before = expectAssessment(assessGrowth({ ageMonths: 6 }));
  assert.equal(metric(before, 'fontanel').typical, '前囟未闭（约 1.5–2.0 cm 起逐渐缩小）');
  assert.equal(metric(before, 'fontanel').note, FONTANEL_FACTS);
  assert.match(FONTANEL_FACTS, /12–18 个月闭合/);
  const closing = expectAssessment(assessGrowth({ ageMonths: 15 }));
  assert.equal(metric(closing, 'fontanel').typical, '前囟正在闭合（12–18 个月闭合）');
  const closed = expectAssessment(assessGrowth({ ageMonths: 24 }));
  assert.equal(metric(closed, 'fontanel').typical, '前囟已闭合');
  assert.equal(metric(before, 'upper-arm').note, UPPER_ARM_FACTS);
  assert.match(UPPER_ARM_FACTS, /13\.5 cm/);
});

/** 里程碑只回最近三条，且不得越过当前月龄（不能把未达到的发育当已完成）。 */
test('assessGrowth：里程碑取不晚于当前月龄的最近三条', () => {
  assert.deepEqual(expectAssessment(assessGrowth({ ageMonths: 6 })).milestones.map((item) => item.ageMonths), [2, 4, 6]);
  assert.deepEqual(expectAssessment(assessGrowth({ ageMonths: 20 })).milestones.map((item) => item.ageMonths), [12, 15, 18]);
  assert.deepEqual(expectAssessment(assessGrowth({ ageMonths: 120 })).milestones.map((item) => item.ageMonths), [36, 48, 60]);
  assert.deepEqual(expectAssessment(assessGrowth({ ageMonths: 1 })).milestones.map((item) => item.ageMonths), []);
});

/** 安全红线：非法输入、负月龄、超 10 岁一律类型化拒绝，不外推。 */
test('assessGrowth：非法与超范围月龄类型化拒绝', () => {
  assert.equal(expectGrowthRejection(assessGrowth({ ageMonths: Number.NaN }), 'INVALID_INPUT').code, 'INVALID_INPUT');
  assert.equal(expectGrowthRejection(assessGrowth({ ageMonths: Number.POSITIVE_INFINITY }), 'INVALID_INPUT').code, 'INVALID_INPUT');
  const negative = expectGrowthRejection(assessGrowth({ ageMonths: -3 }), 'AGE_OUT_OF_RANGE');
  assert.match(negative.reason, /不接受负数/);
  assert.equal(negative.disclaimer, GROWTH_DISCLAIMER);
  const teen = expectGrowthRejection(assessGrowth({ ageMonths: 121 }), 'AGE_OUT_OF_RANGE');
  assert.match(teen.reason, /青春期/);
  assert.match(teen.reason, /不外推/);
  assert.equal(expectGrowthRejection(assessGrowth({ ageMonths: 180 }), 'AGE_OUT_OF_RANGE').code, 'AGE_OUT_OF_RANGE');
});

/** 端点仍可用：0 个月与 120 个月都落在适用范围内。 */
test('assessGrowth：0 与 120 个月为可用端点', () => {
  const newborn = expectAssessment(assessGrowth({ ageMonths: 0 }));
  assert.equal(metric(newborn, 'weight').typical, '3.3 kg');
  assert.equal(metric(newborn, 'height').typical, '50 cm');
  assert.equal(metric(newborn, 'chest').typical, '约 32 cm');
  const ten = expectAssessment(assessGrowth({ ageMonths: 120 }));
  assert.equal(metric(ten, 'weight').typical, '28 kg');
  assert.equal(metric(ten, 'height').typical, '140 cm');
  assert.ok(metric(ten, 'height').steps.some((step) => step.includes('10 × 6 + 80 = 140 cm')));
});

/** 小数月龄四舍五入到整月，界面输入不必强制整数。 */
test('assessGrowth：小数月龄四舍五入到整月', () => {
  assert.equal(expectAssessment(assessGrowth({ ageMonths: 6.4 })).ageMonths, 6);
  assert.equal(expectAssessment(assessGrowth({ ageMonths: 6.5 })).ageMonths, 7);
});

/** 反推：体重 9.5 kg 精确命中 12 个月锚点。 */
test('inferAgeFromGrowth(weight 9.5)：命中 12 个月锚点', () => {
  const result = expectInference(inferAgeFromGrowth({ kind: 'weight', value: 9.5 }));
  assert.equal(result.estimatedMonths, 12);
  assert.deepEqual(result.band, { min: 6, max: 12 });
  assert.equal(result.label, '体重');
  assert.equal(result.value, 9.5);
  assert.equal(result.disclaimer, GROWTH_DISCLAIMER);
  assert.ok(result.steps.some((step) => step.includes('线性内插')));
  assert.ok(result.steps.some((step) => step.includes('12 个月')));
});

/** 反推：锚点之间必须线性内插（8.5 kg → 9 个月），不得直接四舍到最近锚点。 */
test('inferAgeFromGrowth：锚点之间线性内插', () => {
  const weight = expectInference(inferAgeFromGrowth({ kind: 'weight', value: 8.5 }));
  assert.equal(weight.estimatedMonths, 9);
  assert.deepEqual(weight.band, { min: 6, max: 12 });
  const height = expectInference(inferAgeFromGrowth({ kind: 'height', value: 81 }));
  assert.equal(height.estimatedMonths, 18);
  assert.deepEqual(height.band, { min: 12, max: 24 });
  assert.equal(height.label, '身高（身长）');
  const head = expectInference(inferAgeFromGrowth({ kind: 'head', value: 40 }));
  assert.equal(head.estimatedMonths, 3);
  assert.deepEqual(head.band, { min: 0, max: 3 });
});

/** 反推：乳牙数按「月龄 − 4~6」反解为区间，0 颗与 20 颗为特例。 */
test('inferAgeFromGrowth(teeth)：乳牙数反解为月龄区间', () => {
  const eight = expectInference(inferAgeFromGrowth({ kind: 'teeth', value: 8 }));
  assert.deepEqual(eight.band, { min: 12, max: 14 });
  assert.equal(eight.estimatedMonths, 13);
  assert.match(eight.formula ?? '', /乳牙数 ≈ 月龄 − \(4~6\)/);
  const none = expectInference(inferAgeFromGrowth({ kind: 'teeth', value: 0 }));
  assert.deepEqual(none.band, { min: 0, max: 10 });
  assert.ok(none.steps.some((step) => step.includes('出牙延迟')));
  const full = expectInference(inferAgeFromGrowth({ kind: 'teeth', value: 20 }));
  assert.deepEqual(full.band, { min: 24, max: 30 });
  assert.equal(full.estimatedMonths, 30);
});

/** 反推安全红线：超锚点范围、非法值、未收录指标一律拒绝，不外推。 */
test('inferAgeFromGrowth：越界与未知指标类型化拒绝', () => {
  const low = expectGrowthRejection(inferAgeFromGrowth({ kind: 'weight', value: 2.5 }), 'VALUE_OUT_OF_RANGE');
  assert.match(low.reason, /低于出生时典型值 3.3 kg/);
  assert.match(low.reason, /不做外推/);
  const high = expectGrowthRejection(inferAgeFromGrowth({ kind: 'weight', value: 45 }), 'VALUE_OUT_OF_RANGE');
  assert.match(high.reason, /高于 10 岁典型值 28 kg/);
  assert.match(high.reason, /青春期/);
  assert.equal(expectGrowthRejection(inferAgeFromGrowth({ kind: 'height', value: 175 }), 'VALUE_OUT_OF_RANGE').code, 'VALUE_OUT_OF_RANGE');
  assert.equal(expectGrowthRejection(inferAgeFromGrowth({ kind: 'head', value: 0 }), 'VALUE_OUT_OF_RANGE').code, 'VALUE_OUT_OF_RANGE');
  assert.equal(expectGrowthRejection(inferAgeFromGrowth({ kind: 'weight', value: Number.NaN }), 'INVALID_INPUT').code, 'INVALID_INPUT');
  assert.equal(expectGrowthRejection(inferAgeFromGrowth({ kind: 'teeth', value: 21 }), 'VALUE_OUT_OF_RANGE').code, 'VALUE_OUT_OF_RANGE');
  assert.equal(expectGrowthRejection(inferAgeFromGrowth({ kind: 'teeth', value: -1 }), 'VALUE_OUT_OF_RANGE').code, 'VALUE_OUT_OF_RANGE');
  const unknown = expectGrowthRejection(inferAgeFromGrowth({ kind: 'bmi', value: 16 }), 'UNKNOWN_MEASUREMENT');
  assert.match(unknown.reason, /未收录的推断指标「bmi」/);
  assert.match(unknown.reason, /weight（kg）、height（cm）、head（cm）、teeth/);
  assert.equal(unknown.disclaimer, GROWTH_DISCLAIMER);
});

/** 反推结果必须与正向评估互洽：反推得到的月龄再正向评估，典型值应与实测值同量级。 */
test('正反双向互洽：反推月龄再正向评估回到同一锚点带', () => {
  for (const anchor of GROWTH_ANCHORS) {
    const inferred = expectInference(inferAgeFromGrowth({ kind: 'weight', value: anchor.weightKg }));
    assert.ok(inferred.estimatedMonths <= anchor.ageMonths + 3 && inferred.estimatedMonths >= anchor.ageMonths - 3,
      `体重 ${anchor.weightKg} kg 反推 ${inferred.estimatedMonths} 个月，偏离锚点 ${anchor.ageMonths} 个月过多`);
    const assessed = expectAssessment(assessGrowth({ ageMonths: inferred.estimatedMonths }));
    assert.equal(assessed.metrics[0].kind, 'weight');
    assert.equal(assessed.ageMonths, inferred.estimatedMonths);
  }
});
