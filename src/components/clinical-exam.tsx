'use client';
import Image from 'next/image';
import {useState,useEffect,useRef} from 'react';
import {Check,Hand,Stethoscope,ArrowLeft,ZoomIn,RotateCcw,X} from 'lucide-react';
import type {ExamLocation,ExamPosition} from '@/domain/agent';
import type {RecordedExamAction} from '@/domain/exam-action-identity';
import {GROWTH_TOOLS} from '@/domain/growth-exam';
import {ANATOMY_REGIONS,EXAM_INSTRUMENTS,anatomyLabel,type ExamAspect} from '@/domain/exam-anatomy';
import {examCanvasMap,EXAM_SOLES_TEMPLATE,requiredExamPosition} from '@/domain/exam-canvas';
import type {PhotoTarget,PhotoCrop} from '@/domain/exam-photo-map';
import {ExamObservationCard,type ExamObservation} from './exam-region-panel';

const positionLabels:Record<ExamPosition,string>={standing:'站立',supine:'仰卧',sitting:'坐位',lateral:'侧卧',prone:'俯卧'};
const instruments=EXAM_INSTRUMENTS.filter(item=>item.id!=='hand-hygiene');
const thermometers=['axillary-thermometer','infrared-thermometer','tympanic-thermometer'];
const detailGroups:Record<string,Array<{label:string;ids:string[]}>>={
  'rg-head-neck':[{label:'额面部',ids:['forehead','eyes','ears','nose','mouth']},{label:'头颅与前囟',ids:['scalp','fontanelle']},{label:'颈部',ids:['neck','thyroid','cervical-nodes']}],
  'rg-chest':[{label:'肺野',ids:['right-lung-upper','left-lung-upper','right-lung-lower','left-lung-lower','chest-lung']},{label:'心前区',ids:['aortic-area','pulmonic-area','erb-area','tricuspid-area','mitral-area','chest-heart']},{label:'胸壁与腋窝',ids:['chest','axilla','breast']}],
  'rg-lower-limb':[{label:'关节与活动',ids:['hip','knee','ankle','foot','lower-limb-power']},{label:'水肿与末梢',ids:['lower-limb-edema','foot','ankle']},{label:'足底面',ids:['plantar']}],
};
interface ExamRing {
  title:string;sites:Array<{id:string;label:string}>;anchor:{x:number;y:number};
  onClose:()=>void;completed:(id:string)=>boolean;
}
function CanvasImage({src,alt,targets,crop,selected,selectedSide,onSelect,busy,toolImage,overview,ring}:{src:string;alt:string;targets:PhotoTarget[];crop?:PhotoCrop;selected:string|null;selectedSide?:ExamLocation['side'];onSelect:(id:string,side?:ExamLocation['side'])=>void;busy:boolean;toolImage?:string;overview:boolean;ring?:ExamRing}){
  const [ratio,setRatio]=useState(832/1216),[pointer,setPointer]=useState<{x:number;y:number}|null>(null);
  const figureRef=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState({width:240,height:360,stageWidth:500,left:130});
  useEffect(()=>{
    const element=figureRef.current;if(!element)return;
    const measure=()=>{const box=element.getBoundingClientRect(),stage=element.parentElement!.getBoundingClientRect();setSize({width:box.width,height:box.height,stageWidth:stage.width,left:box.left-stage.left});};
    const observer=new ResizeObserver(measure);observer.observe(element);observer.observe(element.parentElement!);measure();return()=>observer.disconnect();
  },[]);
  const area=crop??{x:0,y:0,width:100,height:100};
  const ringWidth=Math.min(360,size.stageWidth-16),ringHeight=Math.min(250,size.height-16);
  const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(value,max));
  const center={x:clamp((ring?.anchor.x??50)/100*size.width,ringWidth/2-size.left+8,size.stageWidth-ringWidth/2-size.left-8),y:clamp((ring?.anchor.y??50)/100*size.height,ringHeight/2+8,size.height-ringHeight/2-8)};
  const ringSites=ring?.sites.map((site,index)=>{const angle=(-90+index*360/ring.sites.length)*Math.PI/180;return {...site,x:center.x+Math.cos(angle)*(ringWidth/2-48),y:center.y+Math.sin(angle)*(ringHeight/2-24)};})??[];
  return <div ref={figureRef} className="ce-figure" data-zoomed={!overview} style={{aspectRatio:ratio*area.width/area.height}} onPointerMove={event=>{if(event.pointerType==='mouse'&&toolImage){const r=event.currentTarget.getBoundingClientRect();setPointer({x:event.clientX-r.left,y:event.clientY-r.top});}}} onPointerLeave={()=>setPointer(null)}>
    <div className="ce-photo-mask"><Image src={src} alt={alt} width={832} height={1216} sizes="(max-width:767px) 95vw, 650px" priority onLoad={event=>{const img=event.currentTarget;if(img.naturalHeight)setRatio(img.naturalWidth/img.naturalHeight);}} style={{position:'absolute',maxWidth:'none',width:`${10000/area.width}%`,height:`${10000/area.height}%`,left:`${-area.x/area.width*100}%`,top:`${-area.y/area.height*100}%`}}/></div>
    {targets.map(target=><button key={target.id+(target.side??'')} type="button" className={overview?'ce-body-region':'ce-body-point'} aria-label={`${overview?'定位':'部位定位点：'}${target.label}`} aria-pressed={selected===target.id&&(!target.side||target.side===selectedSide)} title={target.label} disabled={busy} style={{left:`${target.x}%`,top:`${target.y}%`}} onClick={()=>onSelect(target.id,target.side)}><span className="ce-dot"/>{overview&&<span className="ce-body-label">{target.label}</span>}</button>)}
    {ring&&<div className="ce-part-ring" role="group" aria-label={`${ring.title}周围的小部位`}>
      <svg className="ce-ring-lines" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">{ringSites.map(site=>{const target=targets.find(item=>item.id===site.id);return target?<line key={site.id} x1={target.x/100*size.width} y1={target.y/100*size.height} x2={site.x} y2={site.y}/>:null;})}</svg>
      <button type="button" className="ce-ring-close" aria-label="收起小部位" onClick={ring.onClose} style={{left:center.x,top:center.y}}><span>{ring.title}</span><X size={13}/></button>
      {ringSites.map(site=><button type="button" className="ce-ring-site" key={site.id} aria-label={`检查${site.label}`} aria-pressed={selected===site.id} data-completed={ring.completed(site.id)} disabled={busy} style={{left:site.x,top:site.y}} onClick={()=>onSelect(site.id)}>{site.label}{ring.completed(site.id)&&<Check size={12}/>}</button>)}
    </div>}
    {toolImage&&pointer&&<span className="ce-held-tool" style={{left:pointer.x+14,top:pointer.y+14}} aria-hidden="true"><Image src={toolImage} alt="" width={36} height={36}/></span>}
  </div>;
}

export function ClinicalExam({image,alt,assetKey,posture,position,positions,onPositionChange,busy,hygieneCompleted,observation,onExamine,onCloseObservation,onReplayAudio,showReference=true,completedActions=[],growthMeasurements=false}:{
  image:string|null;alt:string;assetKey?:string;posture:'standing'|'supine';position:ExamPosition;positions:ExamPosition[];onPositionChange:(position:ExamPosition)=>void;busy:boolean;hygieneCompleted:boolean;observation:ExamObservation|null;onExamine:(part:string,tool:string,location?:ExamLocation)=>void;onCloseObservation:()=>void;onReplayAudio:()=>void;showReference?:boolean;completedActions?:RecordedExamAction[];growthMeasurements?:boolean;
}){
  const [regionId,setRegionId]=useState<string|null>(null),[part,setPart]=useState<string|null>(null),[tool,setTool]=useState<string|null>(null),[side,setSide]=useState<ExamLocation['side']>('both'),[aspect,setAspect]=useState<ExamAspect>('front'),[group,setGroup]=useState(0),[zoom,setZoom]=useState(false);
  const region=ANATOMY_REGIONS.find(item=>item.id===regionId),groups=regionId?detailGroups[regionId]:undefined;
  const map=examCanvasMap(assetKey,posture,regionId,aspect,zoom,group);
  const selectedInstrument=instruments.find(item=>item.id===tool);
  const neededPosition=requiredExamPosition(regionId,aspect,position,positions,tool);
  const visibleSites=region?.sites.filter(site=>(!site.aspect||site.aspect===aspect)&&(!groups||aspect==='back'||groups[group]?.ids.includes(site.id)))??[];
  const points=map.sites.filter(site=>visibleSites.some(item=>item.id===site.id));
  const activeObservation=observation&&(observation.toolId==='hand-hygiene'||observation.bodyPartId===part&&observation.toolId===tool)?observation:null;
  const wasChecked=(id:string)=>completedActions.some(item=>item.toolId===tool&&item.bodyPartId===id&&item.position===position&&item.location?.aspect===aspect&&item.location?.side===side);
  function selectRegion(id:string){setRegionId(id);setPart(null);setGroup(0);setZoom(false);setAspect(id==='rg-back'?'back':'front');onCloseObservation();}
  function reset(){setRegionId(null);setPart(null);setGroup(0);setZoom(false);setAspect('front');onCloseObservation();}
  function selectPart(id:string,override?:ExamLocation['side']){
    const selectedSide=override??(id.startsWith('left-')?'left':id.startsWith('right-')?'right':/^(scalp|fontanelle|forehead|nose|mouth|neck|thyroid|spine|umbilicus|external-genitalia|general-state|growth)$/.test(id)?'midline':side);
    if(part===id&&activeObservation&&tool===activeObservation.toolId&&selectedSide===side)return;
    setPart(id);setSide(selectedSide);onCloseObservation();if(tool)onExamine(id,tool,{side:selectedSide,aspect});
  }
  function pickTool(id:string){if(tool===id)return;setTool(id);onCloseObservation();}
  function toolButton(item:(typeof instruments)[number]){return <button type="button" key={item.id} aria-label={item.label} aria-pressed={tool===item.id} disabled={busy} onClick={()=>pickTool(item.id)}><Image src={item.image} alt={item.label} width={88} height={72} sizes="(max-width:767px) 64px, 88px"/><span>{item.label}</span>{tool===item.id&&<Check className="ce-tool-check" size={13}/>}</button>;}
  return <div className="clinical-exam" data-interface="single-canvas" data-posture={posture}>
    <header className="ce-toolbar"><div className="ce-intro"><Stethoscope size={19}/><div><strong>在人物上完成查体</strong><span>{selectedInstrument?`已选${selectedInstrument.label}，点击部位开始检查`:'选择器材，点大部位，再选小部位'}</span></div></div><button className="ce-preparation" type="button" disabled={busy||hygieneCompleted} data-done={hygieneCompleted} onClick={()=>onExamine('hands','hand-hygiene')}>{hygieneCompleted?<Check size={16}/>:<Hand size={16}/>} {hygieneCompleted?'手卫生与说明已完成':'手卫生与检查说明'}</button></header>
    <div className="ce-single-layout">
      <section className="ce-tools" aria-label="检查器材"><h3>检查器材</h3><div className="ce-tool-grid">{instruments.filter(item=>!thermometers.slice(1).includes(item.id)&&!GROWTH_TOOLS.some(id=>id===item.id)).map(toolButton)}</div><details className="ce-temperature-options"><summary>其他测温方式</summary><div className="ce-tool-grid">{instruments.filter(item=>thermometers.slice(1).includes(item.id)).map(toolButton)}</div></details>{growthMeasurements&&<details className="ce-growth-options"><summary>生长测量器材</summary><div className="ce-tool-grid">{instruments.filter(item=>GROWTH_TOOLS.some(id=>id===item.id)).map(toolButton)}</div></details>}</section>
      <section className="ce-canvas" aria-label="单一人物查体画布" data-region={regionId??'overview'} data-has-result={Boolean(activeObservation)}>
        <div className="ce-canvas-controls"><button type="button" disabled={busy||!regionId} onClick={reset}><ArrowLeft size={14}/>全身</button><span>{region?.label??'全身定位'}</span>{region?.sites.some(site=>site.aspect==='front')&&region.sites.some(site=>site.aspect==='back')&&<button type="button" disabled={busy} onClick={()=>{setAspect(aspect==='front'?'back':'front');setZoom(false);setPart(null);onCloseObservation();}}><RotateCcw size={14}/>{aspect==='front'?'查看背面':'查看正面'}</button>}{regionId&&aspect==='front'&&map.crop===undefined&&examCanvasMap(assetKey,posture,regionId,aspect,true,group).crop&&<button type="button" disabled={busy} onClick={()=>{setZoom(true);onCloseObservation();}}><ZoomIn size={14}/>放大定位</button>}{zoom&&<button type="button" disabled={busy} onClick={()=>setZoom(false)}>退出放大</button>}</div>
        {groups&&aspect==='front'&&<div className="ce-detail-groups" role="group" aria-label="局部定位范围">{groups.map((item,i)=><button type="button" key={item.label} aria-pressed={group===i} disabled={busy} onClick={()=>{setGroup(i);setPart(null);setZoom(false);onCloseObservation();}}>{item.label}</button>)}</div>}
        <div className="ce-stage"><div className="ce-orientation" aria-label="患者左右方向"><span>{aspect==='front'?'患者右侧':'患者左侧'}</span><span>{aspect==='front'?'患者左侧':'患者右侧'}</span></div><span className="ce-image-source">{map.image===EXAM_SOLES_TEMPLATE?'通用足底示教模板':aspect==='back'?'通用背部示教模板':'通用虚拟人物'} · 非患者影像{!['standing','supine'].includes(position)?' · 图示未随体位变化':''}</span><CanvasImage src={map.image??image??'/media/clinical/virtual-child-unclassified.svg'} alt={map.image===EXAM_SOLES_TEMPLATE?'左右足底通用示教模板，非患者本人':aspect==='back'?'背部共用医学示教模板，非患者本人':zoom?`${region?.label}局部放大定位`:alt} targets={regionId?points:map.regions} crop={map.crop} selected={regionId?part:null} selectedSide={side} onSelect={regionId?selectPart:selectRegion} busy={busy} toolImage={selectedInstrument?.image} overview={!regionId} ring={region&&map.image!==EXAM_SOLES_TEMPLATE?{title:region.label,sites:visibleSites.map(site=>({id:site.id,label:anatomyLabel(site.id)})),anchor:zoom?{x:50,y:50}:map.regions.find(item=>item.id===regionId)??{x:50,y:45},onClose:reset,completed:wasChecked}:undefined}/>

          {map.image===EXAM_SOLES_TEMPLATE&&<p className="ce-canvas-hint">足底图仅用于定位；反射结果由本会话绑定资料和月龄解释。</p>}
          {!region&&<p className="ce-canvas-hint">点击人物上的大部位展开；背部和全身检查也可从下方选择。</p>}
          {activeObservation&&<aside className="ce-result" aria-label="本次查体反馈" aria-live="polite"><ExamObservationCard observation={activeObservation} onClose={onCloseObservation} onReplayAudio={onReplayAudio} showReference={showReference}/></aside>}
        </div>
        <div className="ce-canvas-footer"><nav className="ce-region-menu" aria-label="选择查体大部位">{ANATOMY_REGIONS.map(item=><button type="button" key={item.id} aria-pressed={regionId===item.id} disabled={busy} onClick={()=>selectRegion(item.id)}>{item.label}</button>)}</nav><div className="ce-context-controls"><div className="ce-position-context"><span>当前：{positionLabels[position]}</span>{neededPosition&&<button type="button" disabled={busy} onClick={()=>{onPositionChange(neededPosition);onCloseObservation();}}>协助患儿{positionLabels[neededPosition]}</button>}</div>{part&&<div role="group" aria-label="检查侧别"><span>侧别</span>{(['both','left','right','midline'] as const).filter(value=>part.startsWith('left-')?value==='left':part.startsWith('right-')?value==='right':side==='midline'?value==='midline':value!=='midline').map(value=><button type="button" key={value} aria-pressed={side===value} disabled={busy} onClick={()=>{setSide(value);onCloseObservation();}}>{{both:'整体/双侧',left:'患者左侧',right:'患者右侧',midline:'正中'}[value]}</button>)}</div>}</div><div className="ce-action"><span>{selectedInstrument?.label??'未选器材'}<b>＋</b>{part?anatomyLabel(part):'未选小部位'}</span><button type="button" className="ce-execute" disabled={busy||!part||!tool||wasChecked(part)} onClick={()=>{if(part&&tool)onExamine(part,tool,{side,aspect});}}>{busy?'正在检查…':part&&wasChecked(part)?'已检查':'开始检查'}</button></div></div>
      </section>
    </div>
  </div>;
}
