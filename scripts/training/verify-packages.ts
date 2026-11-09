import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {teachingPackageSchema} from '../../src/domain/teaching-package';
import {readTeachingPackage,teachingPackageVersion} from '../../src/lib/teaching-package-store';
import {ANATOMY_REGIONS,EXAM_INSTRUMENTS,instrumentsForSite} from '../../src/domain/exam-anatomy';

const envPath=(name:string,fallback:string)=>{const value=process.env[name];return value&&value.trim().length>0?value:fallback;};
const root=envPath('PEDIATRICS_VERIFY_PACKAGE_ROOT','deliverables/67-cases-20261107');const installed=envPath('PEDIATRICS_VERIFY_INSTALLED_ROOT','knowledge/training-packages');
const resolvedBaselinePath=envPath('PEDIATRICS_VERIFY_BASELINE','backups/20261107-training/baseline.json');const resolvedOutput=envPath('PEDIATRICS_VERIFY_OUTPUT','outputs/training-20261107/package-validation.json');
const index=JSON.parse(readFileSync(path.join(root,'index.json'),'utf8'));
assert.equal(index.length,67);assert.equal(new Set(index.map((r:{sourceId:string})=>r.sourceId)).size,53);
const totals={history:20,exam:25,tests:10,diagnosis:15,plan:20,note:5,communication:5};
const media=new Set<string>();const counts={source:0,simulation:0,reference:0};let facts=0,exams=0,tests=0,rubric=0,numericReports=0,numericRows=0;
for(const entry of index){
  const raw=JSON.parse(readFileSync(path.join(root,'json',entry.filename+'.json'),'utf8'));
  const pack=teachingPackageSchema.parse(raw);
  assert.equal(teachingPackageVersion(raw),pack.version);assert.equal(pack.version,entry.version);
  assert.ok(readTeachingPackage(pack.caseId,pack.version,pack.sourceVersion));
  assert.ok(existsSync(path.join(root,'word',entry.filename+'.docx')));
  assert.ok(pack.appearanceAssets?.length||!['男','女'].includes(pack.sex));assert.ok(pack.questions.length);assert.ok(pack.relationNote);
  for(const [section,max] of Object.entries(totals))assert.ok(Math.abs(pack.rubric.filter(r=>r.section===section).reduce((s,r)=>s+r.maxScore,0)-max)<1e-6);
  assert.ok(Math.abs(pack.rubric.filter(r=>r.level==='basic').reduce((s,r)=>s+r.maxScore,0)-80)<1e-6);
  const historyIds=new Set(pack.historyFacts.map(f=>f.id));
  for(const question of pack.questions)assert.ok(question.factIds.every(id=>historyIds.has(id)));
  const anatomy=new Set(ANATOMY_REGIONS.flatMap(r=>r.sites.map(s=>s.id)));
  assert.equal(new Set(pack.exams.map(e=>e.toolId+':'+e.bodyPartId)).size,pack.exams.length);
  for(const exam of pack.exams){assert.ok(anatomy.has(exam.bodyPartId));assert.ok(instrumentsForSite(exam.bodyPartId).includes(exam.toolId));assert.ok(exam.technique&&exam.reaction&&exam.result);}
  const thermometerPoints=pack.rubric.filter(r=>r.section==='exam'&&r.evidenceCodes.some(c=>c.includes('thermometer')));
  assert.ok(thermometerPoints.length<=1,'Alternative thermometers must not require triple measurement');
  for(const test of pack.tests){
    assert.ok(test.result&&test.rationale&&test.reference);
    if(test.report){assert.equal(test.report.name,test.label);assert.equal(test.report.origin,'source');numericReports++;numericRows+=test.report.rows.length;for(const row of test.report.rows){assert.ok(test.result.includes(row.item));assert.ok(test.result.includes(row.value));if(row.unit!=='原文未注明')assert.ok(test.result.includes(row.unit));}}
    counts[test.origin==='source'?'source':test.origin==='teaching-simulation'?'simulation':'reference']++;
    for(const image of test.media){assert.match(image.fileId,/^training-media:[a-f0-9]{64}$/);media.add(image.fileId);}
  }
  for(const exam of pack.exams)for(const image of exam.media)media.add(image.fileId);
  for(const asset of pack.appearanceAssets??[])assert.ok(existsSync(path.join('public',asset.publicPath)));
  facts+=pack.historyFacts.length;exams+=pack.exams.length;tests+=pack.tests.length;rubric+=pack.rubric.length;
}
for(const id of media){const digest=id.split(':')[1];const bytes=readFileSync(path.join(installed,'media',digest+'.png'));assert.equal(createHash('sha256').update(bytes).digest('hex'),digest);assert.ok(bytes.length<3_000_000);}
if(!existsSync(resolvedBaselinePath))throw new Error('BASELINE_MISSING:'+resolvedBaselinePath);
const baseline=JSON.parse(readFileSync(resolvedBaselinePath,'utf8'));
for(const source of baseline.sources)assert.equal(createHash('sha256').update(readFileSync(source.path)).digest('hex').toUpperCase(),source.sha256);
for(const tool of EXAM_INSTRUMENTS)if(tool.image)assert.ok(existsSync(path.join('public',tool.image)));
const summary={entries:67,sources:53,sourceFilesUnchanged:baseline.sources.length,facts,exams,tests,rubric,numericReports,numericRows,testOrigins:counts,uniqueReleasedMedia:media.size,roots:{packageRoot:root,installedRoot:installed,baseline:resolvedBaselinePath,output:resolvedOutput},checkedAt:new Date().toISOString()};
mkdirSync(path.dirname(resolvedOutput),{recursive:true});
writeFileSync(resolvedOutput,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
