'use client';

import { useMemo, useState } from 'react';
import { ClipboardList, ListChecks } from 'lucide-react';
import { MedicalBackdrop } from '@/components/medical-backdrop';
import {
  HISTORY_DISCLAIMER,
  HISTORY_SECTIONS,
  gradeStructuredHistory,
  isHistoryAnswerEmpty,
  type HistoryAnswerInput,
  type HistoryGrade,
} from '@/domain/structured-history';
import styles from './history-taking.module.css';

export default function HistoryTakingPage() {
  const [answers, setAnswers] = useState<HistoryAnswerInput>({});
  const [grade, setGrade] = useState<HistoryGrade | null>(null);

  const filledCount = useMemo(() => HISTORY_SECTIONS.filter((section) => (answers[section.id] ?? '').trim()).length, [answers]);

  function submit() {
    if (isHistoryAnswerEmpty(answers)) return;
    setGrade(gradeStructuredHistory(answers));
  }

  return (
    <MedicalBackdrop>
      <p className="eyebrow">执业医师实践技能第一站 · 病史采集（结构化书面练习）</p>
      <h1 className="page-title"><ClipboardList size={22} aria-hidden="true" /> 病史采集提纲</h1>
      <p className="page-lead">
        按分区写出你要向家长询问的内容，提交后按问诊要点给分并列出漏问项。
        这是书面提纲训练，与训练工作台里的 SP 角色扮演问诊不同：那里是多轮对话，这里考的是你有没有问全。
      </p>

      <div className={styles.progressRow}>
        <span>已填写 {filledCount} / {HISTORY_SECTIONS.length} 个分区</span>
        <span className={styles.disclaimer}>{HISTORY_DISCLAIMER}</span>
      </div>

      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {HISTORY_SECTIONS.map((section) => (
          <section className={styles.sectionCard} key={section.id} aria-labelledby={`${section.id}-label`}>
            <div className={styles.sectionHead}>
              <h2 id={`${section.id}-label`}>{section.label}</h2>
              <span>{section.points.filter((point) => point.required).length} 项必问</span>
            </div>
            <ul className={styles.hintList}>
              {section.points.map((point) => (
                <li key={point.key} data-required={point.required}>
                  <strong>{point.label}{point.required ? '' : '（可选）'}</strong>
                  <span>{point.hint}</span>
                </li>
              ))}
            </ul>
            <label className={styles.answerField}>
              <span className="sr-only">{section.label}填写内容</span>
              <textarea
                rows={3}
                value={answers[section.id] ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setAnswers((prev) => ({ ...prev, [section.id]: value }));
                  if (grade) setGrade(null);
                }}
                placeholder="写出你会问的问题或家长的回答要点…"
              />
            </label>
          </section>
        ))}

        <div className={styles.actions}>
          <button className="btn btn-primary" type="submit" disabled={isHistoryAnswerEmpty(answers)}>
            <ListChecks size={16} /> 提交提纲并看漏问项
          </button>
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => { setAnswers({}); setGrade(null); }}
          >
            清空重填
          </button>
        </div>
      </form>

      {grade && (
        <section className={styles.resultCard} aria-live="polite">
          <h2>本次得分：{grade.totalScore} / {grade.maxScore}（{grade.percent}%）</h2>
          <div className={styles.scoreGrid}>
            {grade.sections.map((section) => (
              <div key={section.id} className={styles.scoreItem}>
                <strong>{section.label}</strong>
                <span>{section.score} / {section.maxScore}</span>
                {section.hits.length > 0 && <p className={styles.hitLine}>已覆盖：{section.hits.join('、')}</p>}
                {section.misses.length > 0 && <p className={styles.missLine}>未覆盖：{section.misses.join('、')}</p>}
              </div>
            ))}
          </div>
          {grade.missingPoints.length > 0 && (
            <div className={styles.missingCard}>
              <h3>需要补问的内容</h3>
              <ul>{grade.missingPoints.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {grade.missingPoints.length === 0 && <p className={styles.fullMark}>要点已全部覆盖。注意：本页只判「问全没问全」，不判断问诊语气与家长沟通效果。</p>}
        </section>
      )}
    </MedicalBackdrop>
  );
}