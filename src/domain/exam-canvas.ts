import type {ExamPosition} from './agent';
import {ANATOMY_REGIONS,anatomyLabel,type ExamAspect} from './exam-anatomy';
import {photoExamMap,type PhotoTarget,type PhotoCrop} from './exam-photo-map';
import {growthPosition} from './growth-exam';

export const EXAM_BACK_TEMPLATE='/media/clinical/exam-back-teaching-v1.png';
export const EXAM_SOLES_TEMPLATE='/media/clinical/exam-soles-teaching-v1.png';
const backLocations:Record<string,[number,number]>={back:[50,32],spine:[50,48],'left-kidney':[35,62],'right-kidney':[65,62],'left-lung-back':[34,43],'right-lung-back':[66,43],chest:[50,30],'chest-lung':[50,43],axilla:[19,34]};
// Image left is the patient's right foot. These pins only navigate anatomy;
// the released finding and any age-related reflex interpretation stay server-side.
const soleSites:PhotoTarget[]=[
  {id:'plantar',label:'患者右足底',x:26,y:52,side:'right'},
  {id:'plantar',label:'患者左足底',x:74,y:52,side:'left'},
];

/** All coordinates belong to the one currently displayed image. */
export function examCanvasMap(assetKey:string|undefined,posture:'standing'|'supine',regionId:string|null,aspect:ExamAspect,zoom:boolean,group=0):{image:string|null;crop?:PhotoCrop;regions:PhotoTarget[];sites:PhotoTarget[]}{
  const photo=assetKey?photoExamMap(assetKey,posture,regionId??'rg-head-neck',group):null;
  const region=ANATOMY_REGIONS.find(item=>item.id===regionId);
  // The third lower-limb detail group is the dedicated plantar view.
  if(aspect==='front'&&regionId==='rg-lower-limb'&&group===2)return {image:EXAM_SOLES_TEMPLATE,crop:undefined,regions:photo?.regions??[],sites:soleSites};
  if(aspect==='back')return {image:EXAM_BACK_TEMPLATE,crop:undefined,regions:[] as PhotoTarget[],sites:(region?.sites??[]).filter(site=>!site.aspect||site.aspect==='back').flatMap(site=>{
    const point=backLocations[site.id];return point?[{id:site.id,label:anatomyLabel(site.id),x:point[0],y:point[1],...(site.id.startsWith('left-')?{side:'left' as const}:site.id.startsWith('right-')?{side:'right' as const}:{})}]:[];
  })};
  const sites=photo?.sites.map(site=>zoom||!photo.crop?site:{...site,x:photo.crop.x+site.x/100*photo.crop.width,y:photo.crop.y+site.y/100*photo.crop.height})??[];
  return {image:null,crop:zoom?photo?.crop:undefined,regions:photo?.regions??[],sites};
}

/** Offer only a position that this session actually supports. */
export function requiredExamPosition(regionId:string|null,aspect:ExamAspect,current:ExamPosition,available:ExamPosition[],tool?:string|null):ExamPosition|null{
  const measurementPosition=regionId==='rg-general'&&tool?growthPosition(tool):null;
  if(measurementPosition&&current!==measurementPosition)return available.includes(measurementPosition)?measurementPosition:null;
  if(/^rg-(abdomen|groin)$/.test(regionId??'')&&current!=='supine')return available.includes('supine')?'supine':null;
  if(aspect==='back'&&current==='supine')return (['sitting','lateral','standing'] as const).find(value=>available.includes(value))??null;
  return null;
}
