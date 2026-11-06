'use client';
import { RandomSessionEntry } from '@/components/random-session-entry';

/** 随机接诊（引导训练）沿用原入口语义：排除刚练完的那一例，避免连开同一份病历。 */
export function RandomAdmission({ excludeCaseId, label = '随机接诊新患儿' }: { excludeCaseId?: string; label?: string }) {
  return <RandomSessionEntry mode="guided" excludeCaseId={excludeCaseId} label={label} busyLabel="正在安排接诊…" />;
}
