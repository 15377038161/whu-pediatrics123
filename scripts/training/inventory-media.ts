import {writeFileSync,existsSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {TEACHER_CASE_CATALOG} from '../../src/domain/teacher-case-catalog';
import {TEACHER_CASE_LINKS} from '../../src/domain/teacher-case-links';
const sources=new Map<string,{sourceId:string;folder:string|null;types:Record<string,number>;files:string[]}>();
function files(root:string):string[]{return readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(root,e.name)):[path.join(root,e.name)]);}
for(const item of TEACHER_CASE_CATALOG){
  const sourceId=TEACHER_CASE_LINKS[item.id]?.sourceId??item.id;
  if(sources.has(sourceId)||!existsSync(path.join('knowledge/teaching-cases',sourceId+'.json')))continue;
  const original=TEACHER_CASE_CATALOG.find(x=>x.id===sourceId);
  const root=original?.folder&&existsSync(original.folder)?original.folder:null;
  const list=root?files(root):[];
  const types:Record<string,number>={};for(const file of list){const ext=path.extname(file).toLowerCase();types[ext]=(types[ext]??0)+1;}
  sources.set(sourceId,{sourceId,folder:root,types,files:list});
}
writeFileSync('outputs/training-20261107/media-sources.json',JSON.stringify([...sources.values()],null,2));
console.log(JSON.stringify({sources:sources.size,withImages:[...sources.values()].filter(s=>s.types['.jpg']||s.types['.png']).length,withDocs:[...sources.values()].filter(s=>s.types['.docx']||s.types['.doc']).length,files:[...sources.values()].reduce((n,s)=>n+s.files.length,0)}));
