'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Pause, Play } from 'lucide-react';
import { requestStudentAudio } from '@/lib/speech';

export function VoiceMessageButton({ sessionId, messageId, durationMs }: {
  sessionId: string;
  messageId: string;
  durationMs: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const stopOthers = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== messageId) audioRef.current?.pause();
    };
    window.addEventListener('student-voice-play', stopOthers);
    return () => window.removeEventListener('student-voice-play', stopOthers);
  }, [messageId]);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) { audio.pause(); return; }
    setError('');
    setLoading(true);
    try {
      if (!audio.src) {
        const { audioUrl } = await requestStudentAudio(sessionId, messageId);
        audio.src = audioUrl;
      }
      window.dispatchEvent(new CustomEvent('student-voice-play', { detail: messageId }));
      await audio.play();
    } catch {
      audio.removeAttribute('src');
      audio.load();
      setPlaying(false);
      setError('录音播放失败，请重试；也可阅读下方转写。');
    } finally {
      setLoading(false);
    }
  }

  return <div className="voice-message-control" data-playing={playing}>
    <button type="button" onClick={() => void toggle()} disabled={loading} aria-label={playing ? '暂停语音消息' : '播放语音消息'}>
      {loading ? <LoaderCircle className="spin" size={16} /> : playing ? <Pause size={16} /> : <Play size={16} />}
      <span className="voice-message-bars" aria-hidden="true"><i /><i /><i /><i /></span>
      <strong>{Math.max(1, Math.round(durationMs / 1000))}″</strong>
    </button>
    <audio
      ref={audioRef}
      preload="none"
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => setPlaying(false)}
      onError={(event) => {
        event.currentTarget.removeAttribute('src');
        setPlaying(false);
        setError('录音播放失败，请重试；也可阅读下方转写。');
      }}
    />
    {error && <small role="status">{error}</small>}
  </div>;
}
