import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
import {syntheticTeacherCase} from './fixtures/teacher-case';import {readTeacherCaseData,recordSchema} from '../src/lib/teacher-case-data';import {computeCaseDataVersion} from '../src/lib/case-data-version';
test('本地资料更新后按精确历史内容恢复；错指纹/错病例及非法版本拒绝，不用新版覆盖旧会话',()=>{
 const previous=process.env.PEDIATRICS_KNOWLEDGE_ROOT;const root=mkdtempSync(path.join(os.tmpdir(),'peds-archive-synthetic-'));process.env.PEDIATRICS_KNOWLEDGE_ROOT=root;
 try{
  const record=recordSchema.parse(syntheticTeacherCase());const version=computeCaseDataVersion(record);
  const dir=path.join(root,'teaching-case-versions',record.caseId);mkdirSync(dir,{recursive:true});const file=path.join(dir,version+'.json');writeFileSync(file,JSON.stringify(record));
  mkdirSync(path.join(root,'teaching-cases'));const current={...record,vitals:{...record.vitals,temperature:37.2}};
  writeFileSync(path.join(root,'teaching-cases',record.caseId+'.json'),JSON.stringify(current));
  assert.equal(readTeacherCaseData(record.caseId)?.vitals.temperature,37.2);
  assert.equal(readTeacherCaseData(record.caseId,version)?.vitals.temperature,record.vitals.temperature);
  assert.equal(readTeacherCaseData(record.caseId,'../not-a-version'),null);
  const frozen=readFileSync(file);writeFileSync(file,JSON.stringify(current));assert.throws(()=>readTeacherCaseData(record.caseId,version),/CASE_SOURCE_INVALID/);
  writeFileSync(file,JSON.stringify({...record,caseId:'teacher-其他病例'}));assert.throws(()=>readTeacherCaseData(record.caseId,version),/CASE_SOURCE_INVALID/);
  writeFileSync(file,frozen);
 }finally{if(previous===undefined)delete process.env.PEDIATRICS_KNOWLEDGE_ROOT;else process.env.PEDIATRICS_KNOWLEDGE_ROOT=previous;}
});


