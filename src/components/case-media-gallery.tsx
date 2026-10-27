'use client';

/**
 * 病例媒体展示（补充单：媒体按检查/操作触发绑定）：
 * - 媒体随检查/查体结果释放时挂载在事件上，此处按 fileId 经服务端换签名链接后渲染；
 * - 链接带期限（1 小时），请求或图片加载失败后可显式重新取签名链接，不重跑临床操作。
 */

import { useEffect, useState } from 'react';
import type { CaseMedia } from '@/domain/agent';
import { authedFetch } from '@/lib/authed-api';

interface CaseMediaLink {
  url: string;
  caption: string;
  fileName: string | null;
}

function CaseMediaImage({ sessionId, item }: { sessionId: string; item: CaseMedia }) {
  const [link, setLink] = useState<CaseMediaLink | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // 父组件以 sessionId + fileId 为 key，换会话不能保留上一会话的签名链接或失败状态。
  useEffect(() => {
    let cancelled = false;
    authedFetch<CaseMediaLink>(`/api/sessions/${sessionId}/media?fileId=${encodeURIComponent(item.fileId)}`)
      .then((result) => { if (!cancelled) setLink(result); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [sessionId, item.fileId, attempt]);
  if (failed) return <div className="case-media-state"><p role="note">「{item.caption}」图片暂时无法加载。</p><button type="button" onClick={() => {
    setFailed(false); setLink(null); setAttempt(value => value + 1);
  }}>重新加载图片</button></div>;
  if (!link) return <p className="case-media-state" aria-live="polite">正在加载图片：{item.caption}…</p>;
  return (
    <figure className="case-media-item">
      {/* 签名链接为跨域带期限 URL，直接渲染即可，不附带任何凭据 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={link.url} alt={item.caption} loading="lazy" onError={() => setFailed(true)} />
      <figcaption>{item.caption}</figcaption>
    </figure>
  );
}

export function CaseMediaGallery({ sessionId, media }: { sessionId: string; media: CaseMedia[] }) {
  if (media.length === 0) return null;
  return (
    <div className="case-media-gallery">
      {media.map((item) => <CaseMediaImage key={`${sessionId}:${item.fileId}`} sessionId={sessionId} item={item} />)}
    </div>
  );
}
