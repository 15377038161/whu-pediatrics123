import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync,chmodSync,realpathSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
function fixture(built=true){
 const root=mkdtempSync(path.join(os.tmpdir(),'peds-runner-'));
 for(const name of ['scripts','dist','.next','bin'])mkdirSync(path.join(root,name));
 copyFileSync(path.resolve('scripts/run.sh'),path.join(root,'scripts/run.sh'));
 const fakeServer="console.log(JSON.stringify({port:process.env.PORT,platformPort:process.env.DEPLOY_RUN_PORT,host:process.env.HOST,recovery:process.env.PEDIATRICS_TRAINING_RECOVERY,preferLocal:process.env.PEDIATRICS_TRAINING_PREFER_LOCAL}));";
 if(built){writeFileSync(path.join(root,'.next/BUILD_ID'),'test-build');writeFileSync(path.join(root,'dist/server.js'),fakeServer);}
 const command=path.join(root,'bin/pnpm');
 writeFileSync(command,`#!/usr/bin/env bash\nset -euo pipefail\n[[ "$1" == "build" ]]\nprintf 'build\\n' >> build-calls.txt\nmkdir -p .next dist\nprintf 'test-build' > .next/BUILD_ID\ncat > dist/server.js <<'SERVER'\n${fakeServer}\nSERVER\n`);chmodSync(command,0o755);
 const run=(port?:string,platformPort?:string)=>{
  const env:NodeJS.ProcessEnv={...process.env,PATH:path.join(root,'bin')+path.delimiter+(process.env.PATH||'')};
  delete env.PORT;delete env.DEPLOY_RUN_PORT;
  if(port!==undefined)env.PORT=port;if(platformPort!==undefined)env.DEPLOY_RUN_PORT=platformPort;
  return spawnSync(bash,[path.join(root,'scripts/run.sh')],{env,encoding:'utf8',timeout:10000});
 };
 return {root,run,cleanup:()=>{
  const resolved=realpathSync(root);
  if(path.dirname(resolved)!==realpathSync(os.tmpdir())||!path.basename(resolved).startsWith('peds-runner-'))throw Error('TEMP_CLEANUP_PATH_INVALID');
  rmSync(resolved,{recursive:true,force:true});
 }};
}
test('preview uses platform port then PORT then 5173 and retains the custom server',()=>{
 const f=fixture();try{
  for(const [port,platform,expected] of [[undefined,undefined,'5173'],['6200',undefined,'6200'],['6200','5174','5174']] as const){
   const result=f.run(port,platform);assert.equal(result.status,0,result.stderr);
   assert.deepEqual(JSON.parse(result.stdout),{port:expected,platformPort:expected,host:'0.0.0.0',recovery:'object-storage',preferLocal:'1'});
  }
 }finally{f.cleanup();}
});
test('fresh sandbox rebuilds missing artifacts exactly once',()=>{
 const f=fixture(false);try{
  assert.equal(f.run(undefined,'5173').status,0);assert.equal(f.run(undefined,'5173').status,0);
  assert.equal(readFileSync(path.join(f.root,'build-calls.txt'),'utf8'),'build\n');
 }finally{f.cleanup();}
});
test('invalid ports fail before attempting a build',()=>{
 const f=fixture();try{
  for(const port of ['0','65536','foo','5173;echo bad'])assert.notEqual(f.run(undefined,port).status,0);
 }finally{f.cleanup();}
});
