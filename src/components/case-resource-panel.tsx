'use client';

import { FileText, Image as ImageIcon, Play, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { authedFetch, authedFetchRaw } from '@/lib/authed-api';

/**
 * 病例资料面板（媒体 blob 化）：
 * 网关剥离 Cookie 且 <img>/<audio>/<video> 元素无法携带 Authorization 头，
 * 必须经 authedFetchRaw（携带 Bearer token）取回二进制 → objectURL 渲染。
 * 仅分页内可见项触发下载（懒加载等价）；objectURL 由 ref 持有，caseId 变更/卸载时统一 revoke。
 */

type Resource = { path: string; name: string; kind: 'image' | 'audio' | 'video' | 'document'; bytes: number; url?: string };
const PAGE_SIZE = 24;

export function CaseResourcePanel({ caseId, title = '病例资料', initialOpen = false }: { caseId: string; title?: string; initialOpen?: boolean }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [filter, setFilter] = useState<Resource['kind'] | 'all'>('all');
  const [open, setOpen] = useState(initialOpen);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [blobs, setBlobs] = useState<Record<string, string>>({});
  const blobsRef = useRef<Record<string, string>>({});

  // 列表加载：经统一鉴权层
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const data = await authedFetch<Resource[]>(`/api/cases/${encodeURIComponent(caseId)}/resources`);
        if (controller.signal.aborted) return;
        setResources(data);
        setError('');
        setLoading(false);
      } catch (reason: unknown) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '资料暂时无法加载');
        setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [caseId]);

  // blob 生命周期：caseId 变更/卸载时统一释放 objectURL（ref 持有最新映射）
  useEffect(() => {
    return () => {
      Object.values(blobsRef.current).forEach((url) => URL.revokeObjectURL(url));
      blobsRef.current = {};
    };
  }, [caseId]);

  const visible = useMemo(() => filter === 'all' ? resources : resources.filter((item) => item.kind === filter), [filter, resources]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));

  // 当前分页可见项的 blob 预取（打开面板时）：媒体元素无法带 token，必须先取二进制
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    visible
      .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      .filter((item) => !item.url && !blobsRef.current[item.path])
      .forEach((item) => {
        authedFetchRaw(`/api/cases/${encodeURIComponent(caseId)}/resource?path=${encodeURIComponent(item.path)}`)
          .then((resp) => resp.blob())
          .then((blob) => {
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            blobsRef.current[item.path] = url;
            setBlobs((prev) => ({ ...prev, [item.path]: url }));
          })
          .catch(() => {
            // 单项加载失败不阻断面板：该项保持占位
          });
      });
    return () => {
      cancelled = true;
    };
  }, [open, visible, page, caseId]);

  const resourceUrl = (item: Resource) => item.url ?? blobs[item.path] ?? null;
  return <section className="case-resource-panel">
    <button type="button" className="resource-panel-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span><FileText size={16} /> {title} <small>{loading ? '加载中' : `${resources.length} 项`}</small></span><strong>{open ? '收起' : '展开'}</strong></button>
    {open && <div className="resource-panel-body">
      {error ? <p role="alert">{error}</p> : loading ? <p role="status">正在读取病例资料…</p> : resources.length === 0 ? <p>该病种暂无独立资料文件，可先记录问诊和诊疗思路。</p> : <>
        <div className="resource-filter">{[
          ['all', '全部', <FileText key="all" size={13} />], ['document', '正文与报告', <FileText key="doc" size={13} />],
          ['image', '图片', <ImageIcon key="image" size={13} />], ['audio', '音频', <Volume2 key="audio" size={13} />], ['video', '视频', <Play key="video" size={13} />],
        ].map(([kind, label, icon]) => <button key={String(kind)} type="button" data-active={filter === kind} onClick={() => { setFilter(kind as typeof filter); setPage(0); }}>{icon} {label} ({kind === 'all' ? resources.length : resources.filter((item) => item.kind === kind).length})</button>)}</div>
        <div className="resource-grid">{visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item) => {
          const url = resourceUrl(item);
          return <article className="resource-item" key={item.path}>
            {item.kind === 'image' && (url
              ? <a href={url} target="_blank" rel="noreferrer" aria-label={`放大查看 ${item.name}`}><img src={url} alt={item.name} loading="lazy" /></a>
              : <span className="resource-loading" role="status" aria-label="资料加载中">…</span>)}
            {item.kind === 'audio' && (url
              ? <><Volume2 size={20} /><audio controls preload="none" src={url} /></>
              : <span className="resource-loading" role="status" aria-label="资料加载中"><Volume2 size={20} /></span>)}
            {item.kind === 'video' && (url
              ? <><Play size={20} /><video controls playsInline preload="none" src={url} /></>
              : <span className="resource-loading" role="status" aria-label="资料加载中"><Play size={20} /></span>)}
            {item.kind === 'document' && (url
              ? <a href={url} target="_blank" rel="noreferrer"><FileText size={20} /> 打开正文或报告</a>
              : <span className="resource-loading" role="status" aria-label="资料加载中"><FileText size={20} /></span>)}
            <p title={item.path}>{item.name}</p>
          </article>;
        })}</div>
        {visible.length === 0 && <p>本病例未提供此类资料。</p>}
        {pages > 1 && <div className="resource-pagination"><button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page + 1} / {pages} 页 · 共 {visible.length} 项</span><button type="button" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>下一页</button></div>}
      </>}
    </div>}
  </section>;
}
