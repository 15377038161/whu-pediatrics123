'use client';

import { Bot } from 'lucide-react';
import type { NoteReviewResult } from '@/domain/medical-note';
import { sectionCompleteness } from '@/domain/medical-note';
import styles from './note-writing.module.css';

/**
 * 批次6·AI 审阅意见面板（学生书写页与教师档案页共享）：
 * 结构化意见 = 总评 + 逐段完整性 + 问题条目（引用原文/证据）+ 值得肯定。
 * 意见为独立辅助反馈，不冒充医学审核、不给分、不改历史成绩。
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

export function NoteReviewPanel({ review }: { review: NoteReviewResult }) {
  return (
    <div className={styles.noteReviewPanel}>
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
