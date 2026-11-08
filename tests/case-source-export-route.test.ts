import assert from 'node:assert/strict';
import test from 'node:test';
import {NextRequest} from 'next/server';
import {POST} from '@/app/api/teacher/case-snapshot-archive/route';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {unzipSync} from 'fflate';
import {TEACHER_CASE_CATALOG} from '@/domain/teacher-case-catalog';
import {computeCaseDataVersion} from '@/lib/case-data-version';
import {syntheticTeacherCase} from './fixtures/teacher-case';

test('原件导出沿用真实身份与白名单守卫：匿名、学生和非白名单教师均无文件响应',async()=>{
  const keys=['CODER_SUPABASE_URL','CODER_SUPABASE_ANON_KEY','COZE_SUPABASE_URL','COZE_SUPABASE_ANON_KEY'];
  const previous=keys.map(key=>process.env[key]),originalFetch=globalThis.fetch;
  const oldRoot=process.env.PEDIATRICS_KNOWLEDGE_ROOT,prefix=path.join(os.tmpdir(),'peds-export-route-'),root=mkdtempSync(prefix);
  process.env.PEDIATRICS_KNOWLEDGE_ROOT=root;
  let role='student',whitelist=false,sourceQueries=0,allowSources=false,hideSource=false;
  const sourceRows=TEACHER_CASE_CATALOG.filter(item=>item.folder).map(item=>{
    const record=syntheticTeacherCase({caseId:item.id}),version=computeCaseDataVersion(record);
    return {facts:{case_id:item.id,version,created_at:'2026-01-01',facts:{...record,sections:{history:record.sections.history,exam:record.sections.exam,tests:record.sections.tests}}},answers:{case_id:item.id,version,created_at:'2026-01-01',diagnosis:record.sections.diagnosis,plan:record.sections.plan,documents:record.documents,binding_config:{}}};
  });
  keys.forEach(key=>delete process.env[key]);
  process.env.COZE_SUPABASE_URL='https://source-export.invalid';process.env.COZE_SUPABASE_ANON_KEY='synthetic-key';
  globalThis.fetch=async input=>{
    const url=String(input);assert.ok(url.startsWith('https://source-export.invalid/'));
    if(url.includes('/auth/v1/user'))return Response.json({id:'00000000-0000-0000-0000-000000000002',email:'source-export@example.invalid',email_confirmed_at:'2026-01-01',app_metadata:{app:{role}},user_metadata:{}});
    if(url.includes('/rpc/app_is_teacher'))return Response.json(whitelist);
    sourceQueries++;if(!allowSources)throw new Error('Source rows must not be queried for a denied request');
    if(url.includes('/case_snapshot_facts')){assert.ok(new URL(url).searchParams.get('case_id')?.startsWith('in.('));return Response.json(sourceRows.slice(hideSource?1:0).map(row=>row.facts));}
    if(url.includes('/case_snapshot_answers')){assert.ok(new URL(url).searchParams.get('case_id')?.startsWith('in.('));return Response.json(sourceRows.map(row=>row.answers));}
    if(url.includes('/case_publication'))return Response.json(sourceRows.map(row=>({case_id:row.facts.case_id,active_version:row.facts.version,published:true,updated_at:null,updated_by:null,reason:''})));
    throw new Error('Unexpected synthetic upstream path');
  };
  const request=(authenticated=true,confirmation='RESTORE_AND_EXPORT_CASE_SOURCES')=>new NextRequest('http://localhost/api/teacher/case-snapshot-archive',{method:'POST',headers:{'content-type':'application/json',...(authenticated?{authorization:'Bearer synthetic-fixture'}:{})},body:JSON.stringify({confirmation})});
  try{
    for(const [response,status] of [[await POST(request(false)),401],[await POST(request()),403]] as const){assert.equal(response.status,status);assert.equal(response.headers.get('content-type')?.includes('application/zip'),false);}
    role='teacher';assert.equal((await POST(request())).status,403);
    whitelist=true;assert.equal((await POST(request(true,'INVALID_EXPORT'))).status,422);
    assert.equal(sourceQueries,0);
    allowSources=true;
    const downloaded=await POST(request());assert.equal(downloaded.status,200,downloaded.status===200?'':await downloaded.clone().text());
    assert.equal(downloaded.headers.get('X-Case-Source-Count'),'53');
    assert.equal(downloaded.headers.get('Cache-Control'),'private, no-store');
    const files=unzipSync(new Uint8Array(await downloaded.arrayBuffer()));assert.equal(Object.keys(files).length,108);
    assert.ok(Object.keys(files).every(name=>!name.includes('.env')));
    hideSource=true;
    const deniedCachedExport=await POST(request());assert.equal(deniedCachedExport.status,409,'已缓存原件不能代替本轮教师RLS不可见的来源');
    assert.equal(deniedCachedExport.headers.get('content-type')?.includes('application/zip'),false);
  }finally{globalThis.fetch=originalFetch;keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];});if(oldRoot===undefined)delete process.env.PEDIATRICS_KNOWLEDGE_ROOT;else process.env.PEDIATRICS_KNOWLEDGE_ROOT=oldRoot;if(!path.resolve(root).startsWith(path.resolve(prefix)))throw new Error('TEST_CLEANUP_PATH_INVALID');rmSync(root,{recursive:true,force:true});}
});
