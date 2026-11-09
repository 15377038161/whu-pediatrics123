'use client';

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, CheckCircle2, ClipboardPen, Loader2, RefreshCw, Save, Send } from 'lucide-react';
import { NOTE_TEMPLATE, sectionCompleteness, type NoteContent, type NoteSectionKey } from '@/domain/medical-note';
import { NoteReviewPanel } from '@/components/note-review-panel';
import { VoiceHoldButton } from '@/components/voice-hold-button';
import { appendVoiceTranscript } from '@/domain/voice-draft';
import { authedFetch, authedFetchRaw, AuthedApiError } from '@/lib/authed-api';
import type { Ref } from 'react';
import type { SessionState } from '@/domain/agent';
import { formatDateTime, formatTime } from '@/lib/format-date';
import type { NoteView } from '@/lib/note-projection';
import styles from './note-writing.module.css';
import {noteFromReleasedRecords,fillEmptyNoteSections} from '@/domain/note-record-import';

/**
 * 批次6·病历书写（学生本人，通用儿科大病历结构）：
 * - 表单 10 段落（模板驱动），必填段完整性提示；
 * - 草稿防抖自动保存（每学生×会话一份）；提交服务端归一 + clientEventId 幂等；
 * - 提交后在报告已生成时自动发起 AI 评分与审阅（SSE 流式过程 + 服务端落库后刷新展示）；
 *   评分只评价病历文本，独立于临床评分、班级积分与选关；服务异常 failed 不影响提交与教师查看。
 */

const EMPTY_CONTENT = Object.fromEntries(NOTE_TEMPLATE.map((section) => [section.key, ''])) as unknown as NoteContent;

const COMPLETENESS_LABEL: Record<ReturnType<typeof sectionCompleteness>, string> = {
  written: '已书写',
  partial: '片段',
  missing: '必填未写',
  not_applicable: '选填未写',
};

export interface NoteWritingHandle { flush: () => Promise<void> }

export function NoteWriting({ sessionId, embedded=false, context, onComplete, ref }: {sessionId:string; embedded?:boolean; context?:SessionState; onComplete?:()=>void | Promise<void>; ref?:Ref<NoteWritingHandle>}) {
  const [activeSection,setActiveSection]=useState<NoteSectionKey|'submit'|'history'>(NOTE_TEMPLATE[0].key);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<NoteContent>(EMPTY_CONTENT);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [submissions, setSubmissions] = useState<NoteView[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [importNotice,setImportNotice]=useState('');
  const [submitError, setSubmitError] = useState('');
  const [confirmMissing, setConfirmMissing] = useState(false);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewStreamText, setReviewStreamText] = useState('');
  const [reviewError, setReviewError] = useState('');
  const clientEventIdRef = useRef<string | null>(null);
  const submitInFlightRef = useRef(false);
  const submittedContentRef = useRef<NoteContent | null>(null);
  const draftLoadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef=useRef<NoteContent>(EMPTY_CONTENT);
  const savedContentRef=useRef(JSON.stringify(EMPTY_CONTENT));
  const saveChainRef=useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    authedFetch<{ draft: { content: NoteContent } | null; submissions: NoteView[] }>(`/api/notes?sessionId=${encodeURIComponent(sessionId)}`)
      .then((data) => {
        if (cancelled) return;
        const content=data.draft?.content ?? EMPTY_CONTENT;
        setDraft(content); latestDraftRef.current=content; savedContentRef.current=JSON.stringify(content);
        draftLoadedRef.current = true;
        setSubmissions(data.submissions);
        const latest = [...data.submissions].sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt))[0];
        submittedContentRef.current = latest ? Object.fromEntries(NOTE_TEMPLATE.map(section=>[section.key,latest.content[section.key]??''])) as NoteContent : null;
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

  // Serialize writes so an older autosave cannot overwrite a newer draft.
  const flush=useCallback(async()=>{
    if(saveTimerRef.current)clearTimeout(saveTimerRef.current);
    if(!draftLoadedRef.current) return;
    const content=latestDraftRef.current;
    const snapshot=JSON.stringify(content);
    const save=async()=>{
      if(snapshot===savedContentRef.current)return;
      setSaveState('saving');
      try {
        await authedFetch('/api/notes/draft',{method:'PUT',body:JSON.stringify({sessionId,content})});
        savedContentRef.current=snapshot;setSavedAt(new Date());
        if(JSON.stringify(latestDraftRef.current)===snapshot)setSaveState('saved');
      }catch(error){setSaveState('failed');throw error;}
    };
    const queued=saveChainRef.current.catch(()=>undefined).then(save);
    saveChainRef.current=queued;
    await queued;
  },[sessionId]);
  useImperativeHandle(ref,()=>({flush}),[flush]);
  useEffect(()=>()=>{if(saveTimerRef.current)clearTimeout(saveTimerRef.current);void flush().catch(()=>undefined);},[flush]);

  useEffect(()=>{
    if(!draftLoadedRef.current||JSON.stringify(draft)===savedContentRef.current)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);return ()=>window.removeEventListener('beforeunload',warn);
  },[draft,saveState]);

  const missingRequired = useMemo(
    () => NOTE_TEMPLATE.filter((section) => section.required && sectionCompleteness(draft[section.key], true) === 'missing').map((section) => section.label),
    [draft],
  );

  function updateSection(key: NoteSectionKey, value: string) {
    const next={...latestDraftRef.current,[key]:value};
    latestDraftRef.current=next;setDraft(next);setSaveState('idle');
    if(saveTimerRef.current)clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(()=>{void flush().catch(()=>undefined);},800);
    setConfirmMissing(false);clientEventIdRef.current=null;
  }

  async function handleSubmit(generateReport = false) {
    if (submitInFlightRef.current) return;
    const content = { ...latestDraftRef.current };
    const alreadySubmitted = submittedContentRef.current !== null && NOTE_TEMPLATE.every(section=>submittedContentRef.current![section.key]===content[section.key]);
    if (!alreadySubmitted && missingRequired.length > 0 && !confirmMissing) {
      setConfirmMissing(true);
      return;
    }
    submitInFlightRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    if (!clientEventIdRef.current) clientEventIdRef.current = crypto.randomUUID();
    const clientEventId = clientEventIdRef.current;
    try {
      await flush();
      if (!alreadySubmitted) {
        const saved = await authedFetch<NoteView>('/api/notes', { method: 'POST', body: JSON.stringify({ sessionId, content, clientEventId }) });
        submittedContentRef.current = content;
        setSubmissions(previous=>[saved,...previous.filter(note=>note.id!==saved.id)]);
        setExpandedNoteId(saved.id);
        // 报告尚未生成时 AI 无可核对证据；报告生成后再发起审阅。
        if (!context || context.reportId) void handleReview(saved.id);
      }
      setConfirmMissing(false);
      setActiveSection(embedded&&onComplete?'submit':'history');
      if (generateReport) await onComplete?.();
    } catch (reason: unknown) {
      setSubmitError(reason instanceof Error ? reason.message : '提交失败，请重试。');
    } finally {
      submitInFlightRef.current = false;
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
        setReviewError(finalStatus === 'failed' ? (finalMessage ?? '评分与审阅未完成，不影响病历提交与教师查看。') : '审阅响应意外中断，请重试。');
        await refreshSubmissions().catch(() => undefined);
      }
    } catch (reason: unknown) {
      if (!(reason instanceof AuthedApiError)) {
        setReviewError(reason instanceof Error ? reason.message : '评分与审阅暂时不可用，不影响病历提交与教师查看。');
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

  const active=NOTE_TEMPLATE.find(section=>section.key===activeSection);
  const completed=NOTE_TEMPLATE.filter(section=>draft[section.key].trim()).length;
  const activeIndex=active?NOTE_TEMPLATE.indexOf(active):NOTE_TEMPLATE.length;
  const saveLabel=saveState==='saving'?'正在保存…':saveState==='saved'?`已保存${savedAt?' '+formatTime(savedAt):''}`:saveState==='failed'?'保存失败，请重试':'更改后自动保存到账号';
  return (
    <div className={styles.noteShell} data-embedded={embedded}>
      {!embedded&&<Link className="text-link" href={`/student/training?session=${sessionId}`} onClick={event=>{event.preventDefault();void flush().then(()=>window.location.assign(`/student/training?session=${sessionId}`)).catch(()=>undefined);}}><ArrowLeft size={14}/> 返回本次接诊</Link>}
      <header className={styles.noteIntro}><div><p className="eyebrow"><ClipboardPen size={14}/> 病历书写</p><h1>整理这一次接诊</h1><p>用自己的话组织已获得的信息，保留时间、依据和未知项。评分只评价病历文本，不计入临床总分、积分或选关。</p></div><span className={styles.noteSaveState} data-state={saveState} role="status">{saveLabel}</span></header>
      {context&&<div className={styles.recordImport}><button type="button" className="btn btn-secondary" disabled={submitting} onClick={()=>{const next=fillEmptyNoteSections(latestDraftRef.current,noteFromReleasedRecords(context));const keys=(Object.keys(next) as NoteSectionKey[]).filter(key=>next[key]!==latestDraftRef.current[key]);for(const key of keys)updateSection(key,next[key]);setImportNotice(keys.length?`已导入 ${keys.length} 个空白段落，请整理并核实。`:'没有可导入的空白段落：已有内容会保留，未获得的信息不会补写。');}}>从共享记录导入空白段落</button><span>支持复制粘贴；仅填入本轮已获得的问诊、查体和检查，不覆盖已写内容，请整理后提交。</span>{importNotice&&<p role="status">{importNotice}</p>}</div>}<div className={styles.progressRow}><span>已写 {completed} / {NOTE_TEMPLATE.length} 个段落</span><progress max={NOTE_TEMPLATE.length} value={completed} aria-label="病历书写进度"/></div>
      <div className={styles.writingGrid}>
        <nav className={styles.sectionNav} aria-label="病历段落目录"><p>书写目录</p>{NOTE_TEMPLATE.map((section,index)=><button type="button" key={section.key} aria-current={activeSection===section.key?'step':undefined} onClick={()=>setActiveSection(section.key)}><span>{String(index+1).padStart(2,'0')}</span><strong>{section.label}</strong>{draft[section.key].trim()&&<CheckCircle2 size={14} aria-label="已有内容"/>}</button>)}<button type="button" aria-current={activeSection==='submit'?'step':undefined} onClick={()=>setActiveSection('submit')}>整合与提交 <Send size={14}/></button><button type="button" aria-current={activeSection==='history'?'step':undefined} onClick={()=>setActiveSection('history')}>提交记录 · {submissions.length}</button></nav>
        <section className={styles.editorPanel} aria-label="病历编辑区">
          {active?<><div className={styles.editorHeading}><p>段落 {String(activeIndex+1).padStart(2,'0')} / {NOTE_TEMPLATE.length}</p><h2>{active.label}</h2></div><div className={styles.questionCard}><strong>围绕这些问题组织记录</strong><p>{active.hint}</p><small>只写本次接诊已核实的内容；没有资料时明确写未知、未询问或未完成。</small></div><textarea className={styles.sectionEditor} aria-label={active.label} value={draft[active.key]} onChange={event=>updateSection(active.key,event.target.value)} placeholder={`用自己的话书写${active.label}，保留信息来源与时间点…`}/><div className={styles.sectionVoice}><span>语音结果追加到当前段落，确认或编辑后再提交。</span><VoiceHoldButton key={active.key} sessionId={sessionId} disabled={submitting} onResult={result=>updateSection(active.key,appendVoiceTranscript(latestDraftRef.current[active.key],result.text))}/></div><div className={styles.editorMeta}><span>{COMPLETENESS_LABEL[sectionCompleteness(draft[active.key],active.required)]}</span><span>{draft[active.key].length} 字</span></div><footer className={styles.editorFooter}><button className="btn btn-secondary" disabled={activeIndex===0} onClick={()=>setActiveSection(NOTE_TEMPLATE[activeIndex-1].key)}>上一段落</button><button className="btn btn-primary" onClick={()=>setActiveSection(NOTE_TEMPLATE[activeIndex+1]?.key??'submit')}>{activeIndex===NOTE_TEMPLATE.length-1?'整合与提交':'下一段落'} <ArrowLeft size={14} style={{transform:'rotate(180deg)'}}/></button></footer></>:activeSection==='submit'?<div className={styles.reviewContent}><h2>整合与提交</h2><p>完整性提示帮助检查记录；提交后按固定五维评分。</p>{NOTE_TEMPLATE.map(section=><article key={section.key}><h3>{section.label}<button type="button" className="text-link" onClick={()=>setActiveSection(section.key)}>返回修改</button></h3><p className="preserve-lines">{draft[section.key]||'尚未书写'}</p></article>)}<div className={styles.noteActions}><button type="button" className="btn btn-secondary" onClick={()=>void flush().catch(()=>undefined)} disabled={saveState==='saving'}><Save size={14}/> 保存草稿</button><button type="button" className="btn btn-primary" onClick={()=>void handleSubmit(Boolean(embedded&&onComplete))} disabled={submitting||!completed}>{submitting?'提交中…':confirmMissing?`仍有 ${missingRequired.length} 个必填段未写，仍要提交`:embedded&&onComplete?'提交病历并生成报告':'提交病历'}</button>{confirmMissing&&<p className={styles.noteMissingWarn}>未书写：{missingRequired.join('、')}。确认后仍可提交，教师会看到原文。</p>}{submitError&&<p role="alert" className={styles.noteError}>{submitError}</p>}{submissions.length>0&&<p role="status">已有 {submissions.length} 次提交，原文已保留。</p>}</div></div>:<div className={styles.reviewContent}>
      <div className="section-head" style={{ marginTop: 30 }}>
        <h2 className="section-title">提交记录</h2>
        <span className="eyebrow">{submissions.length === 0 ? '提交后在此查看评分与意见' : `共 ${submissions.length} 次提交`}</span>
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
                    {note.aiReviewStatus === 'ready' ? '评分与意见已生成' : note.aiReviewStatus === 'failed' ? '评分未完成' : '待评分'}
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
                    {note.aiReviewStatus === 'failed' && <p className={styles.noteMissingWarn}>上次评分与审阅未完成（不影响提交与教师查看），可重新发起。</p>}
                    {reviewing && (
                      <div className={styles.noteReviewStream} role="status">
                        <span className={styles.noteReviewStreamStatus}><Loader2 size={13} className="spin" /> AI 正在评分与审阅，完成后自动展示…</span>
                        {reviewStreamText && <p className={styles.noteReviewStreamText} aria-label="AI 评分与审阅生成过程">{reviewStreamText}</p>}
                      </div>
                    )}
                    {reviewError && <p className={styles.noteError} role="alert">{reviewError}</p>}
                    <div className={styles.noteReviewActions}>
                      <button type="button" className="btn btn-secondary" disabled={reviewingId !== null} onClick={() => void handleReview(note.id)}>
                        <Bot size={14} /> {reviewing ? '评分中…' : note.aiReviewStatus === 'ready' ? '重新评分' : '生成评分与意见'}
                      </button>
                      {note.aiReviewStatus === 'failed' && (
                        <span className={styles.noteSaveState}><RefreshCw size={12} /> 评分失败不影响提交记录</span>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
</div>}
        </section>
        <aside className={styles.thinkingPanel}><h2><Bot size={17}/> 思考提示</h2><p>{active?'检查表达、时间和信息来源。提示不提供标准病历答案。':'核对已填写段落后提交，提交记录会保留各次版本。'}</p><details open><summary>信息与依据</summary><p>{active?.hint??'查看是否把实际采集的信息与个人推断区分开。'}</p></details><details><summary>时间与未知项</summary><p>区分院外与入院后的资料。未知、不适用、未检查与结果未回报分别记录，不填默认正常值。</p></details><details><summary>提交前核对</summary><p>保留自己的临床思路；评分只评价病历文本，医学判断由教师复核。</p></details>{context&&<div><h3>本轮记录</h3><p>已采集 {context.askedIntents.length} 类病史 · 已申请 {context.orderedTests.length} 项检查</p><p>需要核对时，可回到接诊工作台查阅自己已获得的证据。</p></div>}<button type="button" className="text-link" disabled={saveState==='saving'} onClick={()=>void flush().catch(()=>undefined)}>手动保存草稿</button></aside>
      </div>
    </div>
  );
}
