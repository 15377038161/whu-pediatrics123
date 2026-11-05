import { HeartPulse, Shirt, Syringe } from 'lucide-react';
import { MedicalBackdrop } from '@/components/medical-backdrop';
import styles from './procedures.module.css';
import {
  PROCEDURES,
  PROCEDURE_GROUP_LABELS,
  proceduresByGroup,
  type ClinicalProcedure,
  type ProcedureGroup,
} from '@/domain/clinical-procedures';

export const metadata = { title: '技能操作要点 · 珞珈儿科智训' };

const GROUPS: { group: ProcedureGroup; icon: typeof Shirt; note: string }[] = [
  { group: 'aseptic', icon: Shirt, note: '无菌准备是穿刺与手术的准入动作，考核重点在污染判定而不只是步骤顺序。' },
  { group: 'puncture', icon: Syringe, note: '四大穿刺按「适应证 → 禁忌症 → 穿刺点 → 操作 → 并发症 → 儿科差异」的顺序掌握，禁忌症未排除不得进针。' },
  { group: 'resuscitation', icon: HeartPulse, note: '婴儿心肺复苏按 AHA 2020 儿科口径：剂量全部按体重计算，与「用药剂量计算」页结果一致。' },
];

function ProcedureCard({ procedure }: { procedure: ClinicalProcedure }) {
  return (
    <article className={styles.card} id={procedure.slug}>
      <div className={styles.cardHead}>
        <h3>{procedure.title}</h3>
        <p>{procedure.summary}</p>
      </div>

      <dl className={styles.params}>
        {procedure.parameters.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>

      {procedure.indications.length > 0 && (
        <details className={styles.block} open>
          <summary>适应证（{procedure.indications.length} 条）</summary>
          <ul className={styles.list}>
            {procedure.indications.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </details>
      )}

      {procedure.contraindications.length > 0 && (
        <details className={styles.block} open>
          <summary>禁忌症（{procedure.contraindications.length} 条）</summary>
          <ul className={`${styles.list} ${styles.danger}`}>
            {procedure.contraindications.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </details>
      )}

      <details className={styles.block} open>
        <summary>操作步骤（{procedure.steps.length} 步）</summary>
        <ol className={styles.steps}>
          {procedure.steps.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
      </details>

      {procedure.preparation.length > 0 && (
        <details className={styles.block}>
          <summary>术前准备与用物（{procedure.preparation.length} 项）</summary>
          <ul className={styles.list}>
            {procedure.preparation.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </details>
      )}

      <details className={styles.block}>
        <summary>并发症与风险（{procedure.complications.length} 项）</summary>
        <ul className={`${styles.list} ${styles.danger}`}>
          {procedure.complications.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </details>

      <details className={styles.block}>
        <summary>儿科要点（{procedure.pediatricNotes.length} 条）</summary>
        <ul className={styles.list}>
          {procedure.pediatricNotes.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </details>

      <details className={styles.block}>
        <summary>正文出处</summary>
        <ul className={styles.sources}>
          {procedure.sources.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </details>
    </article>
  );
}

/**
 * 执业医师实践技能第二站的技能操作正文：全部来自 src/domain/clinical-procedures.ts 的教材与指南口径，
 * 不经模型生成；未收录的操作不在此页出现，也不编造正文。
 */
export default function ProceduresPage() {
  return (
    <MedicalBackdrop>
      <p className="eyebrow">执业医师实践技能 · 第二站：体格检查与基本操作</p>
      <h1 className="page-title">技能操作要点</h1>
      <p className="page-lead">无菌准备、四大穿刺与婴儿心肺复苏的操作正文：每项都给出适应证、禁忌症、穿刺点或关键数值、分步操作、并发症与儿科差异，并标注教材与指南出处。</p>

      <nav className={styles.jump} aria-label="技能操作目录">
        {PROCEDURES.map((procedure) => (
          <a key={procedure.slug} href={`#${procedure.slug}`}>{procedure.title}</a>
        ))}
      </nav>

      {GROUPS.map(({ group, icon: Icon, note }) => (
        <section className={styles.group} key={group} aria-label={PROCEDURE_GROUP_LABELS[group]}>
          <h2 className={styles.groupTitle}><Icon size={18} aria-hidden="true" /> {PROCEDURE_GROUP_LABELS[group]}</h2>
          <p className={styles.groupNote}>{note}</p>
          {proceduresByGroup(group).map((procedure) => <ProcedureCard key={procedure.slug} procedure={procedure} />)}
        </section>
      ))}

      <p className={styles.notice}>
        本页为教学正文，不能替代带教医师的现场指导与个体化适应证评估。一切按体重计算的药物剂量，执行前须双人核对，并使用「用药剂量计算」工具复核；禁忌症未排除时不得进针。
      </p>
    </MedicalBackdrop>
  );
}
