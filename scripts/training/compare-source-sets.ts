/** Compare two private source sets without printing patient text or changing either set. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {TEACHER_CASE_CATALOG} from '../../src/domain/teacher-case-catalog';
import {recordSchema} from '../../src/lib/teacher-case-data';
import {computeCaseDataVersion} from '../../src/lib/case-data-version';

const [leftRoot,rightRoot,output]=process.argv.slice(2);
if(!leftRoot||!rightRoot||!output)throw new Error('Usage: compare-source-sets <left-knowledge-root> <right-knowledge-root> <private-output.json>');
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify({value},(_key,v)=>typeof v==='string'?v.replace(/\r\n/g,'\n'):v)).digest('hex');
const rows=TEACHER_CASE_CATALOG.filter(item=>item.folder).map(item=>{
  const read=(root:string)=>recordSchema.parse(JSON.parse(readFileSync(path.join(root,'teaching-cases',item.id+'.json'),'utf8')));
  const left=read(leftRoot),right=read(rightRoot);
  if(left.caseId!==item.id||right.caseId!==item.id)throw new Error('SOURCE_ID_MISMATCH');
  const clinical={age:[left.age,right.age],sex:[left.sex,right.sex],complaint:[left.complaint,right.complaint],vitals:[left.vitals,right.vitals],...Object.fromEntries(Object.keys(left.sections).map(key=>[key,[left.sections[key as keyof typeof left.sections],right.sections[key as keyof typeof right.sections]]]))};
  const provenance={sourceName:[left.sourceName,right.sourceName],sourceDocument:[left.sourceDocument,right.sourceDocument],documents:[left.documents,right.documents]};
  const bindings={examRules:[left.examRules,right.examRules],testDefinitions:[left.testDefinitions,right.testDefinitions],testRelease:[left.testRelease,right.testRelease],testMedia:[left.testMedia,right.testMedia],examMedia:[left.examMedia,right.examMedia]};
  const differences=(fields:Record<string,unknown[]>)=>Object.entries(fields).filter(([,values])=>digest(values[0])!==digest(values[1])).map(([name])=>name);
  return {caseId:item.id,leftVersion:computeCaseDataVersion(left),rightVersion:computeCaseDataVersion(right),clinicalDifferences:differences(clinical),provenanceDifferences:differences(provenance),bindingDifferences:differences(bindings)};
});
writeFileSync(output,JSON.stringify({schemaVersion:1,sourceCount:rows.length,rawTextIncluded:false,rows},null,2),{mode:0o600});
console.log(JSON.stringify({sources:rows.length,exactMatches:rows.filter(r=>r.leftVersion===r.rightVersion).length,clinicalMatches:rows.filter(r=>r.clinicalDifferences.length===0).length,bindingMatches:rows.filter(r=>r.bindingDifferences.length===0).length}));
