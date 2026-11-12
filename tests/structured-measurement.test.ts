import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fixedStructuredMeasurementSchema,
  formatStructuredMeasurement,
  releaseStructuredMeasurements,
  structuredMeasurementKey,
  type FixedStructuredMeasurement,
  type MeasurementContract,
} from '@/domain/structured-measurement';
import { fixedVitalMeasurementSchema } from '@/domain/vital-measurement';

const acquiredAt = '2026-01-02T08:00:00.000Z';

function reading(overrides: Partial<FixedStructuredMeasurement> = {}): FixedStructuredMeasurement {
  return fixedStructuredMeasurementSchema.parse({
    indicator: 'bloodPressure',
    systolic: 96,
    diastolic: 60,
    unit: 'mmHg',
    toolId: 'bp-cuff',
    bodyPartId: 'upper-arm',
    method: '儿童上臂血压计固定教学测量',
    timepoint: '初始查体',
    origin: 'teaching-simulation',
    sourceLocator: 'synthetic-measurement-contract',
    preconditions: ['选择合适袖带'],
    availableFromStage: 'exam',
    ...overrides,
  });
}

function contract(overrides: Partial<MeasurementContract> = {}): MeasurementContract {
  return {
    indicator: 'bloodPressure',
    status: 'applicable',
    readyForActivation: true,
    releaseStage: 'exam',
    syncTarget: 'bloodPressure',
    candidates: [reading()],
    ...overrides,
  };
}

test('结构化测量只接受正确的单值或血压双值及固定单位', () => {
  assert.equal(reading().systolic, 96);
  assert.equal(fixedStructuredMeasurementSchema.safeParse({ ...reading(), value: 96 }).success, false);
  assert.equal(fixedStructuredMeasurementSchema.safeParse({ ...reading(), unit: 'cm' }).success, false);
  assert.equal(fixedStructuredMeasurementSchema.safeParse({ ...reading(), systolic: 50, diastolic: 60 }).success, false);
  const temperature = reading({ indicator: 'temperature', value: 36.8, systolic: undefined, diastolic: undefined, unit: '℃', toolId: 'axillary-thermometer', bodyPartId: 'axilla' });
  assert.equal(temperature.value, 36.8);
});

test('呼吸暂停的0次/分是有效固定读数，两套测量契约采用同一边界', () => {
  const apnea = reading({
    indicator: 'respiratoryRate', value: 0, systolic: undefined, diastolic: undefined,
    unit: '次/分', toolId: 'inspection', bodyPartId: 'chest-lung', origin: 'source',
    method: '观察胸廓并计时', sourceLocator: 'source.sections.exam[108:113]',
  });
  assert.equal(apnea.value, 0);
  assert.equal(fixedVitalMeasurementSchema.parse({
    metric: 'respiratoryRate', value: 0, unit: '次/分', method: apnea.method,
    site: '胸部', origin: 'source', sourceLocator: apnea.sourceLocator, sourceTimepoint: null,
  }).value, 0);
  assert.equal(fixedStructuredMeasurementSchema.safeParse({ ...apnea, value: -1 }).success, false);
  assert.equal(fixedVitalMeasurementSchema.safeParse({
    metric: 'respiratoryRate', value: -1, unit: '次/分', method: apnea.method,
    site: '胸部', origin: 'source', sourceLocator: apnea.sourceLocator, sourceTimepoint: null,
  }).success, false);
});

test('正确器材部位和阶段释放固定测量，错配与阶段不足均不释放', () => {
  const released = releaseStructuredMeasurements([contract()], 'bp-cuff', 'upper-arm', 'exam', acquiredAt);
  assert.equal(released.measurements.length, 1);
  assert.equal(released.withheld.length, 0);
  assert.equal(released.measurements[0].acquiredAt, acquiredAt);
  assert.equal(structuredMeasurementKey(released.measurements[0]), 'bloodPressure:bp-cuff:upper-arm:initial');
  assert.match(formatStructuredMeasurement(released.measurements[0]), /96\/60 mmHg/);
  assert.match(formatStructuredMeasurement(released.measurements[0]), /非原患者实测/);

  for (const [toolId, bodyPartId] of [['bp-cuff', 'forehead'], ['stethoscope', 'upper-arm']] as const) {
    const result = releaseStructuredMeasurements([contract()], toolId, bodyPartId, 'exam', acquiredAt);
    assert.equal(result.measurements.length, 0);
    assert.equal(result.withheld.length, 0, '其他组合由器材部位规则处理，不能误报本契约已阻止');
  }
  const early = releaseStructuredMeasurements([contract()], 'bp-cuff', 'upper-arm', 'history', acquiredAt);
  assert.equal(early.measurements.length, 0);
  assert.equal(early.withheld[0].kind, 'stage');
});

test('不适用和后续病情场景均fail-closed，后续读数不会覆盖初始测量', () => {
  const notApplicable = releaseStructuredMeasurements([
    contract({ status: 'not_applicable', readyForActivation: false, reason: '本例不适用该测量。' }),
  ], 'bp-cuff', 'upper-arm', 'exam', acquiredAt);
  assert.equal(notApplicable.measurements.length, 0);
  assert.equal(notApplicable.withheld[0].reason, '本例不适用该测量。');

  const later = releaseStructuredMeasurements([
    contract({ candidates: [reading({ currentCaseCondition: '治疗后复测', phaseId: 'after-treatment', systolic: 104, diastolic: 66 })] }),
  ], 'bp-cuff', 'upper-arm', 'exam', acquiredAt);
  assert.equal(later.measurements.length, 0);
  assert.equal(later.withheld[0].kind, 'condition');
  assert.match(later.withheld[0].reason, /治疗后复测/);

  const initialAndLater = releaseStructuredMeasurements([
    contract({ candidates: [reading(), reading({ currentCaseCondition: '治疗后复测', phaseId: 'after-treatment', systolic: 104, diastolic: 66 })] }),
  ], 'bp-cuff', 'upper-arm', 'exam', acquiredAt);
  assert.equal(initialAndLater.measurements.length, 1);
  assert.equal(initialAndLater.measurements[0].systolic, 96);
});
