import { z } from 'zod';

const intakeOriginSchema = z.enum(['source', 'anonymous-teaching-identifier', 'existing-role-setting']);
const triageTextSchema = z.object({
  value: z.string().trim().min(1),
  origin: intakeOriginSchema,
  availableFromStage: z.literal('triage'),
}).strict();

export const intakeVitalSchema = z.object({
  code: z.enum(['temperature', 'heartRate', 'respiratoryRate', 'spo2']),
  label: z.string().trim().min(1),
  value: z.number().finite().nullable(),
  unit: z.string().trim().min(1),
  status: z.enum(['recorded', 'not-recorded-in-source']),
  origin: z.literal('source'),
  sourceLocator: z.string().trim().min(1),
  availableFromStage: z.literal('triage'),
  timepoint: z.string().nullable(),
  method: z.string().nullable(),
  site: z.string().nullable(),
  contextStatus: z.literal('measurement-context-requires-source-review'),
}).strict().superRefine((vital, ctx) => {
  if (vital.status === 'recorded' && vital.value === null) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: '已取得的生命体征必须保留原始数值' });
  }
  if (vital.status === 'not-recorded-in-source' && vital.value !== null) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: '原资料未记录时不能补造数值' });
  }
});

export const intakeAdditionalMeasurementSchema = z.object({
  code: z.enum(['weight', 'height', 'bloodPressure']),
  label: z.string().trim().min(1),
  value: z.union([z.number().finite(), z.string().trim().min(1)]).nullable(),
  unit: z.string().trim().min(1),
  status: z.enum(['requires-source-review', 'recorded', 'not-recorded-in-source']),
  availableFromStage: z.literal('after-measurement'),
}).strict().superRefine((measurement, ctx) => {
  if (measurement.status !== 'recorded' && measurement.value !== null) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: '待核对或未记录的测量项目不能带患者数值' });
  }
  if (measurement.status === 'recorded' && measurement.value === null) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: '已取得的测量项目必须保留数值' });
  }
});

const encounterContextSchema = z.object({
  value: z.string().trim().min(1).nullable(),
  status: z.literal('requires-source-review'),
}).strict();

export const caseIntakeSchema = z.object({
  patient: z.object({
    anonymousId: triageTextSchema.extend({ origin: z.literal('anonymous-teaching-identifier') }),
    age: triageTextSchema.extend({ origin: z.literal('source') }),
    sex: triageTextSchema.extend({ origin: z.literal('source') }),
    caregiver: triageTextSchema.extend({
      origin: z.literal('existing-role-setting'),
      sourceRecordConfirmed: z.boolean(),
    }),
  }).strict(),
  encounter: z.object({
    chiefComplaint: triageTextSchema.extend({ origin: z.literal('source') }),
    setting: encounterContextSchema,
    arrivalMode: encounterContextSchema,
    referralBackground: encounterContextSchema,
    encounterTime: encounterContextSchema,
  }).strict(),
  initialVitals: z.array(intakeVitalSchema).length(4).superRefine((vitals, ctx) => {
    const expected = ['temperature', 'heartRate', 'respiratoryRate', 'spo2'];
    if (new Set(vitals.map(item => item.code)).size !== expected.length || expected.some(code => !vitals.some(item => item.code === code))) {
      ctx.addIssue({ code: 'custom', message: '四项初始生命体征必须各出现一次' });
    }
  }),
  additionalMeasurements: z.array(intakeAdditionalMeasurementSchema).length(3).superRefine((measurements, ctx) => {
    const expected = ['weight', 'height', 'bloodPressure'];
    if (new Set(measurements.map(item => item.code)).size !== expected.length || expected.some(code => !measurements.some(item => item.code === code))) {
      ctx.addIssue({ code: 'custom', message: '体重、身高或身长、血压必须各出现一次' });
    }
  }),
  initialObservations: z.object({
    status: z.literal('student-observation-required'),
    recordedFindings: z.array(z.string()).max(0),
  }).strict(),
  initialAssessmentTasks: z.array(z.string().trim().min(1)).min(1).max(8),
  historyDisclosure: z.string().trim().min(1),
  displayMissingValues: z.string().trim().min(1),
}).strict();

export type CaseIntake = z.infer<typeof caseIntakeSchema>;
export type IntakeVital = CaseIntake['initialVitals'][number];
export type IntakeAdditionalMeasurement = CaseIntake['additionalMeasurements'][number];
export type IntakeDisplayStatus = 'obtained' | 'pending' | 'missing';

export function intakeVitalDisplayStatus(vital: IntakeVital): IntakeDisplayStatus {
  return vital.status === 'recorded' ? 'obtained' : 'missing';
}

export function additionalMeasurementDisplayStatus(measurement: IntakeAdditionalMeasurement): IntakeDisplayStatus {
  if (measurement.status === 'recorded') return 'obtained';
  if (measurement.status === 'not-recorded-in-source') return 'missing';
  return 'pending';
}
