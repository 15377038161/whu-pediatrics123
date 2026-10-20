'use client';

/**
 * 角色语音播报器（阶段 D，方案 6.3）：按到达顺序队列播报新角色消息。
 *  - 文本只取会话中已存在的角色消息（服务端 /api/speech/tts 按 messageId 校验合成），
 *    本组件不生成新事实；纯括注消息（如“（哭闹不安）”）跳过，不做语音合成；
 *  - 同一角色音色由服务端稳定映射（docs/SPEECH_INTEGRATION.md），客户端不选音色；
 *  - NOT_SPEAKABLE / 合成失败静默跳过（不影响训练流程），播报可随时停止。
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Square, Volume2 } from 'lucide-react';
import type { AgentMessage } from '@/domain/agent';
import { requestMessageAudio } from '@/lib/speech';

const SPEAKABLE_ACTORS = new Set(['child', 'parent', 'tutor']);

/** 纯括注（非言语舞台提示）不播报——与服务端守卫同规则，客户端预过滤省配额。 */
function isSpeakable(message: AgentMessage): boolean {
  if (!SPEAKABLE_ACTORS.has(message.actor)) return false;
  const text = message.content.trim();
  if (!text) return false;
  return !/^（[^（）]*）$/.test(text);
}

export interface RoleAudioPlayerHandle {
  /** 停止当前播报并清空队列。 */
  stop: () => void;
  /** 重播某条消息（回看场景）。 */
  replay: (messageId: string) => void;
}

export interface RoleAudioPlayerProps {
  sessionId: string;
  messages: AgentMessage[];
  /** 关闭（静音）时不播报并停止当前播放。 */
  enabled: boolean;
  onSpeakingMessageChange?: (messageId: string | null) => void;
}

function actorLabel(actor: AgentMessage['actor']): string {
  return actor === 'child' ? '患儿' : actor === 'parent' ? '家长' : '教学智能体';
}

export const RoleAudioPlayer = forwardRef<RoleAudioPlayerHandle, RoleAudioPlayerProps>(function RoleAudioPlayer(
  { sessionId, messages, enabled, onSpeakingMessageChange },
  ref,
) {
  const spokenRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<AgentMessage[]>([]);
  const pumpingRef = useRef(false);
  const generationRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakingRef = useRef<AgentMessage | null>(null);

  const stop = () => {
    generationRef.current += 1;
    queueRef.current = [];
    audioRef.current?.pause();
    audioRef.current = null;
    if (speakingRef.current) {
      speakingRef.current = null;
      onSpeakingMessageChange?.(null);
    }
  };

  useImperativeHandle(ref, () => ({
    stop,
    replay: (messageId: string) => {
      const target = messages.find((item) => item.id === messageId);
      if (!target || !isSpeakable(target) || !enabled) return;
      queueRef.current.unshift(target);
      void pump();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [enabled, messages]);

  async function pump() {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    const generation = generationRef.current;
    try {
      while (queueRef.current.length > 0 && generationRef.current === generation && enabled) {
        const target = queueRef.current.shift();
        if (!target || !isSpeakable(target)) continue;
        try {
          const { audioUrl } = await requestMessageAudio(sessionId, target.id);
          if (generationRef.current !== generation) break;
          speakingRef.current = target;
          onSpeakingMessageChange?.(target.id);
          await playOnce(audioUrl);
        } catch {
          // NOT_SPEAKABLE / 过期 / 服务暂不可用：跳过该条，不打断训练流程
        } finally {
          speakingRef.current = null;
          onSpeakingMessageChange?.(null);
        }
      }
    } finally {
      pumpingRef.current = false;
    }
  }

  function playOnce(url: string): Promise<void> {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  }

  // 新消息入队：只处理到达后未播报过的角色消息（幂等，不重播历史）
  useEffect(() => {
    if (!enabled) return;
    const pending = messages.filter((item) => !spokenRef.current.has(item.id) && isSpeakable(item));
    for (const item of pending) spokenRef.current.add(item.id);
    if (pending.length === 0) return;
    queueRef.current.push(...pending);
    void pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, enabled]);

  // 静音关闭时立即停止当前播报
  useEffect(() => {
    if (!enabled) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // 会话切换：清空已播报记录与队列
  useEffect(() => {
    spokenRef.current = new Set();
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (!enabled || (!speakingRef.current && queueRef.current.length === 0)) return null;
  const current = speakingRef.current;
  return (
    <div className="role-audio-player" role="status" aria-live="polite">
      <Volume2 size={15} aria-hidden="true" />
      <span className="role-audio-label">{current ? `${actorLabel(current.actor)}正在说明…` : '角色语音播报中…'}</span>
      <button className="btn btn-secondary role-audio-stop" type="button" onClick={stop}>
        <Square size={13} /> 停止播报
      </button>
    </div>
  );
});
