import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveTeacherCaseVersion,type CaseVersionDeps} from '@/lib/case-version-select';
const active='1111111111111111';
function deps(overrides:Partial<CaseVersionDeps>={}):CaseVersionDeps{return {getActiveCaseVersion:async()=>active,getLocalImportVersion:()=> '2222222222222222',getSnapshotVersion:()=> '3333333333333333',getDatabaseSnapshotVersion:async()=> '4444444444444444',restoreCaseSnapshotFacts:async()=>({}),...overrides};}
test('explicit entry version overrides local file and newest DB; aliases retain independent pin',async()=>{
 const d=deps({getActiveCaseVersion:async id=>id==='teacher-main'?active:'aaaaaaaaaaaaaaaa'});
 assert.equal((await resolveTeacherCaseVersion('teacher-main',{accessToken:'synthetic',role:'student',isPreview:false},d)).version,active);
 assert.equal((await resolveTeacherCaseVersion('teacher-alias',{accessToken:'synthetic',role:'student',isPreview:false},d)).version,'aaaaaaaaaaaaaaaa');
});
test('missing active teacher snapshot fails closed instead of choosing other data',async()=>{
 await assert.rejects(resolveTeacherCaseVersion('teacher-main',{accessToken:'synthetic',role:'teacher',isPreview:false},deps({restoreCaseSnapshotFacts:async()=>null})),/ACTIVE_VERSION_UNAVAILABLE/);
});
test('preview does not read publication metadata',async()=>{
 const r=await resolveTeacherCaseVersion('teacher-main',{accessToken:'synthetic',role:'teacher',isPreview:true},deps({getActiveCaseVersion:async()=>{throw Error('unexpected network');}}));assert.equal(r.source,'local');
});
