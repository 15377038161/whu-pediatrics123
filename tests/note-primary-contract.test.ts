import test from 'node:test';
import assert from 'node:assert/strict';
import {NOTE_PRIMARY_WEIGHTS,PROCESS_PRIMARY_WEIGHTS,notePrimaryErrors,submittedSectionText} from '../src/domain/note-primary-contract';
import type {NoteSectionKey} from '../src/domain/medical-note';
type Point=Parameters<typeof notePrimaryErrors>[0][number];
const points:Point[]=Object.entries(NOTE_PRIMARY_WEIGHTS).flatMap<Point>(([noteSection,weights])=>weights.flatMap<Point>((maxScore,index)=>maxScore?noteSection==='preliminaryDiagnosis'?['diagnosis','basis'].map(noteComponent=>({section:'note',noteSection:noteSection as NoteSectionKey,noteComponent:noteComponent as 'diagnosis'|'basis',level:index?'advanced':'basic',maxScore:maxScore/2})):[{section:'note',noteSection:noteSection as NoteSectionKey,noteComponent:undefined,level:index?'advanced':'basic',maxScore}]:[]));
const all:Point[]=[...points,...Object.entries(PROCESS_PRIMARY_WEIGHTS).flatMap<Point>(([section,weights])=>weights.flatMap<Point>((maxScore,index)=>maxScore?[{section,noteSection:undefined,noteComponent:undefined,level:index?'advanced':'basic',maxScore}]:[]))];
test('new rubric has exact per-section weights and diagnosis/basis 5 each',()=>assert.deepEqual(notePrimaryErrors(all),[]));
test('legacy 5-point note cannot be silently labelled note-primary',()=>{
 const invalid=all.map(i=>({...i,maxScore:i.section==='note'?i.maxScore/12:i.maxScore}));
 assert.ok(notePrimaryErrors(invalid).includes('TOTAL_MUST_BE_100'));
});
test('submitted section isolation and unavailable/empty distinction',()=>{
 assert.equal(submittedSectionText('chiefComplaint',{chiefComplaint:'咳嗽1天',treatmentPlan:'监测血糖'}),'咳嗽1天');
 assert.equal(submittedSectionText('presentIllness',{}),'');
 assert.equal(submittedSectionText('presentIllness',undefined),undefined);
});
