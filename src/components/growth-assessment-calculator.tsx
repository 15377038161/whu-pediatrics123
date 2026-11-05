'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Baby, ChevronDown, ListOrdered, Ruler } from 'lucide-react';
import {
  GROWTH_AGE_MONTHS_MAX,
  GROWTH_DISCLAIMER,
  MOTOR_MNEMONIC,
  ageLabel,
  assessGrowth,
  inferAgeFromGrowth,
  type GrowthMetric,
} from '@/domain/growth-assessment';
import styles from './growth-assessment.module.css';

const INFERENCE_OPTIONS = [
  { kind: 'weight', label: '体重', unit: 'kg' },
  { kind: 'height', label: '身高／身长', unit: 'cm' },
  { kind: 'head', label: '头围', unit: 'cm' },
  { kind: 'teeth', label: '乳牙数', unit: '颗' },
] as const;

function parseNumber(value: string): number {
  const trimmed = value.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

/** 指标卡：教材备注收进按钮展开，不在卡片上堆小字。 */
function MetricCard({ item }: { item: GrowthMetric }) {
  const [noteOpen, setNoteOpen] = useState(false);
  return (
    <article className={styles.metric}>
      <div className={styles.metricHead}>
        <span>{item.label}</span>
        <strong>{item.typical}</strong>
      </div>
      {item.formula && <p className={styles.formula}>{item.formula}</p>}
      {item.estimate && (
        <p className={styles.metricEstimate}>公式估算 <code>{item.estimate}</code></p>
      )}
      <ol className={styles.steps}>
        {item.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
      </ol>
      {item.note && (
        <>
          <button
            type="button"
            className={styles.noteToggle}
            aria-expanded={noteOpen}
            onClick={() => setNoteOpen((open) => !open)}
          >
            <ChevronDown aria-hidden="true" className={`${styles.iconInline} ${styles.chevron}`} data-open={noteOpen} />
            {noteOpen ? '收起判读要点' : '判读要点'}
          </button>
          {noteOpen && <p className={styles.note}>{item.note}</p>}
        </>
      )}
    </article>
  );
}

/**
 * 生长发育评估（双向）：计算全部在 src/domain/growth-assessment.ts 内确定性完成，不调用模型。
 * 超出教材公式适用范围与锚点范围的输入原样展示拒绝码与理由，不外推。
 */
export function GrowthAssessmentCalculator() {
  const [mode, setMode] = useState<'assess' | 'infer'>('assess');
  const [years, setYears] = useState('2');
  const [months, setMonths] = useState('0');
  const [kind, setKind] = useState<string>('weight');
  const [value, setValue] = useState('12');

  const ageMonths = useMemo(() => {
    const ageYears = parseNumber(years);
    const ageExtraMonths = parseNumber(months);
    return Number.isFinite(ageYears) && Number.isFinite(ageExtraMonths) ? ageYears * 12 + ageExtraMonths : Number.NaN;
  }, [years, months]);

  const assessment = useMemo(() => assessGrowth({ ageMonths }), [ageMonths]);
  const inference = useMemo(() => inferAgeFromGrowth({ kind, value: parseNumber(value) }), [kind, value]);
  const activeKind = INFERENCE_OPTIONS.find((item) => item.kind === kind) ?? INFERENCE_OPTIONS[0];

  return (
    <div className={styles.wrap}>
      <div className={styles.modes} role="group" aria-label="评估方向">
        <button type="button" data-active={mode === 'assess'} onClick={() => setMode('assess')}>
          按月龄评估发育
        </button>
        <button type="button" data-active={mode === 'infer'} onClick={() => setMode('infer')}>
          按实测值反推月龄
        </button>
      </div>

      {mode === 'assess' ? (
        <>
          <section className={styles.form} aria-label="评估条件">
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>年龄 · 岁</span>
                <input inputMode="numeric" value={years} onChange={(event) => setYears(event.target.value)} placeholder="例如 2" />
              </label>
              <label className={styles.field}>
                <span>年龄 · 再加月数</span>
                <input inputMode="numeric" value={months} onChange={(event) => setMonths(event.target.value)} placeholder="例如 0" />
              </label>
            </div>
            <p className={styles.hint}>运动发育口诀：{MOTOR_MNEMONIC}。适用范围 0–10 岁（0–{GROWTH_AGE_MONTHS_MAX} 个月），超出后按青春期突增另行评估。</p>
          </section>

          {!assessment.ok ? (
            <section className={styles.rejection} role="alert">
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>不给评估 · {assessment.code}</strong>
                <p>{assessment.reason}</p>
              </div>
            </section>
          ) : (
            <section className={styles.result} aria-live="polite">
              <header className={styles.resultHead}>
                <h2><Baby aria-hidden="true" className={styles.iconInline} /> {assessment.ageLabel}（{assessment.ageMonths} 个月）</h2>
                <span>教材典型值按锚点内插，公式估算并列展示，两者不一致时以典型值与标准差曲线判读。</span>
              </header>

              <div className={styles.metricGrid}>
                {assessment.metrics.map((item) => <MetricCard key={item.kind} item={item} />)}
              </div>

              <div className={styles.block}>
                <h3><ListOrdered aria-hidden="true" /> 该月龄前应已达到的发育里程碑</h3>
                {assessment.milestones.length === 0 ? (
                  <p className={styles.note}>月龄不足 2 个月，尚无教材里程碑条目；此期主要看觅食、吸吮等原始反射与体重身长增长。</p>
                ) : (
                  <ul className={styles.milestones}>
                    {assessment.milestones.map((item) => (
                      <li key={item.ageMonths}>
                        <em>{item.ageLabel}</em>
                        <div>
                          <span>运动：{item.motor}</span>
                          <span>语言：{item.language}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className={styles.block}>
                <h3><AlertTriangle aria-hidden="true" /> 使用限制</h3>
                <ul className={styles.warnings}>
                  {assessment.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <section className={styles.form} aria-label="反推条件">
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>实测指标</span>
                <select value={kind} onChange={(event) => setKind(event.target.value)}>
                  {INFERENCE_OPTIONS.map((item) => <option key={item.kind} value={item.kind}>{item.label}（{item.unit}）</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>实测值 · {activeKind.unit}</span>
                <input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="例如 12" />
              </label>
            </div>
            <p className={styles.hint}><Ruler aria-hidden="true" className={styles.iconInline} /> 反推按教材锚点线性内插；实测值落在锚点范围之外时直接拒绝，不外推、不猜月龄。</p>
          </section>

          {!inference.ok ? (
            <section className={styles.rejection} role="alert">
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>不给月龄 · {inference.code}</strong>
                <p>{inference.reason}</p>
              </div>
            </section>
          ) : (
            <section className={styles.result} aria-live="polite">
              <header className={styles.resultHead}>
                <h2>{inference.label} {inference.value} {activeKind.unit} → 约 {ageLabel(inference.estimatedMonths)}</h2>
                <span>区间 {ageLabel(inference.band.min)}–{ageLabel(inference.band.max)}（{inference.band.min}–{inference.band.max} 个月）</span>
              </header>

              <div className={styles.inferResult}>
                <strong>{inference.estimatedMonths} 个月</strong>
                <span>内插估算月龄，仅作教学反推；个体判读须结合体重、身高、头围三项与标准差曲线。</span>
              </div>

              <div className={styles.block}>
                <h3><ListOrdered aria-hidden="true" /> 手算过程</h3>
                {inference.formula && <p className={styles.formula}>{inference.formula}</p>}
                <ol className={styles.steps}>
                  {inference.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
                </ol>
              </div>
            </section>
          )}
        </>
      )}

      <p className={styles.disclaimer}>{GROWTH_DISCLAIMER}</p>
    </div>
  );
}
