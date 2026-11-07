import {writeFileSync} from 'node:fs';
import {CURRICULA} from './curricula';
async function main(){
  const urls=[...new Set(Object.values(CURRICULA).map(c=>c.guide))];
  const rows:Array<{url:string;status:number;title:string;checkedAt:string}>=[];
  let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(cursor<urls.length){const url=urls[cursor++];try{
      const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'user-agent':'Mozilla/5.0 teaching-reference-link-check'}});
      const html=await response.text();const title=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1].replace(/\s+/g,' ').trim()??'';
      rows.push({url,status:response.status,title,checkedAt:new Date().toISOString()});
    }catch{rows.push({url,status:0,title:'link-check-unavailable',checkedAt:new Date().toISOString()});}}
  }));
  writeFileSync('outputs/training-20261107/reference-checks.json',JSON.stringify(rows,null,2));
  console.log(JSON.stringify({checked:rows.length,ok:rows.filter(r=>r.status===200).length,unavailable:rows.filter(r=>r.status!==200).map(r=>({url:r.url,status:r.status}))}));
}
void main();
