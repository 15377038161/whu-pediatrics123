'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Square, Volume2 } from 'lucide-react';
import type { AgentMessage } from '@/domain/agent';
import { requestMessageAudio } from '@/lib/speech';

const SPEAKABLE_ACTORS = new Set(['child', 'parent', 'tutor']);
function isSpeakable(message: AgentMessage): boolean {
  return SPEAKABLE_ACTORS.has(message.actor) && Boolean(message.content.trim()) && !/^（[^（）]*）$/.test(message.content.trim());
}
export interface RoleAudioPlayerHandle { stop: () => void; replay: (messageId: string) => void }
export interface RoleAudioPlayerProps {
  sessionId: string; messages: AgentMessage[]; enabled: boolean;
  onSpeakingMessageChange?: (messageId: string | null) => void;
}
function actorLabel(actor: AgentMessage['actor']): string { return actor === 'child' ? '患儿' : actor === 'parent' ? '家长' : '教学智能体'; }

/** One persistent media element: playback failures are recoverable and stopping settles the queue. */
export const RoleAudioPlayer = forwardRef<RoleAudioPlayerHandle, RoleAudioPlayerProps>(function RoleAudioPlayer(
  { sessionId, messages, enabled, onSpeakingMessageChange }, ref,
) {
  // A mounted player never announces the history that was already present on its first render.
  const spokenRef = useRef<Set<string>>(new Set(messages.map((message) => message.id)));
  const queueRef = useRef<AgentMessage[]>([]);
  const pumpingRef = useRef(false);
  const generationRef = useRef(0);
  const enabledRef = useRef(enabled);
  const sessionIdRef = useRef(sessionId);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const settleRef = useRef<null | (()=>void)>(null);
  const failedRef = useRef<AgentMessage | null>(null);
  const [current,setCurrent]=useState<AgentMessage|null>(null);
  const [playbackError,setPlaybackError]=useState('');

  function stop() {
    generationRef.current += 1; queueRef.current=[];
    audioRef.current?.pause(); settleRef.current?.(); settleRef.current=null;
    failedRef.current=null;setCurrent(null);setPlaybackError('');onSpeakingMessageChange?.(null);
  }
  useImperativeHandle(ref,()=>({stop,replay:(id:string)=>{
    const target=messages.find(m=>m.id===id);
    if(!target||!isSpeakable(target)||!enabled)return;
    queueRef.current.unshift(target);void pump();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }}),[enabled,messages]);

  function playOnce(url:string):Promise<void> {
    return new Promise((resolve,reject)=>{
      const audio=audioRef.current;
      if(!audio){reject(new Error('AUDIO_ELEMENT_UNAVAILABLE'));return;}
      const cleanup=()=>{audio.onended=null;audio.onerror=null;audio.onplaying=null;settleRef.current=null;};
      settleRef.current=()=>{cleanup();resolve();};
      audio.onended=()=>{cleanup();resolve();};
      audio.onerror=()=>{cleanup();reject(new Error('AUDIO_RESOURCE_UNAVAILABLE'));};
      audio.onplaying=()=>setPlaybackError('');
      audio.src=url;
      void audio.play().catch(()=>{
        cleanup();
        reject(new Error('AUTOPLAY_BLOCKED'));
      });
    });
  }
  async function pump() {
    if(pumpingRef.current)return;
    pumpingRef.current=true;const generation=generationRef.current;
    try {
      while(queueRef.current.length&&generationRef.current===generation&&enabledRef.current){
        const target=queueRef.current.shift();if(!target||!isSpeakable(target))continue;
        try {
          setCurrent(target);setPlaybackError('');failedRef.current=null;
          const {audioUrl}=await requestMessageAudio(sessionIdRef.current,target.id);
          if(generationRef.current!==generation)break;
          onSpeakingMessageChange?.(target.id);await playOnce(audioUrl);
        } catch (cause) {
          if(generationRef.current===generation){
            failedRef.current=target;
            setPlaybackError(cause instanceof Error&&cause.message==='AUTOPLAY_BLOCKED'
              ?'浏览器未自动播放，请点击重试播报。':'角色播报失败，请重试；文字内容已保留。');
          }
          break;
        } finally {setCurrent(null);onSpeakingMessageChange?.(null);}
      }
    } finally {
      pumpingRef.current=false;
      if(queueRef.current.length&&enabledRef.current&&!failedRef.current)void pump();
    }
  }
  // Reset before enqueuing the first messages, rather than cancelling that first playback afterwards.
  useEffect(()=>{sessionIdRef.current=sessionId;spokenRef.current=new Set(messages.map((message)=>message.id));stop();return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sessionId]);
  useEffect(()=>{enabledRef.current=enabled;if(!enabled)stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[enabled]);
  useEffect(()=>{
    // Disabled time is a hard boundary: existing and newly arrived history is marked as seen,
    // so enabling never backfills audio. Only messages arriving after enabling enter the queue.
    if(!enabled){for(const m of messages)spokenRef.current.add(m.id);return;}
    const pending=messages.filter(m=>!spokenRef.current.has(m.id)&&isSpeakable(m));
    for(const m of pending)spokenRef.current.add(m.id);
    queueRef.current.push(...pending);if(pending.length)void pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[messages,enabled]);
  return <div className="role-audio-player" style={{display:!enabled||(!current&&!playbackError)?'none':undefined,flexWrap:'wrap'}} role="status" aria-live="polite">
    <Volume2 size={15} aria-hidden="true"/><span className="role-audio-label">{playbackError||(current?`${actorLabel(current.actor)}正在说明…`:'角色语音播报')}</span>
    <audio ref={audioRef} controls={Boolean(playbackError)} aria-label="角色语音播放器" preload="none" style={{maxWidth:280,width:'100%'}}/>
    {playbackError&&<button className="btn btn-secondary" type="button" onClick={()=>{
      if(failedRef.current){const target=failedRef.current;failedRef.current=null;queueRef.current.unshift(target);void pump();}
      else void audioRef.current?.play().catch(()=>setPlaybackError('请使用播放器的播放按钮重试。'));
    }}>重试播报</button>}
    <button className="btn btn-secondary" type="button" onClick={stop}><Square size={13}/>停止播报</button>
  </div>;
});
