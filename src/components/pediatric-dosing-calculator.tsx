'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, FlaskConical, ListOrdered, ShieldAlert } from 'lucide-react';
import {
  DOSING_DISCLAIMER,
  DOSING_DRUGS,
  calculateDose,
  calculateVolumePerDose,
  type DoseInput,
  type VitaminDSeverity,
} from '@/domain/pediatric-dosing';
import styles from './pediatric-dosing.module.css';

function parseNumber(value: string): number {
  const trimmed = value.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

function amount(value: number): string {
  return String(value);
}

/**
 * 用药剂量计算器：全部计算在 src/domain/pediatric-dosing.ts 内确定性完成，不调用模型。
 * 被拒绝的输入原样展示拒绝码与理由，不做静默截断，也不给近似剂量。
 */
export function PediatricDosingCalculator() {
  const [drugId, setDrugId] = useState(DOSING_DRUGS[0].id);
  const [weight, setWeight] = useState('12');
  const [years, setYears] = useState('2');
  const [months, setMonths] = useState('0');
  const [severity, setSeverity] = useState<'prophylaxis' | VitaminDSeverity>('prophylaxis');
  const [premature, setPremature] = useState(false);
  const [hyperbilirubinemia, setHyperbilirubinemia] = useState(false);
  const [concentration, setConcentration] = useState('');

  const drug = DOSING_DRUGS.find((item) => item.id === drugId) ?? DOSING_DRUGS[0];
  const isVitaminD = drug.kind === 'fixed';
  const isCeftriaxone = drug.id === 'ceftriaxone';

  const input: DoseInput = useMemo(() => {
    const ageYears = parseNumber(years);
    const ageExtraMonths = parseNumber(months);
    return {
      drug: drugId,
      weightKg: parseNumber(weight),
      ageMonths: Number.isFinite(ageYears) && Number.isFinite(ageExtraMonths) ? ageYears * 12 + ageExtraMonths : Number.NaN,
      ...(isVitaminD && severity !== 'prophylaxis' ? { severity } : {}),
      ...(isCeftriaxone ? { premature, hyperbilirubinemia } : {}),
    };
  }, [drugId, weight, years, months, isVitaminD, isCeftriaxone, severity, premature, hyperbilirubinemia]);

  const result = useMemo(() => calculateDose(input), [input]);
  const volume = useMemo(() => {
    if (!result.ok || concentration.trim() === '') return null;
    return calculateVolumePerDose({ dose: result.perDose, concentrationPerMl: parseNumber(concentration), unit: result.unit });
  }, [result, concentration]);

  return (
    <div className={styles.wrap}>
      <section className={styles.form} aria-label="计算条件">
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>药品（收录 {DOSING_DRUGS.length} 种）</span>
            <select value={drugId} onChange={(event) => setDrugId(event.target.value)}>
              {DOSING_DRUGS.map((item) => (
                <option key={item.id} value={item.id}>{item.name} · {item.drugClass}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>实测体重（kg）</span>
            <input inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="例如 12" />
          </label>
          <label className={styles.field}>
            <span>年龄 · 岁</span>
            <input inputMode="numeric" value={years} onChange={(event) => setYears(event.target.value)} placeholder="例如 2" />
          </label>
          <label className={styles.field}>
            <span>年龄 · 再加月数</span>
            <input inputMode="numeric" value={months} onChange={(event) => setMonths(event.target.value)} placeholder="例如 0" />
          </label>
        </div>

        {isVitaminD && (
          <fieldset className={styles.options}>
            <legend>用药口径</legend>
            <label>
              <input type="radio" name="vitamin-d-severity" checked={severity === 'prophylaxis'} onChange={() => setSeverity('prophylaxis')} />
              预防量（按年龄分档，日常补充）
            </label>
            <label>
              <input type="radio" name="vitamin-d-severity" checked={severity === 'rickets-treatment'} onChange={() => setSeverity('rickets-treatment')} />
              佝偻病治疗量（2000–4000 IU/日 口服）
            </label>
            <label>
              <input type="radio" name="vitamin-d-severity" checked={severity === 'stoss-therapy'} onChange={() => setSeverity('stoss-therapy')} />
              突击疗法（15万–30万 IU 肌注一次）
            </label>
          </fieldset>
        )}

        {isCeftriaxone && (
          <fieldset className={styles.options}>
            <legend>新生儿禁忌情形（月龄不足 1 个月时生效）</legend>
            <label>
              <input type="checkbox" checked={premature} onChange={(event) => setPremature(event.target.checked)} />
              早产儿
            </label>
            <label>
              <input type="checkbox" checked={hyperbilirubinemia} onChange={(event) => setHyperbilirubinemia(event.target.checked)} />
              高胆红素血症
            </label>
          </fieldset>
        )}

        <p className={styles.drugSummary}>{drug.summary}</p>
      </section>

      {!result.ok ? (
        <section className={styles.rejection} role="alert">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>不给剂量 · {result.code}</strong>
            <p>{result.reason}</p>
          </div>
        </section>
      ) : (
        <section className={styles.result} aria-live="polite">
          <header className={styles.resultHead}>
            <h2>{result.drugName} · {drug.drugClass}</h2>
            <span>{result.route} · {result.intervalLabel}</span>
          </header>

          <div className={styles.doseGrid}>
            <div>
              <span>单次剂量</span>
              <strong>{amount(result.perDose.min)}–{amount(result.perDose.max)} {result.unit}</strong>
              <small>每次给药范围</small>
            </div>
            <div>
              <span>每日总量</span>
              <strong>{amount(result.dailyTotal.min)}–{amount(result.dailyTotal.max)} {result.unit}</strong>
              <small>不得超过上限 {amount(result.dailyTotal.max)} {result.unit}</small>
            </div>
            <div>
              <span>每日次数</span>
              <strong>{result.dosesPerDay.min}–{result.dosesPerDay.max} 次</strong>
              <small>24 小时不超过 {result.maxDosesPerDay} 次</small>
            </div>
          </div>

          <div className={styles.block}>
            <h3><ListOrdered aria-hidden="true" /> 手算过程</h3>
            <ol className={styles.steps}>
              {result.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
            </ol>
            <p className={styles.formula}>{result.formula}</p>
          </div>

          {result.ceilings.length > 0 && (
            <div className={styles.block}>
              <h3><ShieldAlert aria-hidden="true" /> 封顶核对（取最小值生效）</h3>
              <ul className={styles.ceilings}>
                {result.ceilings.map((ceiling) => (
                  <li key={ceiling.kind} data-binding={ceiling.binding}>
                    <span>{ceiling.label}</span>
                    <em>{ceiling.binding ? '生效' : '未生效'}</em>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.block}>
            <h3><FlaskConical aria-hidden="true" /> 换算抽取体积（可选）</h3>
            <label className={styles.field}>
              <span>制剂浓度（{result.unit}/mL）</span>
              <input
                inputMode="decimal"
                value={concentration}
                onChange={(event) => setConcentration(event.target.value)}
                placeholder="按实际制剂规格填写，例如 20"
              />
            </label>
            {volume === null && <p className={styles.volumeHint}>未填写浓度时不换算，也不假设默认规格。</p>}
            {volume && !volume.ok && <p className={styles.volumeReject}>{volume.reason}</p>}
            {volume && volume.ok && (
              <p className={styles.volumeResult}>
                <strong>{amount(volume.volumeMl.min)}–{amount(volume.volumeMl.max)} mL/次</strong>
                <code>{volume.formula}</code>
              </p>
            )}
          </div>

          <div className={styles.block}>
            <h3><AlertTriangle aria-hidden="true" /> 用药警示</h3>
            <ul className={styles.warnings}>
              {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        </section>
      )}

      <p className={styles.disclaimer}>{DOSING_DISCLAIMER}</p>
    </div>
  );
}
