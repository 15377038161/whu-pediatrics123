import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import type {TeacherCaseData} from '@/lib/teacher-case-data';

/** Test-only source fixture, never an application catalogue entry or runtime fallback. */
export function syntheticTeacherCase(overrides:Partial<TeacherCaseData>={}):TeacherCaseData{
 return {caseId:'teacher-川崎病',sourceName:'合成工程资料',sourceDocument:'synthetic.txt',age:'5岁',sex:'女',complaint:'合成主诉',
  sections:{history:'患儿女童，5岁，起病2天。家长描述发热，已用药。足月顺产，既往无过敏。',exam:'胸部：合成呼吸音记录。腹部：合成腹部触诊记录。',tests:'血常规：合成结果。',diagnosis:'合成私有诊断',plan:'合成私有处置'},
  vitals:{temperature:null,heartRate:null,respiratoryRate:null,spo2:null},documents:[],...overrides};
}
export async function withSyntheticTeacherCase(work:(root:string)=>Promise<void>){
 const previous=process.env.PEDIATRICS_KNOWLEDGE_ROOT,prefix=path.join(os.tmpdir(),'peds-test-source-'),root=mkdtempSync(prefix);
 try{mkdirSync(path.join(root,'teaching-cases'));const r=syntheticTeacherCase();writeFileSync(path.join(root,'teaching-cases',r.caseId+'.json'),JSON.stringify(r));process.env.PEDIATRICS_KNOWLEDGE_ROOT=root;await work(root);}
 finally{if(previous===undefined)delete process.env.PEDIATRICS_KNOWLEDGE_ROOT;else process.env.PEDIATRICS_KNOWLEDGE_ROOT=previous;
  if(!path.resolve(root).startsWith(path.resolve(prefix)))throw new Error('TEST_CLEANUP_PATH_INVALID');rmSync(root,{recursive:true,force:true});}
}
