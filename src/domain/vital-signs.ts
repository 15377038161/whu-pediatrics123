import type { SessionState, VitalSigns } from '@/domain/agent';
import type {VitalMeasurement} from '@/domain/vital-measurement';

export type VitalSource = 'initial' | 'exam' | 'simulation' | 'history';
export type VitalField = keyof VitalSigns;
export interface DisplayedVital {
  value: number | null;
  source: VitalSource | null;
  measurement?: VitalMeasurement;
}
export type DisplayedVitals = Record<VitalField, DisplayedVital>;

export const VITAL_SOURCE_LABELS: Record<VitalSource, string> = {
  initial: '接诊记录',
  exam: '本轮查体 · 原病例记录值',
  simulation: '教学模拟测量 · 非原患者实测',
  history: '病史提供',
};

const TEMPERATURE_PATTERNS: readonly RegExp[] = [
  /(?:^|[^A-Za-z])T\s*[:：]?\s*(\d{2}(?:\.\d{1,2})?)\s*(?:℃|度)/i,
  /体温\s*[:：]?\s*(\d{2}(?:\.\d{1,2})?)\s*(?:℃|度)/,
  /(?:最高|热峰|峰值|烧到|发热到)\D{0,10}(\d{2}(?:\.\d{1,2})?)\s*(?:℃|度)/,
  /(?:^|[，。；;、\s])(\d{2}(?:\.\d{1,2})?)\s*(?:℃|度)/,
];
const HEART_RATE_PATTERNS: readonly RegExp[] = [
  /(?:H\s*R|心率|脉搏)\s*[:：]?\s*(\d{2,3})/i,
  /(?:^|[^A-Za-z])P\s*[:：]?\s*(\d{2,3})\s*(?:次\/分|\/min|bpm)/i,
];
const RESPIRATORY_RATE_PATTERNS: readonly RegExp[] = [
  /(?:^|[^A-Za-z])R{1,2}\s*[:：]?\s*(\d{1,3})\s*(?:次\/分|\/min|bpm)/i,
  /呼吸\s*[:：]?\s*(\d{1,3})\s*(?:次\/分|\/min)/,
];
const SPO2_PATTERNS: readonly RegExp[] = [
  /(?:S\s*p\s*O\s*[₂2]?|血氧(?:饱和度)?)\s*(?:(?:读数(?:为|是)?|维持在|保持(?:为|在)?|为|是)\s*)?[:：]?\s*(\d{2,3})\s*%?/i,
];

function matchInRange(text: string, patterns: readonly RegExp[], min: number, max: number): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= min && value <= max) return value;
  }
  return null;
}

/** Used for authoring and already-released caregiver/child history. Runtime exam release never calls this extractor. */
export function extractVitalSigns(text: string): Partial<VitalSigns> {
  if (!text.trim()) return {};
  const result: Partial<VitalSigns> = {};
  const temperature = matchInRange(text, TEMPERATURE_PATTERNS, 30, 45);
  if (temperature !== null) result.temperature = temperature;
  const heartRate = matchInRange(text, HEART_RATE_PATTERNS, 20, 300);
  if (heartRate !== null) result.heartRate = heartRate;
  const respiratoryRate = matchInRange(text, RESPIRATORY_RATE_PATTERNS, 5, 120);
  if (respiratoryRate !== null) result.respiratoryRate = respiratoryRate;
  const spo2 = matchInRange(text, SPO2_PATTERNS, 30, 100);
  if (spo2 !== null) result.spo2 = spo2;
  return result;
}

function emptyVitals(): VitalSigns {
  return {temperature:null,heartRate:null,respiratoryRate:null,spo2:null};
}

function initialSnapshot(session: Pick<SessionState,'initialVitals'|'vitals'|'caseOptions'>): VitalSigns {
  if(session.initialVitals)return session.initialVitals;
  const intake=session.caseOptions?.intake;
  if(!intake)return session.vitals;
  const snapshot=emptyVitals();
  for(const vital of intake.initialVitals)if(vital.status==='recorded')snapshot[vital.code]=vital.value;
  return snapshot;
}

/** Released intake/history values remain visible as fallbacks; a successful structured exam measurement updates its corresponding card. */
export function resolveDisplayedVitals(
  session: Pick<SessionState, 'events' | 'messages' | 'vitals' | 'initialVitals' | 'caseOptions'>,
): DisplayedVitals {
  const initial=initialSnapshot(session);
  const displayed: DisplayedVitals = {
    temperature: {value:initial.temperature,source:initial.temperature===null?null:'initial'},
    heartRate: {value:initial.heartRate,source:initial.heartRate===null?null:'initial'},
    respiratoryRate: {value:initial.respiratoryRate,source:initial.respiratoryRate===null?null:'initial'},
    spo2: {value:initial.spo2,source:initial.spo2===null?null:'initial'},
  };
  const historyValues: Partial<VitalSigns> = {};
  for (const message of session.messages) {
    if (message.kind !== 'dialogue' || (message.actor !== 'parent' && message.actor !== 'child')) continue;
    Object.assign(historyValues, extractVitalSigns(message.content));
  }
  for (const field of ['temperature','heartRate','respiratoryRate','spo2'] as const) {
    const value = historyValues[field];
    if (displayed[field].value === null && value !== undefined) displayed[field] = { value, source: 'history' };
  }
  for (const event of session.events) {
    if (event.type !== 'EXAM_ACTION' || event.correct !== true) continue;
    for (const measurement of event.measurements ?? []) {
      displayed[measurement.metric] = {
        value:measurement.value,
        source:measurement.origin==='teaching-simulation'?'simulation':'exam',
        measurement,
      };
    }
  }
  return displayed;
}
