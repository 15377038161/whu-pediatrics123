'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, CheckCircle2, ClipboardPen, Loader2, RefreshCw, Save, Send, TriangleAlert } from 'lucide-react';
import { NOTE_TEMPLATE, sectionCompleteness, type NoteContent, type NoteSectionKey } from '@/domain/medical-note';
import { NoteReviewPanel } from '@/components/note-review-panel';
import { authedFetch, authedFetchRaw, AuthedApiError } from '@/lib/authed-api';
import { formatDateTime } from '@/lib/format-date';
import type { NoteView } from '@/lib/note-projection';
import styles from './note-writing.module.css';

/**
 * 批次6·病历书写（学生本人，通用儿科大病历结构）：
 * - 表单 10 段落（模板驱动），必填段完整性提示（不评分、不扣分）；
 * - 草稿防抖自动保存（每学生×会话一份）；提交服务端归一 + clientEventId 幂等；
 * - AI 辅助审阅（SSE 流式过程 + 服务端落库后刷新展示）：独立辅助反馈，
 *   不冒充医学审核、不改历史成绩；服务异常 failed 不影响提交与教师查看。
 */

const EMPTY_CONTENT = Object.fromEntries(NOTE_TEMPLATE.map((section) => [section.key, ''])) as unknown as NoteContent;

const COMPLETENESS_LABEL: Record<ReturnType<typeof sectionCompleteness>, string> = {
  written: '已书写',
  partial: '片段',
  missing: '必填未写',
  not_applicable: '选填未写',
};

export function NoteWriting({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<NoteContent>(EMPTY_CONTENT);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [submissions, setSubmissions] = useState<NoteView[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmMissing, setConfirmMissing] = useState(false);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewStreamText, setReviewStreamText] = useState('');
  const [reviewError, setReviewError] = useState('');
  const clientEventIdRef = useRef<string | null>(null);
  const draftLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    authedFetch<{ draft: { content: NoteContent } | null; submissions: NoteView[] }>(`/api/notes?sessionId=${encodeURIComponent(sessionId)}`)
      .then((data) => {
        if (cancelled) return;
        if (data.draft) setDraft(data.draft.content);
        draftLoadedRef.current = true;
        setSubmissions(data.submissions);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoadError(reason instanceof Error ? reason.message : '病历记录读取失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const refreshSubmissions = useCallback(async () => {
    const data = await authedFetch<{ submissions: NoteView[] }>(`/api/notes?sessionId=${encodeURIComponent(sessionId)}`);
    setSubmissions(data.submissions);
  }, [sessionId]);

  // 草稿防抖自动保存（首次加载不触发）
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState('idle');
    saveTimerRef.current = setTimeout(() => {
      setSaveState('saving');
      authedFetch('/api/notes/draft', { method: 'PUT', body: JSON.stringify({ sessionId, content: draft }) })
        .then(() => {
          setSaveState('saved');
          setSavedAt(new Date());
        })
        .catch(() => setSaveState('failed'));
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draft, sessionId]);

  const missingRequired = useMemo(
    () => NOTE_TEMPLATE.filter((section) => section.required && sectionCompleteness(draft[section.key], true) === 'missing').map((section) => section.label),
    [draft],
  );

  function updateSection(key: NoteSectionKey, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setConfirmMissing(false);
  }

  async function handleSubmit() {
    if (submitting) return;
    if (missingRequired.length > 0 && !confirmMissing) {
      setConfirmMissing(true);
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    if (!clientEventIdRef.current) clientEventIdRef.current = crypto.randomUUID();
    const clientEventId = clientEventIdRef.current;
    try {
      await authedFetch<NoteView>('/api/notes', { method: 'POST', body: JSON.stringify({ sessionId, content: draft, clientEventId }) });
      clientEventIdRef.current = null;
      setConfirmMissing(false);
      await refreshSubmissions();
    } catch (reason: unknown) {
      setSubmitError(reason instanceof Error ? reason.message : '提交失败，请重试。');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReview(noteId: string) {
    if (reviewingId) return;
    setReviewingId(noteId);
    setReviewStreamText('');
    setReviewError('');
    try {
      const response = await authedFetchRaw(`/api/notes/${encodeURIComponent(noteId)}/review`, { method: 'POST' });
      if (!response.body) throw new Error('浏览器不支持流式响应');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalStatus: 'ready' | 'failed' | null = null;
      let finalMessage: string | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep >= 0) {
          const rawLine = buffer.slice(0, sep).trim();
          buffer = buffer.slice(sep + 2);
          if (rawLine.startsWith('data: ')) {
            const payload = JSON.parse(rawLine.slice('data: '.length)) as { delta?: string; done?: boolean; status?: 'ready' | 'failed'; message?: string };
            if (payload.delta) setReviewStreamText((previous) => (previous + payload.delta).slice(-800));
            if (payload.done) {
              finalStatus = payload.status ?? 'failed';
              finalMessage = payload.message;
            }
          }
          sep = buffer.indexOf('\n\n');
        }
      }
      if (finalStatus === 'ready') {
        await refreshSubmissions();
      } else {
        setReviewError(finalStatus === 'failed' ? (finalMessage ?? 'AI 审阅未完成，不影响病历提交与教师查看。') : '审阅响应意外中断，请重试。');
        await refreshSubmissions().catch(() => undefined);
      }
    } catch (reason: unknown) {
      if (!(reason instanceof AuthedApiError)) {
        setReviewError(reason instanceof Error ? reason.message : 'AI 审阅暂时不可用，不影响病历提交与教师查看。');
      }
      await refreshSubmissions().catch(() => undefined);
    } finally {
      setReviewingId(null);
      setReviewStreamText('');
    }
  }

  if (loading) {
    return <div className="empty-state" role="status"><p>正在读取病历…</p></div>;
  }
  if (loadError) {
    return <div className="empty-state" role="alert"><p>{loadError}</p><Link className="btn btn-primary" href="/student/reports">返回报告列表</Link></div>;
  }

  return (
    <div className={styles.noteShell}>
      <Link className="text-link" href="/student/reports"><ArrowLeft size={14} /> 返回学情档案</Link>
      <div className="section-head">
        <div>
          <p className="eyebrow"><ClipboardPen size={13} /> 病历书写</p>
          <h1 className="page-title">小儿接诊病历</h1>
          <p className="page-lead">按通用儿科大病历结构书写本次接诊；书写质量由 AI 辅助审阅与教师查看反馈，不自动评分。</p>
        </div>
      </div>
      <p className={styles.noteBoundary}>
        <TriangleAlert size={13} style={{ color: '#9a6b00' }} />
        必填段完整性仅作提示，不会据此扣分；AI 意见为独立辅助反馈，医学结论由教师复核作出。
      </p>

      <div className={styles.noteCompleteness} aria-label="段落完成度">
        {NOTE_TEMPLATE.filter((section) => section.required).map((section) => {
          const level = sectionCompleteness(draft[section.key], true);
          return <span key={section.key} data-level={level}>{section.label} · {COMPLETENESS_LABEL[level]}</span>;
        })}
      </div>

      <form
        className={styles.noteForm}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        {NOTE_TEMPLATE.map((section) => {
          const level = sectionCompleteness(draft[section.key], section.required);
          return (
            <div className={styles.noteField} data-completeness={level} key={section.key}>
              <div className={styles.noteFieldHead}>
                <strong>{section.label}</strong>
                {section.required && <em>必填</em>}
              </div>
              <p className={styles.noteHint}>{section.hint}</p>
              <textarea
                value={draft[section.key]}
                onChange={(event) => updateSection(section.key, event.target.value)}
                placeholder={`书写${section.label}…`}
                aria-label={section.label}
              />
            </div>
          );
        })}

        <div className={styles.noteActions}>
          <span className={styles.noteSaveState} data-state={saveState}>
            {saveState === 'saving' ? <><Loader2 size={13} className="spin" /> 保存草稿中…</> : saveState === 'saved' ? <><CheckCircle2 size={13} /> 草稿已保存{savedAt ? ` ${savedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</> : saveState === 'failed' ? <><Save size={13} /> 草稿保存失败，稍后自动重试</> : <><Save size={13} /> 草稿自动保存</>}
          </span>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? <><Loader2 size={15} className="spin" /> 提交中…</> : <><Send size={15} /> {confirmMissing ? `仍有 ${missingRequired.length} 个必填段未写，仍要提交` : '提交病历'}</>}
          </button>
          {confirmMissing && missingRequired.length > 0 && <p className={styles.noteMissingWarn}>未书写：{missingRequired.join('、')}。提交后仍可在下一次书写中补全，AI 审阅会指出缺失段落。</p>}
          {submitError && <p className={styles.noteError} role="alert">{submitError}</p>}
        </div>
      </form>

      <div className="section-head" style={{ marginTop: 30 }}>
        <h2 className="section-title">提交记录</h2>
        <span className="eyebrow">{submissions.length === 0 ? '提交后在此查看与发起 AI 审阅' : `共 ${submissions.length} 次提交`}</span>
      </div>
      {submissions.length === 0 ? (
        <div className="empty-state"><p>还没有提交过病历。完成接诊后书写并提交，教师可在学生档案中查看。</p></div>
      ) : (
        <div className={styles.noteHistory}>
          {submissions.map((note) => {
            const expanded = expandedNoteId === note.id;
            const reviewing = reviewingId === note.id;
            return (
              <article className={styles.noteSubmitCard} key={note.id}>
                <div
                  className={styles.noteSubmitHead}
                  onClick={() => setExpandedNoteId(expanded ? null : note.id)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setExpandedNoteId(expanded ? null : note.id);
                  }}
                >
                  <span className={styles.noteRevision}>第 {note.revisionIndex ?? '—'} 版</span>
                  <strong>{formatDateTime(note.submittedAt)}</strong>
                  <span className={styles.noteReviewBadge} data-status={note.aiReviewStatus}>
                    {note.aiReviewStatus === 'ready' ? 'AI 意见已生成' : note.aiReviewStatus === 'failed' ? 'AI 审阅未完成' : '待 AI 审阅'}
                  </span>
                </div>
                {expanded && (
                  <div className={styles.noteSubmitBody}>
                    <dl className={styles.noteContentRead}>
                      {NOTE_TEMPLATE.map((section) => (
                        <div key={section.key}>
                          <dt>{section.label}</dt>
                          <dd data-empty={note.content[section.key]?.trim() ? undefined : ''}>{note.content[section.key]?.trim() || '未书写'}</dd>
                        </div>
                      ))}
                    </dl>
                    {note.aiReviewStatus === 'ready' && note.aiReview && <NoteReviewPanel review={note.aiReview} />}
                    {note.aiReviewStatus === 'failed' && <p className={styles.noteMissingWarn}>上次 AI 审阅未完成（不影响提交与教师查看），可重新发起。</p>}
                    {reviewing && (
                      <div className={styles.noteReviewStream} role="status">
                        <span className={styles.noteReviewStreamStatus}><Loader2 size={13} className="spin" /> AI 正在审阅，完成后意见自动展示…</span>
                        {reviewStreamText && <p className={styles.noteReviewStreamText} aria-label="AI 审阅生成过程">{reviewStreamText}</p>}
                      </div>
                    )}
                    {reviewError && <p className={styles.noteError} role="alert">{reviewError}</p>}
                    <div className={styles.noteReviewActions}>
                      <button type="button" className="btn btn-secondary" disabled={reviewingId !== null} onClick={() => void handleReview(note.id)}>
                        <Bot size={14} /> {reviewing ? '审阅中…' : note.aiReviewStatus === 'ready' ? '重新审阅' : 'AI 辅助审阅'}
                      </button>
                      {note.aiReviewStatus === 'failed' && (
                        <span className={styles.noteSaveState}><RefreshCw size={12} /> 审阅失败不影响提交记录</span>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
