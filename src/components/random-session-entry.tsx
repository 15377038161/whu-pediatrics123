'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shuffle } from 'lucide-react';
import { authedFetch } from '@/lib/authed-api';
import type { PracticeFocus, SessionMode, SessionState } from '@/domain/agent';

interface RandomSessionOptions {
  mode: SessionMode;
  focus?: PracticeFocus;
  excludeCaseId?: string;
}

/**
 * 服务端随机抽例的统一入口逻辑。专项与 OSCE 页面不再自带 caseId：
 * 抽哪一例由服务端在建会话时决定，页面与 URL 在抽中前都不出现病例标识（闭卷语义）。
 * clientRequestId 保证断网重试与并发点击落到同一会话，不会连开两例。
 */
export function useRandomSession({ mode, focus, excludeCaseId }: RandomSessionOptions) {
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
      const session = await authedFetch<SessionState>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ mode, random: true, focus, excludeCaseId, allowRepeat, clientRequestId: requestId.current }),
      });
      router.push(`/student/training?session=${session.id}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '接诊暂时失败，请重试。';
      setError(message);
      // 目录只剩当前一例时不换请求标识，改用重练语义，避免学生被 409 卡死。
      if (message.includes('只有当前病例')) { setRepeat(true); requestId.current = null; }
    } finally { pending.current = false; setBusy(false); }
  }
  return { busy, error, repeat, start };
}

/** 重试提示：目录只剩一例时给出「重新训练当前病例」出口，两种形态共用。 */
export function RandomSessionRetry({ repeat, busy, onStart }: { repeat: boolean; busy: boolean; onStart: (allowRepeat: boolean) => void }) {
  if (!repeat) return null;
  return <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void onStart(true)}>重新训练当前病例</button>;
}

export function RandomSessionEntry({ mode, focus, excludeCaseId, label, busyLabel = '正在安排…', className = 'btn btn-secondary' }: RandomSessionOptions & {
  label: string;
  busyLabel?: string;
  className?: string;
}) {
  const { busy, error, repeat, start } = useRandomSession({ mode, focus, excludeCaseId });
  return (
    <div className="random-admission">
      <button type="button" className={className} disabled={busy} onClick={() => void start()}>
        <Shuffle size={16} />{busy ? busyLabel : label}
      </button>
      {error && <p role="alert">{error}</p>}
      <RandomSessionRetry repeat={repeat} busy={busy} onStart={start} />
    </div>
  );
}
