'use client';
import Image from 'next/image';
import type { ExamLocation,ExamPosition } from '@/domain/agent';
import { useEffect, useRef, useState } from 'react';
import { Check, Hand, MapPin, RotateCcw, Stethoscope, UserRound } from 'lucide-react';
import { ANATOMY_REGIONS, EXAM_INSTRUMENTS, anatomyLabel, type AnatomyRegion, type ExamAspect } from '@/domain/exam-anatomy';
import { ExamObservationCard, type ExamObservation } from './exam-region-panel';
import { photoExamMap, type PhotoCrop, type PhotoTarget } from '@/domain/exam-photo-map';

function PhotoSurface({image,alt,targets,crop,selected,onSelect,busy,toolImage,overview=false}:{image:string;alt:string;targets:PhotoTarget[];crop?:PhotoCrop;selected:string|null;onSelect:(id:string,side?:ExamLocation['side'])=>void;busy:boolean;toolImage?:string;overview?:boolean}){
  const [ratio,setRatio]=useState(832/1216);
  const [pointer,setPointer]=useState<{x:number;y:number}|null>(null);
  const area=crop??{x:0,y:0,width:100,height:100};
  return <div className="ce-photo-surface" data-overview={overview} data-equipped={Boolean(toolImage)} style={{aspectRatio:ratio*area.width/area.height,width:overview?`min(100%, ${ratio*46}dvh)`:'100%',marginInline:'auto'}} onPointerMove={event=>{if(event.pointerType==='mouse'){const rect=event.currentTarget.getBoundingClientRect();setPointer({x:event.clientX-rect.left,y:event.clientY-rect.top});}}} onPointerLeave={()=>setPointer(null)}>
    <Image src={image} alt={alt} width={832} height={1216} sizes={overview?'(max-width:767px) 85vw, 360px':'800px'} priority={overview} onLoad={event=>{const img=event.currentTarget;if(img.naturalHeight)setRatio(img.naturalWidth/img.naturalHeight);}} style={{position:'absolute',maxWidth:'none',width:`${10000/area.width}%`,height:`${10000/area.height}%`,left:`${-area.x/area.width*100}%`,top:`${-area.y/area.height*100}%`}}/>
    {!overview&&<svg className="ce-target-guides" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{targets.map((target,index)=><line key={target.id} x1={target.x} y1={target.y} x2={index%2===0?20:80} y2={(Math.floor(index/2)+1)/(Math.ceil(targets.length/2)+1)*100}/>)}</svg>}
    {targets.map(target=><button type="button" key={target.id} className="ce-photo-target" data-side={target.x<45?'left':'right'} aria-label={`${overview?'定位':'部位定位点：'}${target.label}`} title={target.label} aria-pressed={selected===target.id} disabled={busy} style={{left:`${target.x}%`,top:`${target.y}%`}} onClick={()=>onSelect(target.id,target.side)}><span className="ce-target-dot"/>{overview&&<span className="ce-target-name">{target.label}</span>}</button>)}
    {!overview&&targets.map((target,index)=><button type="button" key={'label-'+target.id} className="ce-photo-label" aria-label={`检查${target.label}`} aria-pressed={selected===target.id} disabled={busy} style={{[index%2===0?'left':'right']:0,top:`${(Math.floor(index/2)+1)/(Math.ceil(targets.length/2)+1)*100}%`}} onClick={()=>onSelect(target.id,target.side)}>{target.label}</button>)}
    {toolImage&&pointer&&<span className="ce-held-tool" style={{left:pointer.x+12,top:pointer.y+12}} aria-hidden="true"><Image src={toolImage} alt="" width={44} height={44}/></span>}
  </div>;
}

const detailGroups:Record<string,Array<{label:string;ids:string[]}>>={
  'rg-head-neck':[{label:'额面部',ids:['forehead','eyes','ears','nose','mouth']},{label:'头颅与前囟',ids:['scalp','fontanelle']},{label:'颈部',ids:['neck','thyroid','cervical-nodes']}],
  'rg-chest':[{label:'肺野',ids:['right-lung-upper','left-lung-upper','right-lung-lower','left-lung-lower','chest-lung']},{label:'心前区',ids:['aortic-area','pulmonic-area','erb-area','tricuspid-area','mitral-area']},{label:'胸壁与腋窝',ids:['chest','axilla','breast']}],
  'rg-lower-limb':[{label:'关节与活动',ids:['hip','knee','ankle','foot','lower-limb-power']},{label:'水肿与末梢',ids:['lower-limb-edema','foot','ankle']},{label:'足底面',ids:['plantar']}],
};

export function RegionDiagram({region,aspect,selected,selectedSide='both',onSelect,busy}:{region:AnatomyRegion;aspect:ExamAspect;selected:string|null;selectedSide?:ExamLocation['side'];onSelect:(id:string,side?:ExamLocation['side'])=>void;busy:boolean}){
  const sites=region.sites.filter(s=>!s.aspect||s.aspect===aspect).flatMap(s=>s.paired?[{...s,markerSide:aspect==='front'?'right':'left'},{...s,x:100-s.x,markerSide:aspect==='front'?'left':'right'}]:[{...s,markerSide:''}]);
  return <div className="clinical-local-map">
    <svg viewBox="0 0 100 100" role="img" aria-label={`${region.label}${region.outline==='sole'?'足底面':aspect==='front'?'前面':'后面'}局部定位示意`}>
      <defs><linearGradient id={`skin-${region.id}`} x2="0" y2="1"><stop stopColor="#f5dfca"/><stop offset="1" stopColor="#dfbfa6"/></linearGradient></defs>
      <g fill={`url(#skin-${region.id})`} stroke="#b38c73" strokeWidth=".6">
        {region.outline==='head'?<><ellipse cx="50" cy="39" rx="28" ry="33"/><path d="M38 66V78L25 88Q50 98 75 88L62 78V66"/><ellipse cx="21" cy="42" rx="4" ry="9"/><ellipse cx="79" cy="42" rx="4" ry="9"/><path d="M35 37h9m12 0h9m-15 7v7m-8 8q8 4 16 0" fill="none"/></>:
        region.outline==='arm'?<path d="M40 8Q48 4 59 14L62 38 58 64 64 75 71 90Q68 95 64 89L58 81 60 94Q56 98 53 88L50 78 49 95Q45 98 44 88L43 78 40 92Q35 94 37 84L40 67 36 42Z"/>:
        region.outline==='leg'?<path d="M35 7Q51 3 65 10L61 36 58 53 58 76 72 86Q81 93 67 95L44 92Q39 89 43 79L41 58 35 38Z"/>:
        region.outline==='sole'?<><path d="M44 93Q31 91 35 76Q40 61 32 45Q26 34 28 23Q23 9 34 6Q44 6 43 21Q46 10 52 14Q58 15 56 26Q61 17 67 22Q72 24 67 32Q74 25 78 31Q81 35 73 40Q79 36 81 42Q82 48 72 52Q69 64 65 76Q61 96 44 93Z"/><path d="M64 82Q73 58 69 44Q63 32 48 27" fill="none" stroke="#6b957e" strokeDasharray="2 2"/></>:
        region.outline==='general'?<><circle cx="50" cy="15" r="10"/><path d="M40 28L26 36 19 60 26 63 36 44 37 63 32 91 43 94 50 70 57 94 68 91 63 63 64 44 74 63 81 60 74 36 60 28Z"/></>:
        <><path d="M35 4L35 12 15 22 20 40 26 37 28 72 35 94 65 94 72 72 74 37 80 40 85 22 65 12V4"/>
          {region.outline==='torso'&&<><path d="M48 24Q35 19 27 36V62Q37 67 47 60ZM52 24Q65 19 73 36V62Q63 67 53 60Z" fill="#e2b5ac" opacity=".6"/><path d="M50 19v46m-19 8q19 6 38 0" fill="none"/></>}
          {region.outline==='abdomen'&&<><path d="M29 48h42M50 23v53" strokeDasharray="2 2" fill="none"/><circle cx="50" cy="49" r="1.7" fill="#b38c73"/></>}
          {region.outline==='back'&&<path d="M50 15v64m-5-58h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10" fill="none"/>}</>}
      </g>
    </svg>
    {region.outline==='sole'?<span className="clinical-side clinical-side-left">足底面 · 局部示意</span>:<><span className="clinical-side clinical-side-left">患者{aspect==='front'?'右':'左'}侧</span><span className="clinical-side clinical-side-right">患者{aspect==='front'?'左':'右'}侧</span></>}
    {sites.map(s=><button type="button" key={s.id+(s.markerSide??'')} className="clinical-hotspot" style={{left:`${s.x}%`,top:`${s.y}%`}} disabled={busy} aria-label={(s.markerSide==='left'?'患者左侧':s.markerSide==='right'?'患者右侧':'')+anatomyLabel(s.id)} title={anatomyLabel(s.id)} data-selected={selected===s.id&&(selectedSide==='both'||!s.markerSide||selectedSide===s.markerSide)} onClick={()=>onSelect(s.id,s.markerSide?s.markerSide as ExamLocation['side']:undefined)}><span/></button>)}
    <small className="clinical-map-caption">局部医学示意 · 点击定位点或下方部位名称</small>
  </div>;
}

const positionLabels: Record<ExamPosition,string> = {standing:'站立',supine:'仰卧',sitting:'坐位',lateral:'侧卧',prone:'俯卧'};
const instruments = EXAM_INSTRUMENTS.filter(item => item.id !== 'hand-hygiene');

export function ClinicalExam({image,alt,assetKey,posture,position,positions,onPositionChange,busy,hygieneCompleted,observation,onExamine,onCloseObservation,onReplayAudio,showReference=true}: {
  image:string|null; alt:string; assetKey?:string; posture:'standing'|'supine'; position:ExamPosition;
  positions:ExamPosition[]; onPositionChange:(position:ExamPosition)=>void;
  busy:boolean; hygieneCompleted:boolean; observation:ExamObservation|null;
  onExamine:(part:string,tool:string,location?:ExamLocation)=>void;
  onCloseObservation:()=>void; onReplayAudio:()=>void;
  showReference?:boolean;
}) {
  const [regionId,setRegionId] = useState('rg-head-neck');
  const [part,setPart] = useState<string|null>(null);
  const [tool,setTool] = useState<string|null>(null);
  const [side,setSide] = useState<ExamLocation['side']>('both');
  const [aspect,setAspect] = useState<ExamAspect>('front');
  const [detailGroup,setDetailGroup] = useState(0);
  const resultRef=useRef<HTMLDivElement>(null);
  const region = ANATOMY_REGIONS.find(item => item.id === regionId)!;
  const selectedInstrument = instruments.find(item => item.id === tool);
  const map=assetKey?photoExamMap(assetKey,posture,regionId,detailGroup):null;
  const groups=detailGroups[regionId];
  const visibleTargets=(map?.sites.filter(site=>!groups||groups[detailGroup]?.ids.includes(site.id))??[]).sort((a,b)=>a.y-b.y||a.x-b.x);
  const scalpView=regionId==='rg-head-neck'&&detailGroup===1;
  const soleView=regionId==='rg-lower-limb'&&detailGroup===2;
  const diagramRegion:AnatomyRegion=soleView?{...region,outline:'sole',sites:[{id:'plantar',x:67,y:59}]}:scalpView?{...region,sites:region.sites.filter(site=>groups?.[detailGroup].ids.includes(site.id))}:region;
  useEffect(()=>{if(observation&&observation.toolId!=='hand-hygiene')resultRef.current?.scrollIntoView({block:'nearest'});},[observation]);
  // Findings are bound to a completed action, never carried over to another selection.
  const currentObservation = observation && (observation.toolId === 'hand-hygiene' || (observation.bodyPartId === part && observation.toolId === tool)) ? observation : null;
  function selectPart(id:string,sideOverride?:ExamLocation['side'],perform=false) {
    setPart(id);
    setSide(sideOverride ?? (id.startsWith('left-') ? 'left' : id.startsWith('right-') ? 'right' : /^(scalp|forehead|fontanelle|nose|mouth|neck|thyroid|spine|umbilicus|external-genitalia|general-state|growth)$/.test(id) ? 'midline' : 'both'));
    onCloseObservation();
    if(perform&&tool)onExamine(id,tool,{side:sideOverride??(id.startsWith('left-')?'left':id.startsWith('right-')?'right':/^(scalp|forehead|fontanelle|nose|mouth|neck|thyroid|spine|umbilicus|external-genitalia|general-state|growth)$/.test(id)?'midline':'both'),aspect});
  }
  function selectRegion(id:string) {
    setRegionId(id); setPart(null); setDetailGroup(0); setAspect(id === 'rg-back' ? 'back' : 'front'); onCloseObservation();
    // Deliberately keep the selected instrument: students choose the pairing themselves.
  }
  return <div className="clinical-exam" data-posture={posture}>
    <header className="ce-toolbar">
      <div className="ce-intro"><Stethoscope size={19}/><div><strong>拿起器材，开始查体</strong><span>{selectedInstrument?`已拿起${selectedInstrument.label} · 在人物和局部图上点选检查部位`:'先选择器材，再点击人物上的部位'}</span></div></div>
      <button className="ce-preparation" type="button" disabled={busy || hygieneCompleted} data-done={hygieneCompleted} onClick={()=>onExamine('hands','hand-hygiene')}>
        {hygieneCompleted ? <Check size={16}/> : <Hand size={16}/>} {hygieneCompleted ? '手卫生与说明已完成' : '手卫生与检查说明'}
      </button>
    </header>
    <div className="ce-layout">
      <section className="ce-tools" aria-label="检查器材">
        <div className="ce-section-title"><span>01</span><h3>选择器材 / 方法</h3></div>
        <p className="ce-muted">器材可自由选择，也可先选部位</p>
        <div className="ce-tool-grid">{instruments.map(item => <button key={item.id} type="button" aria-label={item.label} aria-pressed={tool === item.id} disabled={busy} onClick={()=>{setTool(item.id);onCloseObservation();}}>
          <Image src={item.image} alt={item.label} width={72} height={64} sizes="80px"/><span>{item.label}</span>{tool === item.id && <Check size={13} className="ce-tool-check"/>}
        </button>)}</div>
      </section>
      <section className="ce-patient" aria-label="患儿与大部位">
        <div className="ce-section-title"><span>02</span><h3>点击人物定位</h3></div>
        <div className="ce-patient-image">
          {image ? <PhotoSurface key={image} image={image} alt={alt} targets={map?.regions??[]} selected={regionId} onSelect={selectRegion} busy={busy} toolImage={selectedInstrument?.image} overview/> : <div className="ce-no-image"><UserRound size={64}/><p>{alt}</p></div>}
          <span className="ce-illustration-label">虚拟示教人物{position !== posture ? ` · ${positionLabels[posture]}参考图` : ""}</span>
        </div>
        <div className="ce-position"><span>当前体位</span><div role="group" aria-label="查体姿势">{positions.map(value => <button type="button" key={value} disabled={busy} aria-pressed={position === value} onClick={()=>{onPositionChange(value);onCloseObservation();}}>{positionLabels[value]}</button>)}</div></div>
        <div className="ce-extra-regions"><button type="button" disabled={busy} onClick={()=>selectRegion('rg-back')}>背腰部定位</button><button type="button" disabled={busy} onClick={()=>selectRegion('rg-general')}>全身观察与测量</button></div>
        <details className="ce-region-fallback"><summary>用文字选择大部位</summary><nav className="ce-regions" aria-label="选择查体大部位">{ANATOMY_REGIONS.map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={regionId === item.id} onClick={()=>selectRegion(item.id)}>{item.label}</button>)}</nav></details>
        <p className="ce-image-note">人物图片用于场景展示，具体体征以检查结果为准。</p>
      </section>
      <section className="ce-operation" aria-label="部位定位与检查结果">
        <div className="ce-location-heading"><div><MapPin size={17}/><h3>{region.label}</h3></div>{region.sites.some(site=>site.aspect) && <button type="button" disabled={busy} onClick={()=>{setAspect(aspect === 'front' ? 'back' : 'front');setPart(null);onCloseObservation();}}><RotateCcw size={14}/>{aspect === 'front' ? '查看后面' : '查看前面'}</button>}</div>
        <p className="ce-muted">{aspect === 'front' ? '前面' : '后面'} · 左右均按患儿自身方向标记</p>
        {groups&&aspect==='front'&&<div className="ce-detail-groups" role="group" aria-label="局部定位范围">{groups.map((group,index)=><button type="button" key={group.label} aria-pressed={detailGroup===index} disabled={busy} onClick={()=>{setDetailGroup(index);setPart(null);onCloseObservation();}}>{group.label}</button>)}</div>}
        {image&&map?.crop&&aspect==='front'&&!scalpView&&!soleView?<div className="ce-zoom-map"><PhotoSurface key={image+regionId} image={image} alt={`${region.label}局部放大定位，虚拟示教人物`} crop={map.crop} targets={visibleTargets} selected={part} onSelect={(id,markerSide)=>selectPart(id,markerSide,true)} busy={busy} toolImage={selectedInstrument?.image}/></div>:<RegionDiagram region={diagramRegion} aspect={aspect} selected={part} selectedSide={side} onSelect={(id,markerSide)=>selectPart(id,markerSide,true)} busy={busy}/>}
        {(scalpView||soleView)&&<p className="ce-touch-hint">{soleView?'足底采用局部医学示意；检查前协助患儿取适当体位并放松足部。':'头颅与前囟采用医学示意；不从正面照片推断囟门大小或开闭。'}</p>}
        <p className="ce-touch-hint">{tool?'点击局部定位点，即用手中器材检查':'先从器材栏拿起器材，再点局部定位点进行检查'}</p>
        <details className="ce-map-detail" key={regionId+aspect}><summary>用文字选择具体部位</summary><div className="ce-sites" role="group" aria-label="具体检查部位">{region.sites.filter(site=>!site.aspect || site.aspect === aspect).map(site => <button type="button" key={site.id} disabled={busy} aria-pressed={part === site.id} onClick={()=>selectPart(site.id,undefined,true)}>{anatomyLabel(site.id)}</button>)}</div></details>
        {part && <fieldset className="ce-side"><legend>检查侧别</legend>{(['both','left','right','midline'] as const).filter(value=>part.startsWith('left-') ? value === 'left' : part.startsWith('right-') ? value === 'right' : true).map(value => <button type="button" key={value} disabled={busy} aria-pressed={side === value} onClick={()=>{setSide(value);onCloseObservation();}}>{{both:'双侧 / 整体',left:'患儿左侧',right:'患儿右侧',midline:'正中'}[value]}</button>)}</fieldset>}
        <div className="ce-action">
          <div className="ce-selection"><span>{selectedInstrument?.label ?? '尚未选择器材'}</span><span>＋</span><strong>{part ? anatomyLabel(part) : '尚未选择具体部位'}</strong></div>
          <button className="ce-execute" type="button" disabled={busy || !part || !tool} onClick={()=>{if(part && tool)onExamine(part,tool,{side,aspect});}}>{busy ? '正在检查…' : '开始检查'}</button>
        </div>
        <div ref={resultRef} className="ce-result" aria-label="本次查体反馈" aria-live="polite">
          {currentObservation ? <ExamObservationCard observation={currentObservation} onClose={onCloseObservation} onReplayAudio={onReplayAudio} showReference={showReference}/> : <div className="ce-result-empty"><Stethoscope size={26}/><strong>检查所见将在这里显示</strong><p>拿起器材，点击局部图上的部位进行检查。患儿反应与所见会同步到病例记录，供你判断和书写病历。</p></div>}
        </div>
      </section>
    </div>
  </div>;
}
