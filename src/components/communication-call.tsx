'use client';

/**
 * 模拟通话界面（阶段 D，方案 6.4）：家长焦虑沟通专项的通话样式交互。
 *  - AI 模拟标识：界面明示「AI 模拟通话」，不伪装成真人来电；
 *  - 按轮录音如实展示：不显示虚假的「持续聆听」状态（语音链按轮进行，见 voice-input）；
 *  - 通话时长：进入通话开始计时，结束通话需确认；
 *  - 静音：关闭角色语音播报（不影响文字消息与训练流程）；
 *  - 停止播报：随时中断当前播报（RoleAudioPlayer 内置）；
 *  - 语音不可用/麦克风被拒：可切换文字输入，训练进度不受影响。
 */

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, MessageSquare, Mic, PhoneOff, Send, Volume2, VolumeX } from 'lucide-react';
import type { AgentMessage, SessionState } from '@/domain/agent';
import type { SpeechTurnMeta } from '@/domain/speech-contract';
import { RoleAudioPlayer, type RoleAudioPlayerHandle } from '@/components/role-audio-player';
import { VoiceInput } from '@/components/voice-input';

export interface CommunicationCallProps {
  session: SessionState;
  /** 语音能力就绪（asr/tts 均为 turn-based）；false 时只提供文字输入。 */
  speechReady: boolean;
  busy: boolean;
  /** 发送家长沟通内容（SEND_COMMUNICATION 事件由工作台语义推导/上抛）；返回是否成功。 */
  onSend: (text: string, speech: SpeechTurnMeta | null) => Promise<boolean> | boolean;
  /** 结束通话（生成专项报告前的确认由本组件完成）。 */
  onFinish: () => void;
  /** 已完成有效沟通轮（结束前置条件）。 */
  canFinish: boolean;
}

function actorLabel(actor: AgentMessage['actor']): string {
  return ({ student: '你（医生）', child: '患儿', parent: '家长', tutor: '教学智能体', system: '病例系统' } as Record<string, string>)[actor] ?? actor;
}

export function CommunicationCall({ session, speechReady, busy, onSend, onFinish, canFinish }: CommunicationCallProps) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [muted, setMuted] = useState(false);
  const [inputMode, setInputMode] = useState<'voice' | 'text'>(speechReady ? 'voice' : 'text');
  const [draft, setDraft] = useState('');
  const transcriptRef = useRef<HTMLDivElement>(null);
  const audioPlayerRef = useRef<RoleAudioPlayerHandle>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSec((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [session.messages.length]);

  async function sendText() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    const ok = await onSend(text, null);
    if (!ok) {
      // 发送失败回填草稿（工作台已提示错误），进度不受影响
      setDraft(text);
    }
  }

  function hangUp() {
    const label = canFinish ? '结束本次通话并生成专项报告？通话中的解释内容已记录。' : '尚未完成有效的解释沟通，结束后将按当前进度生成专项报告。确定结束通话吗？';
    if (!window.confirm(label)) return;
    audioPlayerRef.current?.stop();
    onFinish();
  }

  const messages = session.messages.filter((item) => item.kind !== 'navigation' || item.actor !== 'system');
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');

  return (
    <div className="communication-call" data-muted={muted || undefined}>
      <header className="call-header">
        <div className="call-identity">
          <span className="call-badge" title="本通话为教学模拟，角色语音由 AI 生成">AI 模拟通话</span>
          <strong>家长（焦虑） · 患儿陪同</strong>
          <small>通话中 {mm}:{ss}</small>
        </div>
        <div className="call-controls">
          <button
            className="icon-btn"
            type="button"
            aria-pressed={muted}
            aria-label={muted ? '取消静音（恢复角色语音播报）' : '静音（关闭角色语音播报）'}
            onClick={() => setMuted((value) => !value)}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <button className="btn btn-danger call-hangup" type="button" disabled={busy} onClick={hangUp}>
            <PhoneOff size={15} /> 结束通话
          </button>
        </div>
      </header>

      <RoleAudioPlayer
        ref={audioPlayerRef}
        sessionId={session.id}
        messages={messages}
        enabled={!muted}
      />

      <div className="call-transcript" aria-live="polite" ref={transcriptRef}>
        {messages.map((item) => (
          <div className="message" data-actor={item.actor} key={item.id}>
            <p className="message-label"><span>{actorLabel(item.actor)} · {item.emotion}</span>{item.inputMode === 'voice' && <em className="voice-tag">语音输入</em>}</p>
            <div className="message-bubble">{item.content}</div>
          </div>
        ))}
      </div>

      <footer className="call-input">
        <div className="call-input-mode" role="group" aria-label="输入方式">
          <button
            type="button"
            className="btn btn-secondary"
            aria-pressed={inputMode === 'voice'}
            disabled={!speechReady}
            onClick={() => setInputMode('voice')}
          >
            <Mic size={14} /> 语音
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            aria-pressed={inputMode === 'text'}
            onClick={() => setInputMode('text')}
          >
            <MessageSquare size={14} /> 文字
          </button>
        </div>
        {inputMode === 'voice' && speechReady ? (
          <VoiceInput communicationMode disabled={busy} onSend={onSend} />
        ) : (
          <div className="call-text-composer">
            <textarea
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="输入对家长的解释"
              placeholder="向家长解释病情、风险与下一步安排，例如：我理解您很担心，孩子目前呼吸和血氧需要先处理……"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendText();
                }
              }}
            />
            <button className="btn btn-primary" type="button" disabled={busy || !draft.trim()} onClick={() => void sendText()}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} 发送
            </button>
          </div>
        )}
        {!speechReady && (
          <p className="call-fallback-note">语音暂不可用，可先用文字完成沟通；训练进度不受影响。</p>
        )}
      </footer>
    </div>
  );
}
