'use client';

import { useEffect, useRef, useState } from 'react';
import { PhoneOff } from 'lucide-react';
import type { SessionState } from '@/domain/agent';
import { appendVoiceTranscript, resolveSpeechTurnMeta, type SpeechTurnMeta, type VoiceRecordingResult } from '@/domain/speech-contract';
import { RoleAudioPlayer, type RoleAudioPlayerHandle } from '@/components/role-audio-player';
import { ConversationComposer } from '@/components/conversation-composer';
import { ConversationThread, type PendingConversation } from '@/components/conversation-thread';

export interface CommunicationCallProps {
  session: SessionState;
  ttsEnabled: boolean;
  onToggleTts: () => boolean | Promise<boolean>;
  busy: boolean;
  pending: PendingConversation | null;
  streamingIds: ReadonlySet<string>;
  onStreamDone: (id: string) => void;
  onSend: (text: string, speech: SpeechTurnMeta | null) => Promise<boolean> | boolean;
  onFinish: () => void;
  canFinish: boolean;
}

export function CommunicationCall({
  session, ttsEnabled, onToggleTts, busy, pending, streamingIds, onStreamDone, onSend, onFinish, canFinish,
}: CommunicationCallProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [draft, setDraft] = useState('');
  const [voiceDraft, setVoiceDraft] = useState<{ rawText: string; fileId: string | null; durationMs: number } | null>(null);
  const audioPlayerRef = useRef<RoleAudioPlayerHandle>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSec((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function sendText() {
    const text = draft.trim();
    if (!text || busy) return;
    const currentVoice = voiceDraft;
    const speech = currentVoice ? resolveSpeechTurnMeta(
      currentVoice.rawText,
      text,
      currentVoice.fileId ? { fileId: currentVoice.fileId, durationMs: currentVoice.durationMs } : undefined,
    ) : null;
    setDraft('');
    const succeeded = await onSend(text, speech);
    if (succeeded) setVoiceDraft(null);
    else setDraft((current) => current || text);
  }

  function acceptVoiceResult(result: VoiceRecordingResult) {
    setDraft((current) => appendVoiceTranscript(current, result.text));
    setVoiceDraft({ rawText: result.text, fileId: result.audioFileId, durationMs: result.audioDurationMs });
  }

  function hangUp() {
    const label = canFinish ? '结束本次通话并生成临床能力专项报告？通话中的解释内容已记录。' : '尚未完成有效的解释沟通，结束后将按当前进度生成临床能力专项报告。确定结束通话吗？';
    if (!window.confirm(label)) return;
    audioPlayerRef.current?.stop();
    onFinish();
  }

  const messages = session.messages.filter((item) => item.kind !== 'navigation' || item.actor !== 'system');
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');

  return <div className="communication-call" data-muted={!ttsEnabled || undefined}>
    <header className="call-header">
      <div className="call-identity">
        <span className="call-badge" title="本通话为教学模拟，角色语音由 AI 生成">AI 模拟通话</span>
        <strong>家长（焦虑） · 患儿陪同</strong>
        <small>通话中 {mm}:{ss}</small>
      </div>
      <div className="call-controls">
        <button className="btn btn-danger call-hangup" type="button" disabled={busy} onClick={hangUp}><PhoneOff size={15} /> 结束通话</button>
      </div>
    </header>
    <ConversationThread
      sessionId={session.id}
      messages={messages}
      pending={pending}
      streamingIds={streamingIds}
      onStreamDone={onStreamDone}
      ttsEnabled={ttsEnabled}
      onReplay={(id) => audioPlayerRef.current?.replay(id)}
      onRetry={() => void sendText()}
    />
    <RoleAudioPlayer ref={audioPlayerRef} sessionId={session.id} messages={messages} enabled={ttsEnabled} />
    <footer className="call-input">
      <ConversationComposer
        sessionId={session.id}
        inputId="communication-question"
        value={draft}
        onValueChange={setDraft}
        onSend={sendText}
        onVoiceResult={acceptVoiceResult}
        busy={busy}
        mode="communication"
        label="输入对家长的解释"
        placeholder="向家长解释病情、风险与下一步安排…"
        ttsEnabled={ttsEnabled}
        onToggleTts={onToggleTts}
      />
    </footer>
  </div>;
}
