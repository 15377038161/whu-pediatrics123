import type { SessionState, VitalSigns } from '@/domain/agent';
import { getCaseRecordEntries } from '@/domain/case-record';

/**
 * 生命体征的确定性提取与展示合并。
 *
 * 来源只有三种，全部是会话里已经真实出现过的文字：
 * - initial：接诊时病例记录/初筛已有的值；
 * - exam：本轮查体成功释放的结果（体温计、血氧仪等）；
 * - history：本轮问诊中家长/患儿明确说出的数值（如「最高烧到39度」）。
 *
 * 只做数字提取，不做推断、不补正常值；提取不到就保持 null，界面显示未记录。
 * 问诊值只填空缺，不覆盖接诊记录或本轮实测；本轮实测覆盖接诊记录（同一时点的最新测量）。
 */

export type VitalSource = 'initial' | 'exam' | 'history';
export type VitalField = keyof VitalSigns;
export interface DisplayedVital { value: number | null; source: VitalSource | null }
export type DisplayedVitals = Record<VitalField, DisplayedVital>;

export const VITAL_SOURCE_LABELS: Record<VitalSource, string> = {
  initial: '接诊记录',
  exam: '本轮查体',
  history: '病史提供',
};

const FIELDS: readonly VitalField[] = ['temperature', 'heartRate', 'respiratoryRate', 'spo2'];

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
  /(?:S\s*p\s*O\s*[₂2]?|血氧(?:饱和度)?)\s*(?:读数\s*)?[:：]?\s*(?:为|是)?\s*(\d{2,3})\s*%?/i,
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

/** 从一段病例文字中提取生命体征；没有明确数值时返回空对象，不猜测。 */
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

function initialDisplay(value: number | null): DisplayedVital {
  return value === null ? { value: null, source: null } : { value, source: 'initial' };
}

/** 把会话中已释放的查体结果与问诊回答合并到生命体征展示。 */
export function resolveDisplayedVitals(session: Pick<SessionState, 'events' | 'messages' | 'vitals'>): DisplayedVitals {
  const displayed: DisplayedVitals = {
    temperature: initialDisplay(session.vitals.temperature),
    heartRate: initialDisplay(session.vitals.heartRate),
    respiratoryRate: initialDisplay(session.vitals.respiratoryRate),
    spo2: initialDisplay(session.vitals.spo2),
  };
  // 本轮实测优先：同一字段按事件顺序取最后一次成功查体。
  for (const event of session.events) {
    if (event.type !== 'EXAM_ACTION' || event.correct !== true) continue;
    const measured = extractVitalSigns(event.summary);
    for (const field of FIELDS) {
      const value = measured[field];
      if (value !== undefined) displayed[field] = { value, source: 'exam' };
    }
  }
  // 问诊值只补空缺，不覆盖接诊记录或本轮实测。
  for (const entry of getCaseRecordEntries(session)) {
    if (entry.category !== 'history') continue;
    for (const answer of entry.answers) {
      const reported = extractVitalSigns(answer.content);
      for (const field of FIELDS) {
        const value = reported[field];
        if (value !== undefined && displayed[field].value === null) displayed[field] = { value, source: 'history' };
      }
    }
  }
  return displayed;
}