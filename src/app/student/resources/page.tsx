'use client';

/**
 * 学生学习资源中心（D10 / 方案第 13.1）：
 * - 列表：教学视频/图文资料分类、关键词搜索、断点续播标记与最近学习排序；
 * - 详情：视频播放器（续播到上次位置，进度每 10 秒/暂停/结束幂等上报）；图文资料经短期链接打开查看；
 * - 可见性由服务端 RPC 强制（教师发布 + 班级范围），下架资源自然从列表消失，历史进度保留（进度不当掌握程度）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock, FileText, Film, RefreshCw, Sparkles } from 'lucide-react';
import { authedFetch } from '@/lib/authed-api';
import type { LearningResourceDetail, LearningResourceKind, LearningResourceSummary } from '@/lib/learning-resource';
import styles from './resources.module.css';

interface PlaybackInfo {
  kind: LearningResourceKind;
  title: string;
  fileName: string | null;
  url: string;
  expiresAt: string;
}

type KindFilter = 'all' | LearningResourceKind;
type SortMode = 'default' | 'recent';

const KIND_LABEL: Record<LearningResourceKind, string> = { video: '教学视频', document: '图文资料' };

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN');
}

function ResourceListWithSelection({ onSelect }: { onSelect: (id: string) => void }) {
  const [resources, setResources] = useState<LearningResourceSummary[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('default');

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const data = await authedFetch<{ resources: LearningResourceSummary[] }>('/api/resources');
      setResources(data.resources ?? []);
      setPhase('ready');
    } catch (e) {
      setErrorMessage((e as Error).message || '资源列表加载失败，请稍后重试。');
      setPhase('error');
    }
  }, []);

  // 初始列表加载：setState 均在异步 fetch 返回后执行（.then 回调，不违反 set-state-in-effect）
  useEffect(() => {
    let active = true;
    authedFetch<{ resources: LearningResourceSummary[] }>('/api/resources')
      .then((data) => {
        if (!active) return;
        setResources(data.resources ?? []);
        setPhase('ready');
      })
      .catch((e) => {
        if (!active) return;
        setErrorMessage((e as Error).message || '资源列表加载失败，请稍后重试。');
        setPhase('error');
      });
    return () => { active = false; };
  }, []);

  const filtered = resources
    .filter((item) => (kindFilter === 'all' ? true : item.kind === kindFilter))
    .filter((item) => {
      const q = keyword.trim().toLowerCase();
      if (!q) return true;
      return item.title.toLowerCase().includes(q) || item.topic.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sortMode === 'recent') {
        const ta = a.progressUpdatedAt ? Date.parse(a.progressUpdatedAt) : 0;
        const tb = b.progressUpdatedAt ? Date.parse(b.progressUpdatedAt) : 0;
        if (ta !== tb) return tb - ta;
      }
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  if (phase === 'loading') return <div className="empty-state"><p>正在加载…</p></div>;
  if (phase === 'error') {
    return <div className="empty-state"><p>{errorMessage}</p><button className="btn btn-primary" type="button" onClick={() => void load()}>重试</button></div>;
  }

  return (
    <div className={styles.resourcesLayout}>
      <div className={styles.toolbarRow}>
        <div className="quiz-toolbar" role="tablist" aria-label="资源分类">
          {([['all', '全部'], ['video', '教学视频'], ['document', '图文资料']] as Array<[KindFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`btn ${kindFilter === value ? 'btn-secondary' : 'btn-quiet'}`}
              role="tab"
              aria-selected={kindFilter === value}
              onClick={() => setKindFilter(value)}
            >
              {value === 'video' ? <Film size={14} /> : value === 'document' ? <FileText size={14} /> : <Sparkles size={14} />} {label}
            </button>
          ))}
        </div>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="搜索标题 / 主题 / 简介"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          aria-label="搜索资源"
        />
        <button
          type="button"
          className={`btn ${sortMode === 'recent' ? 'btn-secondary' : 'btn-quiet'}`}
          onClick={() => setSortMode((mode) => (mode === 'recent' ? 'default' : 'recent'))}
          aria-pressed={sortMode === 'recent'}
        >
          <Clock size={14} /> {sortMode === 'recent' ? '最近学习' : '默认排序'}
        </button>
        <button className="btn btn-quiet" type="button" onClick={() => void load()} aria-label="刷新列表"><RefreshCw size={14} /></button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>{resources.length === 0 ? '老师还没有发布学习资源；已发布的资源会出现在这里。' : '没有符合筛选条件的资源。'}</p>
        </div>
      ) : (
        <div className={styles.resourceGrid}>
          {filtered.map((item) => (
            <button key={item.resourceId} type="button" className={styles.resourceCard} onClick={() => onSelect(item.resourceId)}>
              <div className={styles.cardHead}>
                <span className={styles.kindBadge} data-kind={item.kind}>
                  {item.kind === 'video' ? <Film size={12} /> : <FileText size={12} />} {KIND_LABEL[item.kind]}
                </span>
                {item.durationSeconds ? <span>{formatDuration(item.durationSeconds)}</span> : null}
              </div>
              <h3 className={styles.cardTitle}>{item.title}</h3>
              {item.topic ? <p className={styles.cardTopic}>{item.topic}</p> : null}
              {item.description ? <p className={styles.cardDesc}>{item.description}</p> : null}
              <div className={styles.cardMeta}>
                {item.positionSeconds !== null && item.positionSeconds > 0 ? (
                  <span className={styles.progressChip}>续播 {formatDuration(item.positionSeconds)}</span>
                ) : null}
                <span>更新于 {formatDateTime(item.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ResourceDetail({ resourceId, onBack }: { resourceId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<LearningResourceDetail | null>(null);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await authedFetch<LearningResourceDetail>(`/api/resources/${resourceId}`);
        const link = await authedFetch<PlaybackInfo>(`/api/resources/${resourceId}/playback`);
        if (cancelled) return;
        setDetail(data);
        setPlayback(link);
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        setErrorMessage((e as Error).message || '资源加载失败，请稍后重试。');
        setPhase('error');
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [resourceId]);

  const saveProgress = useCallback(async (positionSeconds: number) => {
    if (positionSeconds <= 0) return;
    try {
      await authedFetch(`/api/resources/${resourceId}/progress`, {
        method: 'POST',
        body: JSON.stringify({ positionSeconds: Math.floor(positionSeconds) }),
      });
      lastSavedRef.current = Math.floor(positionSeconds);
    } catch {
      // 进度保存失败不打断播放：下次播放从上次成功保存的位置续播
    }
  }, [resourceId]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || !detail?.positionSeconds) return;
    if (detail.positionSeconds > 0 && detail.positionSeconds < video.duration - 5) {
      video.currentTime = detail.positionSeconds;
    }
  }, [detail]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused) return;
    if (Math.floor(video.currentTime) - lastSavedRef.current >= 10) {
      void saveProgress(video.currentTime);
    }
  }, [saveProgress]);

  if (phase === 'loading') return <div className="empty-state"><p>正在加载…</p></div>;
  if (phase === 'error') {
    return (
      <div className={styles.detailPanel}>
        <div className={styles.backRow}>
          <button className="btn btn-quiet" type="button" onClick={onBack}><ArrowLeft size={14} /> 返回列表</button>
        </div>
        <div className="empty-state"><p>{errorMessage}</p></div>
      </div>
    );
  }
  if (!detail || !playback) return null;

  return (
    <div className={styles.detailPanel}>
      <div className={styles.backRow}>
        <button className="btn btn-quiet" type="button" onClick={onBack}><ArrowLeft size={14} /> 返回列表</button>
      </div>

      <div className={styles.detailHead}>
        <span className={styles.kindBadge} data-kind={detail.kind}>
          {detail.kind === 'video' ? <Film size={12} /> : <FileText size={12} />} {KIND_LABEL[detail.kind]}
        </span>
        <h2>{detail.title}</h2>
        <div className={styles.detailMeta}>
          {detail.topic ? <span>{detail.topic}</span> : null}
          {detail.durationSeconds ? <span>时长 {formatDuration(detail.durationSeconds)}</span> : null}
          {detail.source ? <span>来源：{detail.source}</span> : null}
          <span>更新于 {formatDateTime(detail.updatedAt)}</span>
        </div>
      </div>

      {detail.description ? <p className="page-lead">{detail.description}</p> : null}

      {detail.kind === 'video' ? (
        <>
          {detail.positionSeconds !== null && detail.positionSeconds > 0 ? (
            <p className={styles.resumeNote}>已为你定位到上次观看位置（{formatDuration(detail.positionSeconds)}），可拖动调整。</p>
          ) : null}
          <div className={styles.videoWrap}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              src={playback.url}
              controls
              preload="metadata"
              playsInline
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onPause={() => { if (videoRef.current) void saveProgress(videoRef.current.currentTime); }}
              onEnded={() => { if (videoRef.current) void saveProgress(videoRef.current.currentTime); }}
            />
          </div>
          <p className={styles.playbackHint}>播放链接带有效期，失效后重新进入详情可自动续取；观看进度仅用于断点续播。</p>
        </>
      ) : (
        <>
          <a className="btn btn-primary" href={playback.url} target="_blank" rel="noopener noreferrer">
            <FileText size={14} /> 打开资料查看
          </a>
          <p className={styles.playbackHint}>图文资料在新窗口查看；链接带有效期，失效后重新进入详情可自动续取。</p>
        </>
      )}
    </div>
  );
}

export default function StudentResourcesPage() {
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <>
      <p className="eyebrow">学习资源</p>
      <h1 className="page-title">学习资源中心</h1>
      <p className="page-lead">
        老师发布的教学视频与图文资料：按分类浏览，视频支持断点续播；观看进度仅用于记住位置，不作为掌握程度评价。
      </p>
      {detailId ? (
        <ResourceDetail resourceId={detailId} onBack={() => setDetailId(null)} />
      ) : (
        <ResourceListWithSelection onSelect={setDetailId} />
      )}
    </>
  );
}
