'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardPen, Search, Volume2, X } from 'lucide-react';
import type { SessionState } from '@/domain/agent';
import { getCaseRecordEntries, searchCaseRecordEntries, type CaseRecordCategory } from '@/domain/case-record';
import { resolveDisplayedVitals, VITAL_SOURCE_LABELS } from '@/domain/vital-signs';
import {LabReportView} from '@/components/lab-report-view';
import { CaseMediaGallery } from '@/components/case-media-gallery';

const categoryLabels: Record<CaseRecordCategory, string> = {
  history: '问诊',
  exam: '查体',
  test: '辅助检查',
};

export interface SharedCaseRecordProps {
  session: SessionState;
  onOpenNote: () => void;
  drawer?: boolean;
  onClose?: () => void;
  audioObservation?: { title: string; sound: 'fine-crackles' | 'wheeze' } | null;
  onReplayAudio?: () => void;
}

/** 唯一病例结果呈现面：只读服务端已释放的会话事件与对应回答，不读取病例答案或审计字段。 */
export function SharedCaseRecord({
  session,
  onOpenNote,
  drawer = false,
  onClose,
  audioObservation,
  onReplayAudio,
}: SharedCaseRecordProps) {
  const [category, setCategory] = useState<CaseRecordCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const timelineRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => getCaseRecordEntries(session), [session]);
  const records = useMemo(() => searchCaseRecordEntries(entries, category, query), [entries, category, query]);
  const vitals = useMemo(() => resolveDisplayedVitals(session), [session]);
  const latestRecordId = entries.at(-1)?.event.id ?? '';

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const timeline = timelineRef.current;
      if (timeline) timeline.scrollTop = timeline.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestRecordId]);

  return <>
    <div className="panel-head">
      <h2>共享病例记录</h2>
      <span className="record-head-actions">
        <span>{entries.length} 项记录</span>
        {drawer && <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭病例记录抽屉"><X size={17} /></button>}
      </span>
    </div>
    <div className="panel-body shared-case-record-body">
      <section className="record-vitals" aria-labelledby="record-vitals-title">
        <div className="record-section-head"><h3 id="record-vitals-title">生命体征</h3><span>接诊记录与本轮问诊/查体已获得；未获得的项目如实显示未记录</span></div>
        <div className="vitals">
          <div className="vital"><strong>{vitals.temperature.value ?? '未记录'}</strong><span>体温 ℃</span>{vitals.temperature.source && <em>{VITAL_SOURCE_LABELS[vitals.temperature.source]}</em>}</div>
          <div className="vital"><strong>{vitals.heartRate.value ?? '未记录'}</strong><span>心率 /min</span>{vitals.heartRate.source && <em>{VITAL_SOURCE_LABELS[vitals.heartRate.source]}</em>}</div>
          <div className="vital"><strong>{vitals.respiratoryRate.value ?? '未记录'}</strong><span>呼吸 /min</span>{vitals.respiratoryRate.source && <em>{VITAL_SOURCE_LABELS[vitals.respiratoryRate.source]}</em>}</div>
          <div className="vital"><strong>{vitals.spo2.value === null ? '未记录' : `${vitals.spo2.value}%`}</strong><span>SpO₂</span>{vitals.spo2.source && <em>{VITAL_SOURCE_LABELS[vitals.spo2.source]}</em>}</div>
        </div>
      </section>
      <section className="record-timeline-section" aria-labelledby="record-timeline-title">
        <div className="record-section-head">
          <h3 id="record-timeline-title">本轮时间线</h3>
          {audioObservation && onReplayAudio ? <button className="btn btn-quiet btn-small" type="button" onClick={onReplayAudio}><Volume2 size={14} /> 重播{audioObservation.title}听诊音</button> : <span>仅显示本会话已释放信息</span>}
        </div>
        <div className="case-record-tools">
          <div className="case-record-filters" aria-label="病例记录分类">
            {(['all', 'history', 'exam', 'test'] as const).map((item) => <button
              type="button"
              key={item}
              className={category === item ? 'active' : ''}
              aria-pressed={category === item}
              onClick={() => setCategory(item)}
            >{item === 'all' ? '全部' : categoryLabels[item]}</button>)}
          </div>
          <label className="case-record-search"><Search size={14} /><span className="sr-only">搜索病例记录</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索问题、回答或结果" /></label>
        </div>
        {entries.length === 0 ? <div className="empty-note">尚未获得新的病例记录。有效问诊、查体和检查结果会统一归档在这里。</div> : records.length === 0 ? <div className="empty-note">当前分类或搜索条件下没有记录。</div> :
          <div className="evidence-log shared-record-timeline" aria-label="完整共享病例记录" tabIndex={0} aria-live="polite" ref={timelineRef}>
            <ol>{records.map((entry) => <li className="evidence-item shared-record-item" key={entry.event.id} data-category={entry.category} data-event-type={entry.event.type}>
              <details open={entry.event.id === latestRecordId}>
                <summary>
                  <span className="record-category">{categoryLabels[entry.category]}</span>
                  <strong>{entry.question ?? entry.event.summary.split(/[：:]/u)[0]}</strong>
                  <span className="record-evidence-count">{entry.event.evidenceCodes.length > 0 ? `${entry.event.evidenceCodes.length} 项证据` : '待出结果'}</span>
                </summary>
                <div className="shared-record-detail">
                  {entry.event.testReport&&<LabReportView report={entry.event.testReport}/>}
                  {entry.category !== 'history' && (entry.event.testReport?<details><summary>核对原始文字与申请目的</summary><p className="record-result-text">{entry.event.summary}</p></details>:<p className="record-result-text">{entry.event.summary}</p>)}
                  {entry.answers.length > 0 ? <div className="record-answer-list">{entry.answers.map((answer, index) => <p key={`${entry.event.id}-${index}`}><span>{answer.actor === 'parent' ? '家长回答' : '患儿回答'}</span>{answer.content}</p>)}</div> : null}
                  {entry.category === 'history' && entry.answers.length === 0 ? <p className="record-detail-muted">未关联到可展示的家长或患儿回答。</p> : null}
                  {entry.event.media && entry.event.media.length > 0
                    ? <CaseMediaGallery sessionId={session.id} media={entry.event.media} />
                    // 查体无实拍图时如实说明，避免留白被误读为图片加载失败（病例素材库只有辅助检查类图像，无体征照片）
                    : entry.category === 'exam' ? <p className="record-detail-muted">本例未提供实拍图。</p> : null}
                </div>
              </details>
            </li>)}</ol>
          </div>}
      </section>
      <footer className="shared-record-note-entry">
        <div><strong>病历书写</strong><span>草稿自动保存，提交版本保留</span></div>
        <button className="btn btn-secondary" type="button" onClick={onOpenNote}><ClipboardPen size={15} /> 打开病历</button>
      </footer>
    </div>
  </>;
}
