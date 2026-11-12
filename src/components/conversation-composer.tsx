'use client';

import { useEffect, useRef, useState } from 'react';
import { Keyboard, Mic, Send, Volume2, VolumeX } from 'lucide-react';
import { VoiceHoldButton } from '@/components/voice-hold-button';
import type { VoiceRecordingResult } from '@/domain/speech-contract';

interface ConversationComposerProps {
  sessionId: string;
  inputId: string;
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onVoiceResult: (result: VoiceRecordingResult) => void;
  busy: boolean;
  mode: 'history' | 'communication';
  label: string;
  placeholder: string;
  ttsEnabled: boolean;
  onToggleTts: () => boolean | Promise<boolean>;
}

/** WeChat/QQ-style composer: one slot, shared draft, and no implicit microphone/TTS work. */
export function ConversationComposer({
  sessionId, inputId, value, onValueChange, onSend, onVoiceResult, busy, mode, label, placeholder,
  ttsEnabled, onToggleTts,
}: ConversationComposerProps) {
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || inputMode !== 'text') return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 120 ? 'auto' : 'hidden';
  }, [inputMode, value]);

  function acceptVoiceResult(result: VoiceRecordingResult) {
    onVoiceResult(result);
    setInputMode('text');
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return <div className="composer-card" data-mode={mode} data-input-mode={inputMode}>
    <div className="composer-main-row">
      <button
        className="composer-icon-button composer-mode-toggle"
        type="button"
        aria-label={inputMode === 'text' ? '切换为语音输入' : '切换为键盘输入，保留当前草稿'}
        title={inputMode === 'text' ? '语音输入' : '键盘输入'}
        aria-pressed={inputMode === 'voice'}
        onClick={() => setInputMode((current) => current === 'text' ? 'voice' : 'text')}
      >
        {inputMode === 'text' ? <Mic size={20} /> : <Keyboard size={20} />}
      </button>
      <div className="composer-input-slot">
        {inputMode === 'text' ? <div className="composer">
          <label className="sr-only" htmlFor={inputId}>{label}</label>
          <textarea
            ref={textareaRef}
            id={inputId}
            rows={1}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void onSend();
              }
            }}
          />
        </div> : <VoiceHoldButton sessionId={sessionId} disabled={busy} onResult={acceptVoiceResult} />}
      </div>
      <button
        className="composer-icon-button composer-audio-toggle"
        type="button"
        aria-pressed={ttsEnabled}
        aria-label={ttsEnabled ? '关闭 AI 回复语音播报' : '开启 AI 回复语音播报'}
        title={ttsEnabled ? 'AI 播报已开启，仅播报新消息' : 'AI 播报已关闭，点击开启'}
        onClick={() => { void onToggleTts(); }}
      >
        {ttsEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
      </button>
      <button className="btn btn-primary composer-send" type="button" disabled={busy || !value.trim()} onClick={() => { void onSend(); }} aria-label="确认并发送当前草稿">
        <Send size={17} /><span>发送</span>
      </button>
    </div>
  </div>;
}
