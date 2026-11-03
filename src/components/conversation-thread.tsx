'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bot, ChevronUp, LoaderCircle, RotateCcw, UserRound, Volume2 } from 'lucide-react';
import type { AgentMessage } from '@/domain/agent';
import { StreamText } from '@/components/stream-text';
import { VoiceMessageButton } from '@/components/voice-message-button';

export interface PendingConversation {
  text: string;
  voice: boolean;
  status: 'sending' | 'failed';
}

function actorLabel(actor: AgentMessage['actor']) {
  return ({ student: '你（医生）', child: '患儿', parent: '家长', tutor: '教学智能体', system: '病例系统' } as const)[actor];
}

function messageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' }).format(date);
}

function Avatar({ actor }: { actor: AgentMessage['actor'] }) {
  return <span className="chat-avatar" data-actor={actor} aria-hidden="true">
    {actor === 'student' ? <UserRound size={18} /> : <Bot size={18} />}
  </span>;
}

export function ConversationThread({
  sessionId,
  messages,
  pending,
  streamingIds,
  onStreamDone,
  ttsEnabled,
  onReplay,
  onRetry,
}: {
  sessionId: string;
  messages: AgentMessage[];
  pending: PendingConversation | null;
  streamingIds: ReadonlySet<string>;
  onStreamDone: (id: string) => void;
  ttsEnabled: boolean;
  onReplay: (id: string) => void;
  onRetry?: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const restoreRef = useRef<{ height: number; top: number } | null>(null);
  const visibleMessages = messages.slice(-visibleCount);
  const hiddenCount = Math.max(0, messages.length - visibleMessages.length);
  const latestId = messages.at(-1)?.id;

  useLayoutEffect(() => {
    const list = listRef.current;
    const restore = restoreRef.current;
    if (!list || !restore) return;
    list.scrollTop = list.scrollHeight - restore.height + restore.top;
    restoreRef.current = null;
  }, [visibleCount]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [latestId, pending?.status]);

  useEffect(() => {
    if (streamingIds.size === 0) return;
    let frame = 0;
    const tick = () => {
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [streamingIds.size]);

  function loadEarlier() {
    const list = listRef.current;
    if (list) restoreRef.current = { height: list.scrollHeight, top: list.scrollTop };
    setVisibleCount((count) => count + 30);
  }

  return <div className="message-list history-chat chat-thread" aria-live="polite" ref={listRef}>
    {hiddenCount > 0 && <button className="chat-history-loader" type="button" onClick={loadEarlier}>
      <ChevronUp size={14} /> 加载更早消息（还有 {hiddenCount} 条）
    </button>}
    {visibleMessages.map((item) => {
      const own = item.actor === 'student';
      const canReplay = ttsEnabled && ['child', 'parent', 'tutor'].includes(item.actor) && !/^（[^（）]*）$/.test(item.content.trim());
      const streaming = streamingIds.has(item.id);
      const hasVoice = own && item.inputMode === 'voice' && item.audioFileId && item.audioDurationMs;
      return <article className="message chat-message" data-actor={item.actor} key={item.id}>
        {!own && <Avatar actor={item.actor} />}
        <div className="chat-message-main">
          <p className="message-label chat-message-label">
            <span>{actorLabel(item.actor)} · {messageTime(item.createdAt)}</span>
            {canReplay && !streaming && <button className="message-audio-replay" type="button" onClick={() => onReplay(item.id)} aria-label={`播报这条${actorLabel(item.actor)}消息`}><Volume2 size={13} /> 播报</button>}
          </p>
          <div className="message-bubble chat-bubble">
            {hasVoice && <VoiceMessageButton sessionId={sessionId} messageId={item.id} durationMs={item.audioDurationMs!} />}
            <div className={hasVoice ? 'voice-transcript-text' : undefined}>
              <StreamText text={item.content} animate={streaming} onDone={() => onStreamDone(item.id)} />
            </div>
            {own && item.inputMode === 'voice' && !hasVoice && <small className="voice-text-only">语音转文字{item.transcriptEdited ? ' · 已编辑' : ''}</small>}
          </div>
        </div>
        {own && <Avatar actor={item.actor} />}
      </article>;
    })}
    {pending && <>
      <article className="message chat-message" data-actor="student" data-pending={pending.status}>
        <div className="chat-message-main">
          <p className="message-label chat-message-label"><span>你（医生）</span><span className="chat-send-status">{pending.status === 'sending' ? '发送中' : '发送失败'}</span></p>
          <div className="message-bubble chat-bubble">{pending.text}{pending.voice && <small className="voice-text-only">语音转文字</small>}</div>
          {pending.status === 'failed' && onRetry && <button className="chat-retry" type="button" onClick={onRetry}><RotateCcw size={13} /> 重新发送</button>}
        </div>
        <Avatar actor="student" />
      </article>
      {pending.status === 'sending' && <div className="conversation-waiting" role="status"><LoaderCircle size={14} className="patient-breath" /> AI 正在回复…</div>}
    </>}
  </div>;
}
