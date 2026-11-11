import { z } from 'zod';

export const vitalMetricSchema = z.enum(['temperature', 'heartRate', 'respiratoryRate', 'spo2']);
export type VitalMetric = z.infer<typeof vitalMetricSchema>;
export const vitalMeasurementOriginSchema = z.enum(['source', 'teaching-simulation']);
export type VitalMeasurementOrigin = z.infer<typeof vitalMeasurementOriginSchema>;

const measurementFields = {
  metric: vitalMetricSchema,
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(20),
  method: z.string().trim().min(1).max(120),
  site: z.string().trim().min(1).max(120),
  origin: vitalMeasurementOriginSchema,
  sourceLocator: z.string().trim().min(1).max(300),
  sourceTimepoint: z.string().trim().min(1).max(200).nullable(),
};

const measurementShape = z.object(measurementFields).strict();
export const fixedVitalMeasurementSchema = measurementShape.superRefine(validateMeasurement);
export const vitalMeasurementSchema = measurementShape.extend({
  measuredAt: z.string().datetime({ offset: true }),
}).strict().superRefine(validateMeasurement);

export type FixedVitalMeasurement = z.infer<typeof fixedVitalMeasurementSchema>;
export type VitalMeasurement = z.infer<typeof vitalMeasurementSchema>;

export const VITAL_METRIC_LABELS: Record<VitalMetric, string> = {
  temperature: '体温',
  heartRate: '心率',
  respiratoryRate: '呼吸频率',
  spo2: 'SpO₂',
};

export const VITAL_METRIC_UNITS: Record<VitalMetric, string> = {
  temperature: '℃',
  heartRate: '次/分',
  respiratoryRate: '次/分',
  spo2: '%',
};

const ranges: Record<VitalMetric, readonly [number, number]> = {
  temperature: [30, 45],
  heartRate: [20, 300],
  respiratoryRate: [5, 120],
  spo2: [30, 100],
};

function validateMeasurement(value: z.infer<typeof measurementShape>, ctx: z.RefinementCtx): void {
  const [minimum, maximum] = ranges[value.metric];
  if (value.value < minimum || value.value > maximum) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: `${VITAL_METRIC_LABELS[value.metric]}超出允许范围` });
  }
  if (value.unit !== VITAL_METRIC_UNITS[value.metric]) {
    ctx.addIssue({ code: 'custom', path: ['unit'], message: `${VITAL_METRIC_LABELS[value.metric]}单位必须与指标一致` });
  }
}

export function releaseVitalMeasurements(
  definitions: readonly FixedVitalMeasurement[],
  measuredAt: string,
): VitalMeasurement[] {
  return definitions.map(definition => vitalMeasurementSchema.parse({ ...definition, measuredAt }));
}

export function formatVitalMeasurement(measurement: VitalMeasurement): string {
  const origin = measurement.origin === 'source' ? '原病例记录值，本次操作释放' : '教学模拟测量，非原患者实测';
  const sourceTime = measurement.sourceTimepoint ? `；原记录时点：${measurement.sourceTimepoint}` : '';
  return `${VITAL_METRIC_LABELS[measurement.metric]} ${measurement.value} ${measurement.unit}；${measurement.method}；${measurement.site}；${origin}；本次操作时间 ${measurement.measuredAt}${sourceTime}`;
}
