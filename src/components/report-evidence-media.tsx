'use client';

import {useEffect,useState} from 'react';
import type {ClinicalEvent,SessionState} from '@/domain/agent';
import {authedFetch} from '@/lib/authed-api';
import {CaseMediaGallery} from '@/components/case-media-gallery';

export function ReportEvidenceMedia({sessionId,version,eventIds}:{sessionId:string;version:string;eventIds:string[]}) {
  const [events,setEvents]=useState<ClinicalEvent[]|null>(null);
  const [error,setError]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const eventKey=JSON.stringify(eventIds);
  useEffect(()=>{
    let cancelled=false;
    authedFetch<SessionState>(`/api/sessions/${encodeURIComponent(sessionId)}`).then(session=>{
      if(cancelled)return;
      if(session.id!==sessionId||session.sourceSnapshotVersion!==version)throw new Error('REPORT_EVIDENCE_VERSION_MISMATCH');
      const linked=new Set<string>(JSON.parse(eventKey));
      setEvents(session.events.filter(event=>linked.has(event.id)&&event.media?.length));
    }).catch(()=>{if(!cancelled)setError(true);});
    return()=>{cancelled=true;};
  },[sessionId,version,eventKey,attempt]);
  if(error)return <div><p role="note">关联图片暂时无法读取，或与报告材料版本不一致。</p><button type="button" onClick={()=>{setError(false);setEvents(null);setAttempt(value=>value+1);}}>重试读取关联图片</button></div>;
  if(events===null)return <p aria-live="polite">正在读取评分关联图片…</p>;
  if(!events.length)return <p>当前评分关联记录没有已释放图片。</p>;
  return <div>{events.map(event=><section key={event.id}><p>{event.summary}</p><CaseMediaGallery sessionId={sessionId} media={event.media!}/></section>)}</div>;
}
