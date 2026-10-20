'use client';

/**
 * 语音轮输入组件（阶段 D，方案 6.2）：录音 → 转写 → 确认/编辑 → 发送。
 * 状态机严格按 VOICE_TURN_TRANSITIONS 驱动（speech-contract.ts）：
 *  - 未确认的转写不作为答：transcribing 不存在 → sending 边，必须经过 confirming；
 *  - 不自动连录：sending 只能回到 idle，下一轮录音由用户显式开始；
 *  - 确认态内可编辑转写；发送复用工作台既有 ASK_QUESTION / SEND_COMMUNICATION 事件
 *   （经 onSend 上抛，本组件不另建临床语义）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, LoaderCircle, Mic, Pencil, Square, X } from 'lucide-react';
import type { SpeechTurnMeta, VoiceTurnState } from '@/domain/speech-contract';
import { canTransitionVoiceTurn, resolveSpeechTurnMeta } from '@/domain/speech-contract';
import { MicPermissionError, type WavRecorder, startWavRecording, requestTranscription } from '@/lib/speech';

export interface VoiceInputProps {
  disabled?: boolean;
  /** 沟通模式（处置后/沟通站）提示文案切换；语义推导仍由工作台完成。 */
  communicationMode?: boolean;
  /** 发送回调：返回是否成功。失败时组件回到确认态保留草稿，可重试或改用文字。 */
  onSend: (text: string, speech: SpeechTurnMeta | null) => Promise<boolean> | boolean;
}

function transition(from: VoiceTurnState, to: VoiceTurnState, setState: (next: VoiceTurnState) => void): boolean {
  if (!canTransitionVoiceTurn(from, to)) return false;
  setState(to);
  return true;
}

export function VoiceInput({ disabled = false, communicationMode = false, onSend }: VoiceInputProps) {
  const [state, setState] = useState<VoiceTurnState>('idle');
  const [asrRaw, setAsrRaw] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const recorderRef = useRef<WavRecorder | null>(null);
  const stateRef = useRef<VoiceTurnState>('idle');
  const tickRef = useRef(0);

  const setStateGuarded = useCallback((next: VoiceTurnState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      window.clearInterval(tickRef.current);
    };
  }, []);

  async function startRecording() {
    if (disabled || !transition(stateRef.current, 'recording', setStateGuarded)) return;
    setError(null);
    setAsrRaw('');
    setDraft('');
    setDurationSec(0);
    try {
      const recorder = await startWavRecording();
      recorderRef.current = recorder;
      // 时长上限自动停录：仍进入转写确认流程，不自动发送。
      recorder.onLimitReached = () => void stopRecording();
      tickRef.current = window.setInterval(() => {
        setDurationSec(Math.floor(recorder.durationMs() / 1000));
      }, 250);
    } catch (cause) {
      recorderRef.current = null;
      window.clearInterval(tickRef.current);
      setStateGuarded('idle');
      if (cause instanceof MicPermissionError) {
        setError(`${cause.message} 你可以直接使用文字输入，训练进度不受影响。`);
      } else {
        setError(cause instanceof Error ? cause.message : '无法开始录音，请重试或使用文字输入。');
      }
    }
  }

  async function stopRecording() {
    window.clearInterval(tickRef.current);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder || !transition(stateRef.current, 'transcribing', setStateGuarded)) {
      recorder?.cancel();
      return;
    }
    try {
      const audio = await recorder.stop();
      if (audio.size === 0) {
        setStateGuarded('idle');
        setError('录音太短，请重新录音。');
        return;
      }
      const text = await requestTranscription(audio);
      if (!text.trim()) {
        setStateGuarded('failed');
        setError('没有识别到语音内容，请靠近麦克风重新录音，或使用文字输入。');
        return;
      }
      setAsrRaw(text);
      setDraft(text);
      transition(stateRef.current, 'confirming', setStateGuarded);
    } catch (cause) {
      setStateGuarded('failed');
      setError(cause instanceof Error ? cause.message : '语音识别失败，请重试或使用文字输入。');
    }
  }

  function cancelRecording() {
    window.clearInterval(tickRef.current);
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setDurationSec(0);
    transition(stateRef.current, 'idle', setStateGuarded);
  }

  async function confirmSend() {
    const text = draft.trim();
    if (!text || !transition(stateRef.current, 'sending', setStateGuarded)) return;
    let ok = false;
    try {
      ok = await onSend(text, resolveSpeechTurnMeta(asrRaw, text));
    } catch {
      ok = false;
    }
    if (ok) {
      // 一轮完成回到 idle；不自动连录（无 sending → recording 边）。
      setAsrRaw('');
      setDraft('');
      setError(null);
      setStateGuarded('idle');
      return;
    }
    // 发送失败回到确认态：草稿保留，可重试发送或放弃改用文字（进度不丢失）。
    setStateGuarded('confirming');
    setError('发送失败，请检查网络后重试；也可以放弃并改用文字输入。');
  }

  function abandonConfirm() {
    setAsrRaw('');
    setDraft('');
    transition(stateRef.current, 'idle', setStateGuarded);
  }

  function retryRecording() {
    setError(null);
    transition(stateRef.current, 'recording', setStateGuarded);
    void startRecording();
  }

  function backToIdle() {
    setError(null);
    transition(stateRef.current, 'idle', setStateGuarded);
  }

  const edited = draft.trim() !== asrRaw.trim();

  return (
    <div className="voice-input" data-state={state} data-disabled={disabled || undefined}>
      {state === 'idle' && (
        <div className="voice-idle">
          <button className="voice-btn" type="button" disabled={disabled} onClick={() => void startRecording()} aria-label="开始录音（按轮录音，录音后确认转写再发送）">
            <Mic size={16} />
          </button>
          <p className="voice-hint">{communicationMode ? '语音向家长解释：录音后确认转写再发送' : '语音问诊：录音后确认转写再发送'}</p>
        </div>
      )}
      {state === 'recording' && (
        <div className="voice-recording" role="status">
          <span className="voice-pulse" aria-hidden="true" />
          <strong className="voice-duration">{Math.floor(durationSec / 60)}:{String(durationSec % 60).padStart(2, '0')}</strong>
          <span className="voice-hint">录音中…说完后点击停止</span>
          <button className="btn btn-primary voice-stop" type="button" onClick={() => void stopRecording()}>
            <Square size={14} /> 停止并识别
          </button>
          <button className="btn btn-secondary" type="button" onClick={cancelRecording}>
            <X size={14} /> 取消
          </button>
        </div>
      )}
      {state === 'transcribing' && (
        <div className="voice-transcribing" role="status">
          <LoaderCircle className="spin" size={16} aria-hidden="true" />
          <span>正在识别录音…</span>
        </div>
      )}
      {state === 'confirming' && (
        <div className="voice-confirming">
          <p className="voice-confirm-label">
            <Pencil size={14} aria-hidden="true" /> 请确认识别结果（可编辑后再发送）
          </p>
          <textarea
            className="voice-transcript"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="确认或编辑语音识别结果"
            placeholder="识别结果会显示在这里，可编辑后发送"
          />
          {edited && <p className="voice-raw-note">识别原文：{asrRaw}（发送会记录你的修改，评分只看确认后的内容）</p>}
          {error && <p className="voice-error" role="alert">{error}</p>}
          <div className="voice-confirm-actions">
            <button className="btn btn-primary" type="button" disabled={!draft.trim()} onClick={() => void confirmSend()}>
              <Check size={14} /> 确认发送
            </button>
            <button className="btn btn-secondary" type="button" onClick={abandonConfirm}>
              <X size={14} /> 放弃
            </button>
          </div>
        </div>
      )}
      {state === 'sending' && (
        <div className="voice-sending" role="status">
          <LoaderCircle className="spin" size={16} aria-hidden="true" />
          <span>发送中…</span>
        </div>
      )}
      {state === 'failed' && (
        <div className="voice-failed" role="alert">
          <p><AlertCircle size={15} aria-hidden="true" /> {error ?? '语音环节失败，可重试或改用文字输入。'}</p>
          <div className="voice-confirm-actions">
            <button className="btn btn-primary" type="button" onClick={retryRecording}>
              <Mic size={14} /> 重新录音
            </button>
            <button className="btn btn-secondary" type="button" onClick={backToIdle}>
              改用文字输入
            </button>
          </div>
        </div>
      )}
      {error && state === 'idle' && <p className="voice-error" role="alert">{error}</p>}
    </div>
  );
}
