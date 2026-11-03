'use client';

import { useEffect, useState } from 'react';
import { ClipboardPen, ExternalLink } from 'lucide-react';
import { NOTE_TEMPLATE } from '@/domain/medical-note';
import { authedFetch } from '@/lib/authed-api';
import { formatDateTime } from '@/lib/format-date';
import type { NoteView } from '@/lib/note-projection';
import { NoteReviewPanel } from '@/components/note-review-panel';
import styles from './teacher-student-notes.module.css';

/**
 * 批次6·教师学生档案页病历提交区块（只读）：
 * 数据经 /api/teacher/students/[id]/notes（教师鉴权 + RLS 行级把关 +
 * class_period 时间锚点收紧），展示提交版本、病例绑定、AI 意见（辅助反馈）。
 */
export function TeacherStudentNotes({ studentId }: { studentId: string }) {
  const [notes, setNotes] = useState<NoteView[] | null>(null);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authedFetch<NoteView[]>(`/api/teacher/students/${encodeURIComponent(studentId)}/notes`)
      .then((list) => {
        if (!cancelled) setNotes(list);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '病历记录读取失败');
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  return (
    <section className={styles.notesSection} aria-label="病历提交">
      <div className="section-head">
        <h2 className="section-title"><ClipboardPen size={18} /> 病历提交</h2>
        <span className="eyebrow">通用儿科大病历 · 书写评分单独计算，不计入临床总分</span>
      </div>
      {error && <p className={styles.noteEmpty} role="alert">{error}</p>}
      {!error && notes === null && <p className={styles.noteEmpty} role="status">正在读取病历提交…</p>}
      {!error && notes !== null && notes.length === 0 && <p className={styles.noteEmpty}>该学生在你的授权范围内暂无病历提交。</p>}
      {!error && notes !== null && notes.length > 0 && (
        <div className={styles.noteList}>
          {notes.map((note) => {
            const expanded = expandedId === note.id;
            return (
              <article className={styles.noteCard} key={note.id}>
                <div
                  className={styles.noteHead}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : note.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setExpandedId(expanded ? null : note.id);
                  }}
                >
                  <span className={styles.noteRevision}>第 {note.revisionIndex ?? '—'} 版</span>
                  <strong>{formatDateTime(note.submittedAt)}</strong>
                  {note.caseId && <span className={styles.noteCaseId}>病例 {note.caseId}</span>}
                  <span className={styles.noteBadge} data-status={note.aiReviewStatus}>
                    {note.aiReviewStatus === 'ready' ? 'AI 意见已生成' : note.aiReviewStatus === 'failed' ? 'AI 审阅未完成' : '待 AI 审阅'}
                  </span>
                  <a
                    className="text-link"
                    href={`/teacher/sessions/${encodeURIComponent(note.sessionId)}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ExternalLink size={13} style={{ verticalAlign: -3 }} /> 查看训练全过程
                  </a>
                </div>
                {expanded && (
                  <div className={styles.noteBody}>
                    <dl className={styles.noteContent}>
                      {NOTE_TEMPLATE.map((section) => (
                        <div key={section.key}>
                          <dt>{section.label}</dt>
                          <dd data-empty={note.content[section.key]?.trim() ? undefined : ''}>{note.content[section.key]?.trim() || '未书写'}</dd>
                        </div>
                      ))}
                    </dl>
                    {note.aiReviewStatus === 'ready' && note.aiReview && <NoteReviewPanel review={note.aiReview} />}
                    {note.aiReviewStatus === 'failed' && <p className={styles.noteFailed}>该次 AI 审阅未完成（服务异常不影响提交记录，可建议学生重新发起）。</p>}
                    {note.aiReviewStatus === 'pending' && <p className={styles.noteFailed}>学生尚未发起 AI 审阅。</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
