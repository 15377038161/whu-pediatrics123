'use client';

import {useEffect,useState} from 'react';
import type {ClinicalEvent,SessionState} from '@/domain/agent';
import {authedFetch} from '@/lib/authed-api';
import {CaseMediaGallery} from '@/components/case-media-gallery';

export function ReportEvidenceMedia({sessionId,version,eventIds}:{sessionId:string;version:string;eventIds:string[]}) {
  const [result,setResult]=useState<{key:string;events:ClinicalEvent[];error:boolean}|null>(null);
  const [attempt,setAttempt]=useState(0);
  const eventKey=JSON.stringify(eventIds);
  const requestKey=JSON.stringify([sessionId,version,eventKey]);
  useEffect(()=>{
    let cancelled=false;
    authedFetch<SessionState>(`/api/sessions/${encodeURIComponent(sessionId)}`).then(session=>{
      if(cancelled)return;
      if(session.id!==sessionId||session.sourceSnapshotVersion!==version)throw new Error('REPORT_EVIDENCE_VERSION_MISMATCH');
      const linked=new Set<string>(JSON.parse(eventKey));
      setResult({key:requestKey,events:session.events.filter(event=>linked.has(event.id)&&event.media?.length),error:false});
    }).catch(()=>{if(!cancelled)setResult({key:requestKey,events:[],error:true});});
    return()=>{cancelled=true;};
  },[sessionId,version,eventKey,requestKey,attempt]);
  const current=result?.key===requestKey?result:null;
  if(current?.error)return <div><p role="note">关联图片暂时无法读取，或与报告材料版本不一致。</p><button type="button" onClick={()=>{setResult(null);setAttempt(value=>value+1);}}>重试读取关联图片</button></div>;
  if(!current)return <p aria-live="polite">正在读取本轮已获得的图片…</p>;
  const events=current.events;
  if(!events.length)return <p>本轮关联记录没有已释放图片。</p>;
  return <div>{events.map(event=><section key={event.id}><p>{event.summary}</p><CaseMediaGallery sessionId={sessionId} media={event.media!}/></section>)}</div>;
}
