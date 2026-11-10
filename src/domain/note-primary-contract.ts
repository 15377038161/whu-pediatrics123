import {NOTE_SECTION_KEYS,type NoteSectionKey} from './medical-note';
export const NOTE_PRIMARY_VERSION='note-primary-60-v1' as const;
export const NOTE_PRIMARY_WEIGHTS:Record<NoteSectionKey,readonly[number,number]>={
 chiefComplaint:[3,0],presentIllness:[10,2],pastHistory:[2,0],personalHistory:[2,0],familyHistory:[2,0],
 physicalExam:[6,2],auxiliaryTests:[4,2],preliminaryDiagnosis:[8,2],differentialDiagnosis:[3,2],treatmentPlan:[8,2],
};
export const PROCESS_PRIMARY_WEIGHTS={history:[8,2],exam:[10,2],tests:[4,2],plan:[6,2],communication:[4,0]} as const;
type Point={section:string;level:string;maxScore:number;noteSection?:NoteSectionKey;noteComponent?:'diagnosis'|'basis'};
/** 返回精确的制作错误；不自动缩放分值，也不改历史量表。 */
export function notePrimaryErrors(points:readonly Point[]):string[]{
 const errors:string[]=[];
 const sum=(items:readonly Point[])=>items.reduce((n,i)=>n+i.maxScore,0);
 const equal=(actual:number,expected:number)=>Math.abs(actual-expected)<1e-7;
 for(const key of NOTE_SECTION_KEYS)for(const [index,level] of ['basic','advanced'].entries()){
  if(!equal(sum(points.filter(i=>i.section==='note'&&i.noteSection===key&&i.level===level)),NOTE_PRIMARY_WEIGHTS[key][index]))errors.push(`NOTE_WEIGHT:${key}:${level}`);
 }
 for(const [section,weights] of Object.entries(PROCESS_PRIMARY_WEIGHTS))for(const [index,level] of ['basic','advanced'].entries()){
  if(!equal(sum(points.filter(i=>i.section===section&&i.level===level)),weights[index]))errors.push(`PROCESS_WEIGHT:${section}:${level}`);
 }
 if(points.some(i=>i.section==='note'&&!i.noteSection))errors.push('NOTE_SECTION_REQUIRED');
 if(points.some(i=>i.section==='diagnosis'))errors.push('DIAGNOSIS_BELONGS_TO_FINAL_NOTE');
 for(const component of ['diagnosis','basis'])if(!equal(sum(points.filter(i=>i.section==='note'&&i.noteSection==='preliminaryDiagnosis'&&i.noteComponent===component)),5))errors.push(`DIAGNOSIS_COMPONENT:${component}`);
 if(!equal(sum(points),100))errors.push('TOTAL_MUST_BE_100');
 return errors;
}
export function submittedSectionText(section:NoteSectionKey|undefined,content:Partial<Record<NoteSectionKey,string>>|undefined):string|undefined{
 return content===undefined?undefined:section?content[section]??'':undefined;
}
