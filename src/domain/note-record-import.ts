import type {SessionState} from './agent';
import type {NoteContent} from './medical-note';
import {getCaseRecordEntries} from './case-record';
import {formatVitalMeasurement} from './vital-measurement';

/** Only released student-visible records. Never reads case packages or answers. */
export function noteFromReleasedRecords(session:Pick<SessionState,'events'|'messages'>):Partial<NoteContent>{
  const sections={presentIllness:[] as string[],physicalExam:[] as string[],auxiliaryTests:[] as string[]};
  for(const record of getCaseRecordEntries(session)){
    if(record.event.correct===false)continue;
    if(record.category==='history'){
      if(record.answers.length)sections.presentIllness.push(`问：${record.question??'本轮询问'}\n${record.answers.map(a=>`${a.actor==='parent'?'家长':'患儿'}：${a.content}`).join('\n')}`);
    }else if(record.category==='exam'){
      sections.physicalExam.push(record.event.summary);
      for(const measurement of record.event.measurements??[])sections.physicalExam.push(formatVitalMeasurement(measurement));
    }else sections.auxiliaryTests.push(record.event.summary);
  }
  return Object.fromEntries(Object.entries(sections).filter(([,rows])=>rows.length).map(([key,rows])=>[key,`【本轮已获得记录，待整理】\n${[...new Set(rows)].join('\n\n')}`]));
}

const IMPORT_HEADER='【本轮已获得记录，待整理】';

function recordBlocks(value:string):string[]{
  return value.split(/\n{2,}/).map(block=>block.trim()).filter(block=>block&&block!==IMPORT_HEADER);
}

/** Fill blank sections; append only newly released blocks to earlier imports without rewriting student text. */
export function fillEmptyNoteSections(draft:NoteContent,records:Partial<NoteContent>):NoteContent{
  const next={...draft};
  for(const key of Object.keys(records) as (keyof NoteContent)[]){
    const incoming=records[key]?.trim();
    if(!incoming)continue;
    const current=next[key].trim();
    if(!current){next[key]=incoming;continue;}
    if(!current.includes(IMPORT_HEADER))continue;
    const existing=new Set(recordBlocks(current));
    const missing=recordBlocks(incoming).filter(block=>!existing.has(block));
    if(missing.length)next[key]=`${next[key].trimEnd()}\n\n${missing.join('\n\n')}`;
  }
  return next;
}
