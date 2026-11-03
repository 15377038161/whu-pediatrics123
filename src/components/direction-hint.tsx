'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Lightbulb, LoaderCircle, X } from 'lucide-react';
import type { SessionMode, Stage } from '@/domain/agent';
import { AuthedApiError, authedFetch } from '@/lib/authed-api';

interface DirectionHintResult {
  hint: string;
  used: number;
  remaining: number;
}

interface DirectionHintQuota {
  used: number;
  remaining: number;
}

export function DirectionHint({ sessionId, stage, mode }: { sessionId: string; stage: Stage; mode: SessionMode }) {
  const [quota, setQuota] = useState<DirectionHintQuota | null>(null);
  const [result, setResult] = useState<DirectionHintResult | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientEventIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const endpoint = `/api/sessions/${sessionId}/direction-hint`;

  useEffect(() => {
    if (mode === 'osce') return;
    let cancelled = false;
    void authedFetch<DirectionHintQuota>(endpoint).then((value) => {
      if (!cancelled) setQuota(value);
    }).catch(() => {
      if (!cancelled) setQuota(null);
    });
    return () => { cancelled = true; };
  }, [endpoint, mode]);

  const requestHint = useCallback(async () => {
    if (inFlightRef.current || mode === 'osce' || quota?.remaining === 0) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    setOpen(true);
    const clientEventId = clientEventIdRef.current ?? crypto.randomUUID();
    clientEventIdRef.current = clientEventId;
    try {
      const value = await authedFetch<DirectionHintResult>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ clientEventId, stage }),
      });
      setResult(value);
      setQuota({ used: value.used, remaining: value.remaining });
      clientEventIdRef.current = null;
    } catch (cause) {
      setError(cause instanceof AuthedApiError && cause.code === 'HINT_QUOTA_EXHAUSTED'
        ? '本次接诊的 3 次 AI 方向提示已用完。'
        : cause instanceof Error ? cause.message : 'AI 方向提示暂时不可用，请稍后重试。');
      if (cause instanceof AuthedApiError && cause.code === 'HINT_QUOTA_EXHAUSTED') setQuota({ used: 3, remaining: 0 });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [endpoint, mode, quota?.remaining, stage]);

  if (mode === 'osce') return null;
  return <div className="direction-hint-anchor">
    <button className="btn btn-quiet direction-hint-trigger" type="button" disabled={busy || quota?.remaining === 0} aria-expanded={open} onClick={() => { if (open) setOpen(false); else void requestHint(); }}>
      {busy ? <LoaderCircle className="spin" size={15} /> : <Lightbulb size={15} />}
      AI 提醒{quota ? ` · 剩余 ${quota.remaining} 次` : ''}
    </button>
    {open && <section className="direction-hint-popover" aria-label="AI 方向提示">
      <div className="direction-hint-head"><strong>仅提示下一步采集方向</strong><button className="icon-btn" type="button" aria-label="关闭 AI 方向提示" onClick={() => setOpen(false)}><X size={15} /></button></div>
      {busy && !result ? <p>正在依据本会话已获得的信息整理提示…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {result ? <><p>{result.hint}</p><small>不提供诊断、标准答案或处置方案；本次剩余 {result.remaining} 次。</small></> : null}
      {error && !busy && quota?.remaining !== 0 ? <button className="btn btn-secondary btn-small" type="button" onClick={() => void requestHint()}>重试</button> : null}
    </section>}
  </div>;
}
