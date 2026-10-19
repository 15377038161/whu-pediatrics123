import assert from 'node:assert/strict';
import test from 'node:test';
import { authedFetch, authedFetchRaw } from '@/lib/authed-api';
import { getBrowserSupabase } from '@/lib/supabase-browser';

test('网关缺 SDK 会话直接回登录；本地 Cookie 回退保留，已登录请求携带令牌', async () => {
  const oldUrl=process.env.NEXT_PUBLIC_CODER_SUPABASE_URL;
  const oldKey=process.env.NEXT_PUBLIC_CODER_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_CODER_SUPABASE_URL='https://supabase.invalid';
  process.env.NEXT_PUBLIC_CODER_SUPABASE_ANON_KEY='fixture-public-key';
  const client=getBrowserSupabase();
  const getSession=client.auth.getSession.bind(client.auth), signOut=client.auth.signOut.bind(client.auth);
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const oldFetch=globalThis.fetch;
  const navigations:string[]=[]; let requests=0; let header='';
  const location={hostname:'sandbox-fixture.cxiagents.com',pathname:'/teacher',assign:(path:string)=>{navigations.push(path);}};
  Object.defineProperty(globalThis,'window',{value:{location},configurable:true});
  client.auth.getSession=async()=>({data:{session:null},error:null});
  client.auth.signOut=async(options)=>{assert.equal(options?.scope,'local');return {error:null};};
  globalThis.fetch=async(_url,init)=>{requests++;header=new Headers(init?.headers).get('authorization')??'';return Response.json({ok:true,data:{available:true}});};
  try {
    await assert.rejects(()=>authedFetch('/api/classes'),{code:'AUTH_REQUIRED'});
    await assert.rejects(()=>authedFetchRaw('/api/case-resource'),{code:'AUTH_REQUIRED'});
    assert.equal(requests,0); assert.deepEqual(navigations,['/','/']);
    location.hostname='127.0.0.1';
    assert.deepEqual(await authedFetch('/api/classes'),{available:true}); assert.equal(requests,1);
    location.hostname='sandbox-fixture.cxiagents.com';
    client.auth.getSession=async()=>({data:{session:{access_token:'fixture-only',refresh_token:'fixture-only',token_type:'bearer',expires_in:3600,user:{id:'fixture-user',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-19T00:00:00Z'}}},error:null});
    assert.deepEqual(await authedFetch('/api/classes'),{available:true}); assert.equal(header,'Bearer fixture-only');
  } finally {
    client.auth.getSession=getSession;client.auth.signOut=signOut;client.auth.stopAutoRefresh();globalThis.fetch=oldFetch;
    if(oldWindow) Object.defineProperty(globalThis,'window',oldWindow); else Reflect.deleteProperty(globalThis,'window');
    if(oldUrl===undefined) delete process.env.NEXT_PUBLIC_CODER_SUPABASE_URL; else process.env.NEXT_PUBLIC_CODER_SUPABASE_URL=oldUrl;
    if(oldKey===undefined) delete process.env.NEXT_PUBLIC_CODER_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_CODER_SUPABASE_ANON_KEY=oldKey;
  }
});
