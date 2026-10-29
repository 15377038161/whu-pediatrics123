'use client';

import { useEffect, useState } from 'react';
import { NoteWriting } from '@/components/note-writing';

/**
 * 批次6·病历书写页（学生本人）：按训练会话定位，
 * 数据经 authedFetch，未登录直接 401 回登录页。
 */
export default function NoteWritingPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    params.then(({ sessionId: id }) => {
      if (!cancelled) setSessionId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  if (!sessionId) {
    return <div className="empty-state" role="status"><p>正在打开病历…</p></div>;
  }
  return <NoteWriting sessionId={sessionId} />;
}
