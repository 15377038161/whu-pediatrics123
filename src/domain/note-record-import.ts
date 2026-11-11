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

/** Re-import does not overwrite student writing or duplicate an earlier import. */
export function fillEmptyNoteSections(draft:NoteContent,records:Partial<NoteContent>):NoteContent{
  const next={...draft};
  for(const key of Object.keys(records) as (keyof NoteContent)[])if(!next[key].trim())next[key]=records[key]??'';
  return next;
}
