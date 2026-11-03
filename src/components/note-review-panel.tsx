'use client';

import { Bot } from 'lucide-react';
import type { NoteReviewResult, NoteWritingScore } from '@/domain/medical-note';
import { NOTE_WRITING_SCORE_ITEMS, noteWritingScoreTotal, sectionCompleteness } from '@/domain/medical-note';
import styles from './note-writing.module.css';

/**
 * 批次6·AI 审阅意见面板（学生书写页与教师档案页共享）：
 * 结构化意见 = 病历书写评分 + 总评 + 逐段完整性 + 问题条目 + 值得肯定。
 * 评分只评价病历文本，独立于临床评分、班级积分与选关；医学结论由教师复核。
 */

const COMPLETENESS_LABEL: Record<ReturnType<typeof sectionCompleteness>, string> = {
  written: '已书写',
  partial: '片段',
  missing: '必填未写',
  not_applicable: '选填未写',
};

const ISSUE_KIND_LABEL: Record<string, string> = {
  inconsistency: '事实不一致',
  omission_unwritten: '获得未写',
  omission_uncollected: '未采集',
  timeline: '时间线',
  expression: '表达',
};

function WritingScoreCard({ score }: { score: NoteWritingScore }) {
  const total = noteWritingScoreTotal(score);
  return (
    <section className={styles.noteWritingScore} aria-label="病历书写评分">
      <header>
        <div><span>病历书写评分</span><small>只评本次病历文本</small></div>
        <strong>{total}<small> / 100</small></strong>
      </header>
      <div className={styles.noteWritingScoreGrid}>
        {NOTE_WRITING_SCORE_ITEMS.map((item) => (
          <div key={item.key}>
            <span>{item.label}</span>
            <strong>{Math.max(0, Math.min(item.max, Math.round(score[item.key])))}<small> / {item.max}</small></strong>
          </div>
        ))}
      </div>
      <p>不计入临床评分、班级积分或选关结果。</p>
    </section>
  );
}

export function NoteReviewPanel({ review }: { review: NoteReviewResult }) {
  return (
    <div className={styles.noteReviewPanel}>
      {review.writingScore
        ? <WritingScoreCard score={review.writingScore} />
        : <p className={styles.noteWritingScoreLegacy}>本次审阅未包含评分；可重新审阅生成五维评分。</p>}
      <p className={styles.noteReviewSummary}><Bot size={14} style={{ verticalAlign: -2, marginRight: 6, color: '#1f6f54' }} />{review.summary}</p>
      {review.sections.map((section) => (
        <div className={styles.noteReviewSection} key={section.sectionKey}>
          <h5>
            {section.sectionKey}
            <span className={styles.noteCompletenessTag} data-level={section.completeness}>{COMPLETENESS_LABEL[section.completeness]}</span>
          </h5>
          {section.issues.map((issue, index) => (
            <p className={styles.noteIssue} key={`${section.sectionKey}-${index}`}>
              <span className={styles.noteIssueKind}>{ISSUE_KIND_LABEL[issue.kind] ?? issue.kind}</span>
              {issue.suggestion}
              {issue.quote && <span className={styles.noteIssueQuote}>原文：{issue.quote}</span>}
              {issue.evidence && <span className={styles.noteIssueQuote}>证据：{issue.evidence}</span>}
            </p>
          ))}
          {section.issues.length === 0 && <p className={styles.noteIssue} style={{ borderLeftColor: '#bfe3cd' }}>该段落没有发现需要修改的问题。</p>}
        </div>
      ))}
      {review.notableStrengths.length > 0 && (
        <div className={styles.noteReviewSection}>
          <h5>值得肯定</h5>
          <ul className={styles.noteStrengths}>{review.notableStrengths.map((strength, index) => <li key={index}>{strength}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
