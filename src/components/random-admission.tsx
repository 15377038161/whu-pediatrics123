'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shuffle } from 'lucide-react';
import { authedFetch } from '@/lib/authed-api';
import type { SessionState } from '@/domain/agent';

export function RandomAdmission({ excludeCaseId, label = '随机接诊新患儿' }: { excludeCaseId?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [repeat, setRepeat] = useState(false);
  const requestId = useRef<string | null>(null);
  const pending = useRef(false);
  async function start(allowRepeat = false) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    requestId.current ??= crypto.randomUUID();
    try {
      const session = await authedFetch<SessionState>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode: 'guided', random: true, excludeCaseId, allowRepeat, clientRequestId: requestId.current }) });
      router.push(`/student/training?session=${session.id}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '接诊暂时失败，请重试。';
      setError(message);
      if (message.includes('只有当前病例')) { setRepeat(true); requestId.current = null; }
    } finally { pending.current = false; setBusy(false); }
  }
  return <div className="random-admission"><button className="btn btn-secondary" disabled={busy} onClick={() => void start()}><Shuffle size={16} />{busy ? '正在安排接诊…' : label}</button>
    {error && <p role="alert">{error}</p>}{repeat && <button className="btn btn-quiet" disabled={busy} onClick={() => void start(true)}>重新训练当前病例</button>}</div>;
}
