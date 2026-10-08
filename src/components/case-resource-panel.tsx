'use client';

import { FileText, Image as ImageIcon, Play, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type Resource = { path: string; name: string; kind: 'image' | 'audio' | 'video' | 'document'; bytes: number };
const PAGE_SIZE = 24;

export function CaseResourcePanel({ caseId, title = '病例资料', initialOpen = false }: { caseId: string; title?: string; initialOpen?: boolean }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [filter, setFilter] = useState<Resource['kind'] | 'all'>('all');
  const [open, setOpen] = useState(initialOpen);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/cases/${encodeURIComponent(caseId)}/resources`, { signal: controller.signal })
      .then(async (response) => { const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? '资料暂时无法加载'); return payload.data as Resource[]; })
      .then((data) => { setResources(data); setLoading(false); })
      .catch((reason) => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : '资料暂时无法加载'); setLoading(false); } });
    return () => controller.abort();
  }, [caseId]);
  const visible = useMemo(() => filter === 'all' ? resources : resources.filter((item) => item.kind === filter), [filter, resources]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const resourceUrl = (item: Resource) => `/api/cases/${encodeURIComponent(caseId)}/resource?path=${encodeURIComponent(item.path)}`;
  return <section className="case-resource-panel">
    <button type="button" className="resource-panel-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span><FileText size={16} /> {title} <small>{loading ? '加载中' : `${resources.length} 项`}</small></span><strong>{open ? '收起' : '展开'}</strong></button>
    {open && <div className="resource-panel-body">
      {error ? <p role="alert">{error}</p> : loading ? <p role="status">正在读取病例资料…</p> : resources.length === 0 ? <p>该病种暂无独立资料文件，可先记录问诊和诊疗思路。</p> : <>
        <div className="resource-filter">{[
          ['all', '全部', <FileText key="all" size={13} />], ['document', '正文与报告', <FileText key="doc" size={13} />],
          ['image', '图片', <ImageIcon key="image" size={13} />], ['audio', '音频', <Volume2 key="audio" size={13} />], ['video', '视频', <Play key="video" size={13} />],
        ].map(([kind, label, icon]) => <button key={String(kind)} type="button" data-active={filter === kind} onClick={() => { setFilter(kind as typeof filter); setPage(0); }}>{icon} {label} ({kind === 'all' ? resources.length : resources.filter((item) => item.kind === kind).length})</button>)}</div>
        <div className="resource-grid">{visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item) => <article className="resource-item" key={item.path}>
          {item.kind === 'image' && <a href={resourceUrl(item)} target="_blank" rel="noreferrer" aria-label={`放大查看 ${item.name}`}><img src={resourceUrl(item)} alt={item.name} loading="lazy" /></a>}
          {item.kind === 'audio' && <><Volume2 size={20} /><audio controls preload="none" src={resourceUrl(item)} /></>}
          {item.kind === 'video' && <><Play size={20} /><video controls playsInline preload="none" src={resourceUrl(item)} /></>}
          {item.kind === 'document' && <a href={resourceUrl(item)} target="_blank" rel="noreferrer"><FileText size={20} /> 打开正文或报告</a>}
          <p title={item.path}>{item.name}</p>
        </article>)}</div>
        {visible.length === 0 && <p>本病例未提供此类资料。</p>}
        {pages > 1 && <div className="resource-pagination"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {pages} 页 · 共 {visible.length} 项</span><button type="button" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>下一页</button></div>}
      </>}
    </div>}
  </section>;
}
