'use client';
import Image from 'next/image';
import type { ExamLocation,ExamPosition } from '@/domain/agent';
import { useState } from 'react';
import { ArrowLeft, Check, Hand, RotateCcw } from 'lucide-react';
import { ANATOMY_REGIONS, EXAM_INSTRUMENTS, anatomyLabel, instrumentsForSite, type AnatomyRegion, type ExamAspect } from '@/domain/exam-anatomy';
import { ExamObservationCard, type ExamObservation } from './exam-region-panel';

export function RegionDiagram({region,aspect,selected,selectedSide='both',onSelect,busy}:{region:AnatomyRegion;aspect:ExamAspect;selected:string|null;selectedSide?:ExamLocation['side'];onSelect:(id:string,side?:ExamLocation['side'])=>void;busy:boolean}){
  const sites=region.sites.filter(s=>!s.aspect||s.aspect===aspect).flatMap(s=>s.paired?[{...s,markerSide:aspect==='front'?'right':'left'},{...s,x:100-s.x,markerSide:aspect==='front'?'left':'right'}]:[{...s,markerSide:''}]);
  return <div className="clinical-local-map">
    <svg viewBox="0 0 100 100" role="img" aria-label={`${region.label}${aspect==='front'?'前面':'后面'}局部定位示意`}>
      <defs><linearGradient id={`skin-${region.id}`} x2="0" y2="1"><stop stopColor="#f5dfca"/><stop offset="1" stopColor="#dfbfa6"/></linearGradient></defs>
      <g fill={`url(#skin-${region.id})`} stroke="#b38c73" strokeWidth=".6">
        {region.outline==='head'?<><ellipse cx="50" cy="39" rx="28" ry="33"/><path d="M38 66V78L25 88Q50 98 75 88L62 78V66"/><ellipse cx="21" cy="42" rx="4" ry="9"/><ellipse cx="79" cy="42" rx="4" ry="9"/><path d="M35 37h9m12 0h9m-15 7v7m-8 8q8 4 16 0" fill="none"/></>:
        region.outline==='arm'?<path d="M40 8Q48 4 59 14L62 38 58 64 64 75 71 90Q68 95 64 89L58 81 60 94Q56 98 53 88L50 78 49 95Q45 98 44 88L43 78 40 92Q35 94 37 84L40 67 36 42Z"/>:
        region.outline==='leg'?<path d="M35 7Q51 3 65 10L61 36 58 53 58 76 72 86Q81 93 67 95L44 92Q39 89 43 79L41 58 35 38Z"/>:
        region.outline==='general'?<><circle cx="50" cy="15" r="10"/><path d="M40 28L26 36 19 60 26 63 36 44 37 63 32 91 43 94 50 70 57 94 68 91 63 63 64 44 74 63 81 60 74 36 60 28Z"/></>:
        <><path d="M35 4L35 12 15 22 20 40 26 37 28 72 35 94 65 94 72 72 74 37 80 40 85 22 65 12V4"/>
          {region.outline==='torso'&&<><path d="M48 24Q35 19 27 36V62Q37 67 47 60ZM52 24Q65 19 73 36V62Q63 67 53 60Z" fill="#e2b5ac" opacity=".6"/><path d="M50 19v46m-19 8q19 6 38 0" fill="none"/></>}
          {region.outline==='abdomen'&&<><path d="M29 48h42M50 23v53" strokeDasharray="2 2" fill="none"/><circle cx="50" cy="49" r="1.7" fill="#b38c73"/></>}
          {region.outline==='back'&&<path d="M50 15v64m-5-58h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10" fill="none"/>}</>}
      </g>
    </svg>
    <span className="clinical-side clinical-side-left">患者{aspect==='front'?'右':'左'}侧</span><span className="clinical-side clinical-side-right">患者{aspect==='front'?'左':'右'}侧</span>
    {sites.map(s=><button type="button" key={s.id+(s.markerSide??'')} className="clinical-hotspot" style={{left:`${s.x}%`,top:`${s.y}%`}} disabled={busy} aria-label={(s.markerSide==='left'?'患者左侧':s.markerSide==='right'?'患者右侧':'')+anatomyLabel(s.id)} title={anatomyLabel(s.id)} data-selected={selected===s.id&&(selectedSide==='both'||!s.markerSide||selectedSide===s.markerSide)} onClick={()=>onSelect(s.id,s.markerSide?s.markerSide as ExamLocation['side']:undefined)}><span/></button>)}
    <small className="clinical-map-caption">局部医学示意 · 点击定位点或下方部位名称</small>
  </div>;
}

export function ClinicalExam({image,alt,posture,position,busy,hygieneCompleted,observation,onExamine,onCloseObservation,onReplayAudio}:{image:string|null;alt:string;posture:'standing'|'supine';position?:ExamPosition;busy:boolean;hygieneCompleted:boolean;observation:ExamObservation|null;onExamine:(part:string,tool:string,location?:ExamLocation)=>void;onCloseObservation:()=>void;onReplayAudio:()=>void}){
  const [regionId,setRegionId]=useState<string|null>(null);
  const [part,setPart]=useState<string|null>(null);
  const [tool,setTool]=useState<string|null>(null);
  const [side,setSide]=useState<ExamLocation['side']>('both');
  const [aspect,setAspect]=useState<ExamAspect>('front');
  const region=ANATOMY_REGIONS.find(r=>r.id===regionId);
  function selectPart(id:string,sideOverride?:ExamLocation['side']){setPart(id);setTool(null);setSide(sideOverride??(id.startsWith('left-')?'left':id.startsWith('right-')?'right':/scalp|forehead|fontanelle|nose|mouth|neck|thyroid|spine|umbilicus|external-genitalia|general-state|growth/.test(id)?'midline':'both'));onCloseObservation();}
  function selectRegion(id:string){setRegionId(id);setPart(null);setTool(null);setAspect(id==='rg-back'?'back':'front');onCloseObservation();}
  const methods=part?EXAM_INSTRUMENTS.filter(t=>instrumentsForSite(part).includes(t.id)):[];
  return <div className="clinical-exam" data-posture={posture}>
    <div className="clinical-exam-top"><div><small>体格检查</small><strong>{region?`${region.label}${part?' / '+anatomyLabel(part):''}`:'从大部位开始定位'}</strong></div><button type="button" disabled={busy} data-done={hygieneCompleted} onClick={()=>onExamine('hands','hand-hygiene')}><Hand size={16}/>{hygieneCompleted?'准备已完成':'手卫生与检查说明'}{hygieneCompleted&&<Check size={15}/>}</button></div>
    {!region?<div className="clinical-overview"><div className="clinical-overview-image">{image?<Image src={image} alt={alt} fill sizes="(max-width:767px) 65vw, 320px" priority/>:<div className="clinical-neutral-person"><svg viewBox="0 0 100 180" width="100" height="180" role="img" aria-label="中性人物示意"><circle cx="50" cy="22" r="17" fill="#c2cfc2"/><path d="M34 47Q50 41 66 47L85 92 75 98 61 68 63 110 73 163 58 168 50 125 42 168 27 163 37 110 39 68 25 98 15 92Z" fill="#c2cfc2"/></svg><p>{alt}</p></div>}</div><nav className="clinical-region-list" aria-label="选择查体大部位">{ANATOMY_REGIONS.map((r,i)=><button type="button" key={r.id} disabled={busy} onClick={()=>selectRegion(r.id)}><span>{String(i+1).padStart(2,'0')}</span><strong>{r.label}</strong><small>{r.sites.length}处定位</small></button>)}</nav></div>:
      <><div className="clinical-location-head"><button type="button" onClick={()=>{setRegionId(null);setPart(null);setTool(null);}}><ArrowLeft size={16}/>全部位</button><span>当前体位：{{standing:'站立',supine:'仰卧',sitting:'坐位',lateral:'侧卧',prone:'俯卧'}[position??posture]}</span>{region.sites.some(s=>s.aspect)&&<button type="button" onClick={()=>{setAspect(aspect==='front'?'back':'front');setPart(null);setTool(null);}}><RotateCcw size={15}/>{aspect==='front'?'查看后面':'查看前面'}</button>}</div>
      <RegionDiagram region={region} aspect={aspect} selected={part} selectedSide={side} onSelect={selectPart} busy={busy}/>
      <div className="clinical-site-list" aria-label="具体检查部位">{region.sites.filter(s=>!s.aspect||s.aspect===aspect).map(s=><button type="button" key={s.id} disabled={busy} aria-pressed={part===s.id} onClick={()=>selectPart(s.id)}>{anatomyLabel(s.id)}</button>)}</div>
      <div className="clinical-methods">{part&&<label className="clinical-location-select">检查侧别 <select value={side} disabled={busy||part.startsWith('left-')||part.startsWith('right-')} onChange={e=>setSide(e.target.value as ExamLocation['side'])}><option value="both">双侧比较 / 整体</option><option value="left">患者左侧</option><option value="right">患者右侧</option><option value="midline">正中</option></select><small>切换示意方向不会代替实际调整体位</small></label>}<h3>{part?`在${anatomyLabel(part)}选择方法或器材`:'先选择具体检查位置'}</h3><div className="clinical-instruments">{methods.map(t=><button type="button" key={t.id} disabled={busy} aria-pressed={tool===t.id} onClick={()=>setTool(t.id)}>{t.image?<Image src={t.image} alt="" width={64} height={64}/>:<span className="clinical-method-symbol">{t.id==='inspection'?'视':t.id==='palpation'?'触':'叩'}</span>}<span>{t.label}</span></button>)}</div>{part&&tool&&<button type="button" className="clinical-execute" disabled={busy} onClick={()=>onExamine(part,tool,{side,aspect})}>{busy?'正在检查…':`执行${EXAM_INSTRUMENTS.find(t=>t.id===tool)?.label} · ${anatomyLabel(part)}`}</button>}</div></>}
    {observation&&<ExamObservationCard observation={observation} onClose={onCloseObservation} onReplayAudio={onReplayAudio}/>}
  </div>;
}
