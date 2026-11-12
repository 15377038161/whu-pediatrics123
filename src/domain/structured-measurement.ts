import { z } from 'zod';
import { EXAM_LOCATION_IDS, SOURCE_EXAM_TOOL_IDS } from './source-exam-contract';
import { stageReached, type Stage } from './agent';
import { VITAL_MEASUREMENT_RANGES } from './vital-measurement';

export const measurementIndicatorSchema = z.enum([
  'temperature', 'heartRate', 'respiratoryRate', 'spo2',
  'bloodPressure', 'weight', 'height', 'headCircumference',
]);
export type MeasurementIndicator = z.infer<typeof measurementIndicatorSchema>;

const measurementStageSchema = z.enum(['triage', 'exam']);
const measurementValueSchema = z.number().finite();

/** Author-provided fixed teaching readings. No runtime paragraph extraction or unit conversion. */
const fixedStructuredMeasurementShape = z.object({
  indicator: measurementIndicatorSchema,
  value: measurementValueSchema.optional(),
  systolic: measurementValueSchema.optional(),
  diastolic: measurementValueSchema.optional(),
  unit: z.string().trim().min(1).max(20),
  toolId: z.enum(SOURCE_EXAM_TOOL_IDS),
  bodyPartId: z.enum(EXAM_LOCATION_IDS),
  method: z.string().trim().min(1).max(500),
  timepoint: z.string().trim().min(1).max(500),
  origin: z.enum(['source', 'teaching-simulation']),
  sourceLocator: z.string().trim().min(1).max(300),
  preconditions: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  availableFromStage: measurementStageSchema.default('exam'),
  /** A non-empty condition names a later clinical snapshot; it is not an initial-exam reading. */
  currentCaseCondition: z.string().trim().min(1).max(160).optional(),
  phaseId: z.string().trim().min(1).max(160).optional(),
}).strict();

function validateFixedStructuredMeasurement(record: z.infer<typeof fixedStructuredMeasurementShape>, ctx: z.RefinementCtx): void {
  const expectedUnits: Record<MeasurementIndicator, string> = {
    temperature: '℃', heartRate: '次/分', respiratoryRate: '次/分', spo2: '%',
    bloodPressure: 'mmHg', weight: 'kg', height: 'cm', headCircumference: 'cm',
  };
  if (record.unit !== expectedUnits[record.indicator]) {
    ctx.addIssue({ code: 'custom', path: ['unit'], message: 'MEASUREMENT_UNIT_MISMATCH' });
  }
  if (record.indicator === 'bloodPressure') {
    if (record.value !== undefined || record.systolic === undefined || record.diastolic === undefined) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'BLOOD_PRESSURE_PAIR_REQUIRED' });
    } else if (record.systolic < 40 || record.systolic > 260 || record.diastolic < 20 || record.diastolic > 180 || record.systolic <= record.diastolic) {
      ctx.addIssue({ code: 'custom', path: ['systolic'], message: 'BLOOD_PRESSURE_OUT_OF_RANGE' });
    }
    return;
  }
  if (record.value === undefined || record.systolic !== undefined || record.diastolic !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'SINGLE_MEASUREMENT_VALUE_REQUIRED' });
    return;
  }
  const ranges: Record<Exclude<MeasurementIndicator, 'bloodPressure'>, readonly [number, number]> = {
    ...VITAL_MEASUREMENT_RANGES,
    weight: [0.2, 300], height: [20, 230], headCircumference: [20, 80],
  };
  const [minimum, maximum] = ranges[record.indicator];
  if (record.value < minimum || record.value > maximum) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'MEASUREMENT_OUT_OF_RANGE' });
  }
}

export const fixedStructuredMeasurementSchema = fixedStructuredMeasurementShape.superRefine(validateFixedStructuredMeasurement);

export const measurementContractSchema = z.object({
  indicator: measurementIndicatorSchema,
  status: z.enum(['applicable', 'conditional', 'not_applicable', 'unspecified']),
  reason: z.string().trim().min(1).max(1000).optional(),
  readyForActivation: z.boolean(),
  releaseStage: measurementStageSchema,
  syncTarget: z.string().trim().min(1).max(160),
  candidates: z.array(fixedStructuredMeasurementSchema).max(12),
}).strict();
export type MeasurementContract = z.infer<typeof measurementContractSchema>;
export type FixedStructuredMeasurement = z.infer<typeof fixedStructuredMeasurementSchema>;

export const acquiredStructuredMeasurementSchema = fixedStructuredMeasurementShape.extend({
  acquiredAt: z.string().datetime({ offset: true }),
}).strict().superRefine(validateFixedStructuredMeasurement);
export type AcquiredStructuredMeasurement = z.infer<typeof acquiredStructuredMeasurementSchema>;

export interface MeasurementRelease {
  measurements: AcquiredStructuredMeasurement[];
  withheld: Array<{ indicator: MeasurementIndicator; reason: string; kind: 'condition' | 'stage' }>;
}

export function structuredMeasurementKey(record: Pick<FixedStructuredMeasurement, 'indicator' | 'toolId' | 'bodyPartId' | 'phaseId'>): string {
  return [record.indicator, record.toolId, record.bodyPartId, record.phaseId ?? 'initial'].join(':');
}

export function formatStructuredMeasurement(record: AcquiredStructuredMeasurement): string {
  const labels: Record<MeasurementIndicator, string> = {
    temperature: '体温', heartRate: '心率', respiratoryRate: '呼吸频率', spo2: 'SpO₂',
    bloodPressure: '血压', weight: '体重', height: '身长/身高', headCircumference: '头围',
  };
  const value = record.indicator === 'bloodPressure'
    ? `${record.systolic}/${record.diastolic}`
    : String(record.value);
  const origin = record.origin === 'source' ? '原病例记录值，本次操作释放' : '固定教学模拟测量，非原患者实测';
  return `${labels[record.indicator]} ${value} ${record.unit}；${record.method}；时点：${record.timepoint}；${origin}；本次获取 ${record.acquiredAt}`;
}

/** Exact pairing and author contract decide release. Later snapshots are never flattened into the initial exam. */
export function releaseStructuredMeasurements(
  contracts: readonly MeasurementContract[] | undefined,
  toolId: string,
  bodyPartId: string,
  stage: Stage,
  acquiredAt: string,
): MeasurementRelease {
  const result: MeasurementRelease = { measurements: [], withheld: [] };
  if (!contracts) return result;
  for (const contract of contracts) {
    for (const candidate of contract.candidates) {
      if (candidate.toolId !== toolId || candidate.bodyPartId !== bodyPartId) continue;
      const requiredStage = candidate.availableFromStage === 'exam' || contract.releaseStage === 'exam' ? 'exam' : 'triage';
      if (!stageReached(stage, requiredStage)) {
        result.withheld.push({ indicator: contract.indicator, kind: 'stage', reason: '该测量需在查体阶段完成正确操作后释放。' });
        continue;
      }
      if (!contract.readyForActivation || contract.status === 'not_applicable') {
        result.withheld.push({ indicator: contract.indicator, kind: 'condition', reason: contract.reason ?? '本例当前条件不适用，未释放测量值。' });
        continue;
      }
      if (candidate.currentCaseCondition) {
        result.withheld.push({ indicator: contract.indicator, kind: 'condition', reason: `该读数属于“${candidate.currentCaseCondition}”场景，当前初始查体不释放，也不覆盖初始测量。` });
        continue;
      }
      result.measurements.push(acquiredStructuredMeasurementSchema.parse({ ...candidate, acquiredAt }));
    }
  }
  return result;
}
