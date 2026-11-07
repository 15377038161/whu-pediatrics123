import { ANATOMY_REGIONS, anatomyLabel } from './exam-anatomy';
import type { ExamLocation } from './agent';

export interface PhotoTarget { id:string; label:string; x:number; y:number; side?:ExamLocation['side'] }
export interface PhotoCrop { x:number; y:number; width:number; height:number }
// Percent coordinates belong to the complete asset, including its background.
// Standing and supine assets were inspected separately. No disease is inferred
// from these generic photographs; this table only locates interaction targets.
const landmarks:Record<string,readonly [number,number,number,number,number,number]> = {
  'infant-boy:supine':[15,35,50,63,43,80], 'infant-girl:supine':[15,35,50,63,43,80],
  'newborn-boy:supine':[33,47,55,64,53,77], 'newborn-girl:supine':[33,47,55,64,53,77],
  'boy-a:standing':[15,31,43,53,45,74], 'boy-a:supine':[14,29,39,48,40,69],
  'boy-b:standing':[17,34,44,54,46,73], 'boy-b:supine':[16,31,41,51,43,73],
  'girl-a:standing':[17,33,43,53,45,74], 'girl-a:supine':[15,30,41,50,44,73],
  'girl-b:standing':[17,33,44,54,46,74], 'girl-b:supine':[15,30,41,50,44,73],
  'toddler-boy:standing':[25,43,53,64,53,82], 'toddler-boy:supine':[22,35,45,57,48,76],
  'toddler-girl:standing':[23,40,51,61,49,81], 'toddler-girl:supine':[21,35,45,56,48,77],
  'school-boy:standing':[15,32,44,55,46,77], 'school-boy:supine':[21,34,44,55,46,76],
  'school-girl:standing':[19,37,48,59,49,79], 'school-girl:supine':[14,30,40,52,42,75],
  'adolescent-boy:standing':[12,28,41,53,43,77], 'adolescent-boy:supine':[12,27,38,50,42,77],
  'adolescent-girl:standing':[13,30,43,54,45,78], 'adolescent-girl:supine':[12,30,41,52,45,76],
};

// Eyes, nose, mouth and ear levels are calibrated per actual asset and posture.
// A single offset from “head centre” put some supine faces on the forehead.
// Tuple: eyeY, noseY, mouthY, earY, earX, faceX, neckY (whole-photo percent).
const faces:Record<string,readonly [number,number,number,number,number,number,number]>={
  'infant-boy:supine':[14.4,18,20.1,16.7,36.5,50,27.5],
  'infant-girl:supine':[17.8,20.6,23.1,19.5,36.5,50,31.5],
  'newborn-boy:supine':[35,35.6,37.4,36.3,44,49.3,44],
  'newborn-girl:supine':[36.4,37.3,39,38,44,49.5,45.5],
  'boy-a:standing':[16.7,18.4,20.9,18.5,39.5,49,26],
  'boy-a:supine':[16.3,19.2,21,17.8,41,49.5,26],
  'boy-b:standing':[17.4,19.7,21.6,19.3,39.5,50,26.6],
  'boy-b:supine':[17.2,19.4,21.3,19.3,39.5,48,26.3],
  'girl-a:standing':[16.7,18.9,21,19,39.5,49,26],
  'girl-a:supine':[16.7,19,20.9,18.6,39,49,25.9],
  'girl-b:standing':[17,19.7,21.6,20.2,40,50,26.6],
  'girl-b:supine':[16.6,19.1,20.9,18.8,39.3,49.5,25.9],
  'toddler-boy:standing':[24.5,26.8,28.7,25.6,43,52,33.7],
  'toddler-boy:supine':[23.6,25.4,27,25.8,44,48.5,32],
  'toddler-girl:standing':[23.6,26,28,26.7,43,51,33],
  'toddler-girl:supine':[21.3,24,25.7,24,42.5,51,30.7],
  'school-boy:standing':[12.1,14.4,16.7,14.8,43,50,21.7],
  'school-boy:supine':[21.9,24,25.3,24.1,44,51,30.3],
  'school-girl:standing':[17.7,19.5,21.6,20.2,43,50.5,26.6],
  'school-girl:supine':[15,16.8,18.3,16.6,43,49.5,23.3],
  'adolescent-boy:standing':[12.7,14.7,16.4,14.6,43,50.5,21.4],
  'adolescent-boy:supine':[12.1,14.3,16,14.4,43,50,21],
  'adolescent-girl:standing':[12.6,14.6,16.1,14.8,43,50,21.1],
  'adolescent-girl:supine':[13.7,15.3,16.8,15.8,43,49.5,21.8],
};
const foreheadLevels:Record<string,number>={
  'infant-boy:supine':9.4,'infant-girl:supine':13.5,'newborn-boy:supine':32.5,'newborn-girl:supine':33.5,
  'boy-a:standing':12.5,'boy-a:supine':12.5,'boy-b:standing':14.6,'boy-b:supine':14,
  'girl-a:standing':12.8,'girl-a:supine':12.6,'girl-b:standing':13.9,'girl-b:supine':13.5,
  'toddler-boy:standing':22.5,'toddler-boy:supine':21.3,'toddler-girl:standing':19.7,'toddler-girl:supine':17.5,
  'school-boy:standing':9.9,'school-boy:supine':19.7,'school-girl:standing':14.2,'school-girl:supine':11.7,
  'adolescent-boy:standing':10.4,'adolescent-boy:supine':10,'adolescent-girl:standing':10.3,'adolescent-girl:supine':11.6,
};

export function photoExamMap(assetKey:string,posture:'standing'|'supine',regionId:string,detailGroup=0) {
  const points=landmarks[`${assetKey}:${posture}`];
  if(!points)return null;
  const [head,chest,abdomen,groin,arm,leg]=points;
  const infant=assetKey.startsWith('infant-'),newborn=assetKey.startsWith('newborn-');
  const scale=infant?1.5:newborn?0.65:1;
  const torso=newborn?0.6:infant?1.3:1;
  const regions:PhotoTarget[]=[
    {id:'rg-head-neck',label:'头面颈部',x:50,y:head},
    {id:'rg-chest',label:'胸部',x:50,y:chest},
    {id:'rg-abdomen',label:'腹部',x:50,y:abdomen},
    {id:'rg-upper-limb',label:'上肢',x:infant?22:newborn?39:34,y:arm},
    {id:'rg-lower-limb',label:'下肢',x:50,y:leg},
    {id:'rg-groin',label:'腹股沟',x:50,y:groin},
  ];
  const crops:Record<string,PhotoCrop>={
    'rg-head-neck':{x:50-20*scale,y:Math.max(0,head-12*scale),width:40*scale,height:27*scale},
    'rg-chest':{x:50-25*torso,y:chest-10*torso,width:50*torso,height:23*torso},
    'rg-abdomen':{x:50-22*torso,y:abdomen-10*torso,width:44*torso,height:22*torso},
    'rg-upper-limb':{x:infant?5:newborn?31:22,y:chest-3,width:infant?36:newborn?17:23,height:Math.max(18,groin-chest+14)},
    'rg-lower-limb':{x:28,y:groin,width:44,height:Math.min(99-groin,leg-groin+20)},
  };
  const locations:Record<string,[number,number]>={
    scalp:[50,head-8*scale],fontanelle:[50,head-6*scale],forehead:[50,head-3.5*scale],
    eyes:[50,head-.5*scale],ears:[50-9*scale,head+1*scale],nose:[50,head+2*scale],mouth:[50,head+3.3*scale],
    neck:[50,head+9*scale],thyroid:[50,head+10*scale],'cervical-nodes':[50-8*scale,head+9*scale],
    chest:[50,chest],'chest-lung':[44,chest+2],'chest-heart':[55,chest+2],
    'right-lung-upper':[50-8*torso,chest-3*torso],'left-lung-upper':[50+8*torso,chest-3*torso],
    'right-lung-lower':[50-9*torso,chest+5*torso],'left-lung-lower':[50+9*torso,chest+5*torso],
    'aortic-area':[48,chest-3],'pulmonic-area':[52,chest-3],'erb-area':[52,chest],
    'tricuspid-area':[51,chest+4],'mitral-area':[57,chest+5],axilla:[50-19*torso,chest+2],breast:[50-11*torso,chest+3],
    abdomen:[50,abdomen],umbilicus:[50,abdomen+2], 'liver-spleen':[50,abdomen-6],
    'abdomen-right-upper':[50-9*torso,abdomen-4],'abdomen-left-upper':[50+9*torso,abdomen-4],
    'abdomen-right-lower':[50-9*torso,abdomen+5],'abdomen-left-lower':[50+9*torso,abdomen+5],
    shoulder:[34,chest-4],'upper-arm':[32,chest+3],elbow:[31,arm-2],wrist:[30,groin-2],hands:[31,groin+2],finger:[32,groin+6],nails:[29,groin+6],'upper-limb-power':[32,arm],
    hip:[43,groin+2],knee:[43,(groin+leg)/2+4],ankle:[43,leg+9],foot:[44,leg+14],'lower-limb-edema':[43,leg+3],'lower-limb-power':[43,leg-5],plantar:[54,leg+14],
  };
  const face=faces[`${assetKey}:${posture}`];
  if(face){
    const [eyeY,noseY,mouthY,earY,earX,faceX,neckY]=face;
    Object.assign(locations,{eyes:[faceX,eyeY],nose:[faceX,noseY],mouth:[faceX,mouthY],ears:[earX,earY],neck:[faceX,neckY],thyroid:[faceX,neckY+.8],'cervical-nodes':[faceX-7*scale,neckY-.5]});
    locations.forehead=[faceX,foreheadLevels[`${assetKey}:${posture}`]];
    const headCrop=crops['rg-head-neck'];
    headCrop.height=Math.max(headCrop.height,neckY+3-headCrop.y);
  }
  if(infant)Object.assign(locations,{shoulder:[35,29],'upper-arm':[29,35],elbow:[24,40],wrist:[17,45],hands:[15,48],finger:[15,50],nails:[15,50],'upper-limb-power':[24,40]});
  if(newborn)Object.assign(locations,{shoulder:[44,43],'upper-arm':[40,47],elbow:[39,51],wrist:[38,55],hands:[39,58],finger:[39,60],nails:[39,60],'upper-limb-power':[39,51],ankle:[47,82],foot:[48,86],plantar:[54,86]});
  // The plantar surface is not visible in these front-facing photographs.
  // Its interaction uses the dedicated sole illustration instead of a shoe.
  delete locations.plantar;
  if(regionId==='rg-chest'&&detailGroup===1)crops[regionId]={x:40,y:chest-7,width:25,height:18};
  const region=ANATOMY_REGIONS.find(item=>item.id===regionId);
  const crop=crops[regionId];
  const sites:PhotoTarget[]=!crop||!region?[]:region.sites.flatMap(site=>{
    const p=locations[site.id];if(!p||site.aspect==='back')return [];
    const x=(p[0]-crop.x)/crop.width*100,y=(p[1]-crop.y)/crop.height*100;
    if(x<0||x>100||y<0||y>100)return [];
    return [{id:site.id,label:anatomyLabel(site.id),x,y}];
  });
  return {regions,crop,sites};
}
