import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ANATOMY_REGIONS,EXAM_INSTRUMENTS} from '../../src/domain/exam-anatomy';
import {EXAM_BACK_TEMPLATE,examCanvasMap} from '../../src/domain/exam-canvas';
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
copy(EXAM_BACK_TEMPLATE,'anatomy',{id:'shared-back',type:'authored-teaching-template',patientImage:false});
const locations=ANATOMY_REGIONS.map(region=>({id:region.id,label:region.label,sites:region.sites,back:examCanvasMap(undefined,'standing',region.id,'back',false).sites}));
writeFileSync(path.join(root,'anatomy','single-canvas-locations.json'),JSON.stringify(locations,null,2));
writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({instruments:manifest.filter(m=>m.assetClass==='instrument').length,basePatients:manifest.filter(m=>m.basicCombination).length,backTemplates:manifest.filter(m=>m.type==='authored-teaching-template').length}));
