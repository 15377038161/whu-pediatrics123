'use client';


/**
 * 批次8·学生现场考核成绩区块（嵌入技能学习页）。
 *
 * 展示本人已发布考核成绩与逐项明细（/api/skill-assessments，受控 RPC 仅返回本人已发布）。
 * 边界：现场考核成绩独立于训练报告与 OSCE 模拟参考评分，仅教学记录展示，不做换算。
 * 加载失败静默隐藏本区块，不阻塞技能目录。
 */


import { useEffect, useState } from 'react';
import { authedFetch } from '@/lib/authed-api';
import { ASSESSMENT_SCORE_LEVELS, formatAssessmentTotal } from '@/domain/skill-assessment';
import type { StudentSkillAssessmentItem } from '@/lib/skill-assessment';
import styles from './student-skill-scores.module.css';


function formatDateTime(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


export function StudentSkillScores() {
  const [items, setItems] = useState<StudentSkillAssessmentItem[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    authedFetch<{ assessments: StudentSkillAssessmentItem[] }>('/api/skill-assessments')
      .then((res) => {
        if (!active) return;
        setItems(res.assessments ?? []);
        setPhase('ready');
      })
      .catch(() => {
        if (!active) return;
        setPhase('error');
      });
    return () => { active = false; };
  }, []);

  if (phase === 'error') return null;

  return (
    <section className={styles.section} aria-label="现场考核成绩">
      <h2 className={styles.title}>现场考核成绩</h2>
      <p className={styles.hint}>老师现场考核并发布后可见；与训练报告、模拟参考评分相互独立，仅作教学记录展示。</p>

      {phase === 'loading' ? <p className={styles.empty}>正在读取…</p> : null}

      {phase === 'ready' && items.length === 0 ? (
        <p className={styles.empty}>暂无已发布的现场考核成绩。</p>
      ) : null}

      {phase === 'ready' && items.length > 0 ? (
        <div className={styles.list}>
          {items.map((item) => {
            const open = openId === item.assessmentId;
            return (
              <article key={item.assessmentId} className={styles.card}>
                <button
                  type="button"
                  className={styles.cardHead}
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : item.assessmentId)}
                >
                  <div>
                    <h3 className={styles.cardTitle}>{item.skillTitle}</h3>
                    <p className={styles.cardMeta}>{formatDateTime(item.publishedAt)}</p>
                  </div>
                  <strong className={styles.totalScore} data-empty={item.totalScore === null}>
                    {formatAssessmentTotal(item.totalScore)}
                  </strong>
                </button>
                {open ? (
                  <div className={styles.cardBody}>
                    {item.note ? <p className={styles.note}>教师备注：{item.note}</p> : null}
                    <ul className={styles.scoreList}>
                      {item.items.map((s) => (
                        <li key={s.itemKey}>
                          <span className={styles.scoreLabel}>{s.itemLabel}</span>
                          <span className={styles.scoreText} data-score={s.score === null ? 'na' : String(s.score)}>
                            {s.score === null ? '未观察' : ASSESSMENT_SCORE_LEVELS[s.score as 0 | 1 | 2]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
