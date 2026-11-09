'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic } from 'lucide-react';
import type { VoiceRecordingResult } from '@/domain/speech-contract';
import { MAX_RECORDING_MS, requestVoiceTurn, startWavRecording, type WavRecorder } from '@/lib/speech';

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing';

export function VoiceHoldButton({ sessionId, disabled, onResult }: {
  sessionId: string;
  disabled: boolean;
  onResult: (result: VoiceRecordingResult) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState('');
  const recorderRef = useRef<WavRecorder | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef(0);
  const startedAtRef = useRef(0);
  const activeRef = useRef(false);
  const finishingRef = useRef(false);
  const cancelRef = useRef(false);
  const pointerRef = useRef<number | null>(null);
  const startYRef = useRef(0);
  const generationRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const clearTimer = () => {
    window.clearInterval(timerRef.current);
    timerRef.current = 0;
  };

  const finish = async (cancel: boolean) => {
    if (!activeRef.current || finishingRef.current) return;
    finishingRef.current = true;
    activeRef.current = false;
    pointerRef.current = null;
    clearTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) {
      setPhase('idle');
      setCancelling(false);
      finishingRef.current = false;
      return;
    }
    try {
      if (cancel) {
        recorder.cancel();
        setPhase('idle');
        setNotice('已取消本次录音，输入内容未改变。');
      } else {
        const recording = await recorder.stop();
        if (recording.durationMs < 400 || recording.blob.size <= 44) {
          setPhase('idle');
          setNotice('说话时间太短，请按住后再开始说话。');
        } else {
          setPhase('transcribing');
          const controller = new AbortController();
          abortRef.current = controller;
          const timeout = window.setTimeout(() => controller.abort(), 35_000);
          try {
            const result = await requestVoiceTurn(sessionId, recording, controller.signal);
            onResult(result);
            setNotice(result.storageWarning ?? '识别结果已回填，请确认或编辑后发送。');
          } finally {
            window.clearTimeout(timeout);
            abortRef.current = null;
          }
          setPhase('idle');
        }
      }
    } catch (cause) {
      setPhase('idle');
      setNotice(cause instanceof Error ? cause.message : '语音识别失败，请改用文字输入。');
    } finally {
      setElapsedMs(0);
      setLevel(0);
      setCancelling(false);
      finishingRef.current = false;
    }
  };

  const begin = async (startY: number, pointerId: number | null, target: HTMLButtonElement) => {
    if (disabled || activeRef.current || finishingRef.current || phase !== 'idle') return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    activeRef.current = true;
    cancelRef.current = false;
    finishingRef.current = false;
    pointerRef.current = pointerId;
    startYRef.current = startY;

    setNotice('');
    setCancelling(false);
    setPhase('starting');
    try {
      if(pointerId!==null)target.setPointerCapture(pointerId);
      const recorder = await startWavRecording(MAX_RECORDING_MS, setLevel);
      if (generationRef.current !== generation || !activeRef.current) {
        recorder.cancel();
        return;
      }
      recorderRef.current = recorder;
      recorder.onLimitReached = () => { setNotice('已到单轮时长上限，正在识别。'); void finish(cancelRef.current); };
      recorder.onInterrupted = () => {
        recorder.cancel();
        recorderRef.current = null;
        pointerRef.current = null;
        activeRef.current = false;
        finishingRef.current = false;
        clearTimer();
        setElapsedMs(0);
        setLevel(0);
        setCancelling(false);
        setPhase('idle');
        setNotice('录音被系统中断，请重新按住说话，或使用文字输入。');
      };
      startedAtRef.current = performance.now();
      setPhase('recording');
      timerRef.current = window.setInterval(() => setElapsedMs(performance.now() - startedAtRef.current), 100);
    } catch (cause) {
      activeRef.current = false;
      pointerRef.current = null;
      setPhase('idle');
      setNotice(cause instanceof Error ? cause.message : '无法开始录音，请使用文字输入。');
    }
  };

  useEffect(() => () => {
    generationRef.current += 1;
    activeRef.current = false;
    clearTimer();
    recorderRef.current?.cancel();
    abortRef.current?.abort();
  }, []);

  const seconds = Math.min(MAX_RECORDING_MS, elapsedMs) / 1000;
  const active = phase !== 'idle';
  return <div className="voice-hold" data-phase={phase}>
    {active && <div className={`voice-hold-panel${cancelling ? ' is-cancelling' : ''}`} role="status" aria-live="polite">
      {phase === 'transcribing' ? <><LoaderCircle className="spin" size={18} /><span>正在识别，文字输入仍可使用</span></> : <>
        <div className="voice-wave" aria-hidden="true">{Array.from({ length: 17 }, (_, index) => {
          const envelope = 0.25 + 0.75 * Math.sin(((index + 1) / 18) * Math.PI);
          const height = 5 + Math.round(level * envelope * 28);
          return <i key={index} style={{ height }} />;
        })}</div>
        <strong>{phase === 'starting' ? '正在请求麦克风…' : `${seconds.toFixed(1)}″ / ${MAX_RECORDING_MS / 1000}″`}</strong>
        <span>{cancelling ? '松开取消' : phase === 'starting' ? '请允许麦克风权限' : '松开发送识别 · 上滑取消'}</span>
      </>}
    </div>}
    <button
      ref={buttonRef}
      className="voice-hold-button"
      type="button"
      aria-label="按住说话，松开发送识别，上滑取消"
      aria-pressed={phase === 'recording'}
      aria-disabled={disabled || phase === 'transcribing'}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        void begin(event.clientY, event.pointerId, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (pointerRef.current !== event.pointerId || !activeRef.current) return;
        const cancel = startYRef.current - event.clientY > 72;
        cancelRef.current = cancel;
        setCancelling(cancel);
      }}
      onPointerUp={(event) => {
        if (pointerRef.current !== event.pointerId) return;
        event.preventDefault();
        void finish(cancelRef.current);
      }}
      onPointerCancel={() => { cancelRef.current = true; void finish(true); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && activeRef.current) {
          event.preventDefault();
          cancelRef.current = true;
          setCancelling(true);
          void finish(true);
        } else if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          void begin(0, null, event.currentTarget);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          void finish(cancelRef.current);
        }
      }}
    >
      {phase === 'transcribing' ? <LoaderCircle className="spin" size={17} /> : <Mic size={17} />}
      {phase === 'transcribing' ? '识别中…' : '按住 说话'}
    </button>
    {notice && <p className={`voice-inline-notice${phase === 'idle' ? '' : ' is-active'}`} role="status">{notice}{!active && <button type="button" onClick={() => { setNotice(''); buttonRef.current?.focus(); }}>重新按住</button>}</p>}
  </div>;
}
