import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ANATOMY_REGIONS,EXAM_INSTRUMENTS,type AnatomyRegion} from '../../src/domain/exam-anatomy';
import {RegionDiagram} from '../../src/components/clinical-exam';
import {patientAppearance,allowedPostures} from '../../src/domain/patient-appearance';

const root='deliverables/67-cases-20261107/assets';
for(const folder of ['instruments','patients','anatomy'])mkdirSync(path.join(root,folder),{recursive:true});
const manifest:Array<Record<string,unknown>>=[];
function copy(url:string,category:string,metadata:Record<string,unknown>){
  const name=path.basename(url),target=path.join(root,category,name);copyFileSync(path.join('public',url),target);
  manifest.push({...metadata,path:`${category}/${name}`,publicPath:url,sha256:createHash('sha256').update(readFileSync(target)).digest('hex'),synthetic:true,reviewStatus:'automated-unreviewed'});
}
for(const tool of EXAM_INSTRUMENTS.filter(t=>t.image))copy(tool.image,'instruments',{id:tool.id,label:tool.label,assetClass:['inspection','palpation','percussion','hand-hygiene'].includes(tool.id)?'method':'instrument'});
for(const [band,age] of [['newborn','2天'],['infant','6个月'],['toddler','2岁'],['preschool','4岁'],['school','8岁'],['adolescent','14岁']])for(const sex of ['男','女'])for(const posture of allowedPostures(age)){
  const asset=patientAppearance(sex,posture,'training-asset-reference',age);
  if(asset.src)copy(asset.src,'patients',{id:asset.key,band,sex,posture,basicCombination:true});
}
// Preserve preschool alternatives used by actual case hashes as well as the 20 base combinations.
const index=JSON.parse(readFileSync('deliverables/67-cases-20261107/index.json','utf8'));
for(const entry of index){const pack=JSON.parse(readFileSync(`knowledge/training-packages/packages/${entry.version}.json`,'utf8'));for(const asset of pack.appearanceAssets??[])if(!manifest.some(m=>m.publicPath===asset.publicPath))copy(asset.publicPath,'patients',{id:asset.assetId,posture:asset.posture,basicCombination:false});}
const diagrams:AnatomyRegion[]=[...ANATOMY_REGIONS,{id:'rg-lower-limb-sole',label:'足底面',outline:'sole',sites:[{id:'plantar',x:67,y:59}]}];
for(const region of diagrams)for(const aspect of region.id==='rg-chest'?['front','back'] as const:region.id==='rg-back'?['back'] as const:['front'] as const){
  const markup=renderToStaticMarkup(createElement(RegionDiagram,{region,aspect,selected:null,onSelect:()=>{},busy:false}));
  const svg=markup.match(/<svg[\s\S]*?<\/svg>/)?.[0];
  if(!svg)throw new Error('DIAGRAM_MISSING');
  const target=path.join(root,'anatomy',`${region.id}-${aspect}.svg`);
  writeFileSync(target,svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  manifest.push({id:region.id,aspect,path:`anatomy/${path.basename(target)}`,sites:region.sites.filter(s=>!s.aspect||s.aspect===aspect),type:'authored-neutral-diagram',reviewStatus:'automated-unreviewed'});
}
writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({instruments:manifest.filter(m=>m.assetClass==='instrument').length,basePatients:manifest.filter(m=>m.basicCombination).length,diagrams:manifest.filter(m=>m.type==='authored-neutral-diagram').length}));
