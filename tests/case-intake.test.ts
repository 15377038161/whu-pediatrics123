import assert from 'node:assert/strict';
import test from 'node:test';
import { additionalMeasurementDisplayStatus, caseIntakeSchema, intakeVitalDisplayStatus } from '@/domain/case-intake';

const sourceText = (value: string) => ({ value, origin: 'source', availableFromStage: 'triage' });
const pendingContext = { value: null, status: 'requires-source-review' };
const vital = (code: 'temperature' | 'heartRate' | 'respiratoryRate' | 'spo2', label: string, value: number | null, unit: string) => ({
  code, label, value, unit,
  status: value === null ? 'not-recorded-in-source' : 'recorded',
  origin: 'source', sourceLocator: `vitals.${code}`, availableFromStage: 'triage',
  timepoint: value === null ? null : '接诊时', method: null, site: null,
  contextStatus: 'measurement-context-requires-source-review',
});

const intake = caseIntakeSchema.parse({
  patient: {
    anonymousId: { value: '儿科教学患儿-001', origin: 'anonymous-teaching-identifier', availableFromStage: 'triage' },
    age: sourceText('2岁'), sex: sourceText('男'),
    caregiver: { value: '母亲', origin: 'existing-role-setting', availableFromStage: 'triage', sourceRecordConfirmed: false },
  },
  encounter: {
    chiefComplaint: sourceText('咳嗽2天'),
    setting: pendingContext, arrivalMode: pendingContext, referralBackground: pendingContext, encounterTime: pendingContext,
  },
  initialVitals: [vital('temperature', '体温', 38.2, '℃'), vital('heartRate', '心率', null, '次/分'), vital('respiratoryRate', '呼吸', 32, '次/分'), vital('spo2', 'SpO₂', 98, '%')],
  additionalMeasurements: [
    { code: 'weight', label: '体重', value: null, unit: 'kg', status: 'requires-source-review', availableFromStage: 'after-measurement' },
    { code: 'height', label: '身高/身长', value: null, unit: 'cm', status: 'not-recorded-in-source', availableFromStage: 'after-measurement' },
    { code: 'bloodPressure', label: '血压', value: '90/60', unit: 'mmHg', status: 'recorded', availableFromStage: 'after-measurement' },
  ],
  initialObservations: { status: 'student-observation-required', recordedFindings: [] },
  initialAssessmentTasks: ['观察精神与呼吸状态', '询问症状起始与变化'],
  historyDisclosure: '其他病史须通过问诊获得。',
  displayMissingValues: '原资料未记录不等于正常。',
});

test('七项测量展示状态不会混用', () => {
  assert.equal(intakeVitalDisplayStatus(intake.initialVitals[0]), 'obtained');
  assert.equal(intakeVitalDisplayStatus(intake.initialVitals[1]), 'missing');
  assert.deepEqual(intake.additionalMeasurements.map(additionalMeasurementDisplayStatus), ['pending', 'missing', 'obtained']);
});

test('缺失或待核对项目禁止夹带患者数值', () => {
  assert.throws(() => caseIntakeSchema.parse({
    ...intake,
    initialVitals: intake.initialVitals.map((item) => item.code === 'heartRate' ? { ...item, value: 120 } : item),
  }), /原资料未记录时不能补造数值/);
  assert.throws(() => caseIntakeSchema.parse({
    ...intake,
    additionalMeasurements: intake.additionalMeasurements.map((item) => item.code === 'weight' ? { ...item, value: 12 } : item),
  }), /待核对或未记录的测量项目不能带患者数值/);
});
