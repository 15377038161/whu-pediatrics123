import assert from 'node:assert/strict';
import test from 'node:test';
import {startWavRecording} from '../src/lib/speech';

test('麦克风拒绝区分非安全连接、内嵌策略和权限拒绝，不伪称用户未开启权限',async()=>{
 const keys=['window','document','navigator'] as const;
 const descriptors=keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 const install=(key:string,value:unknown)=>Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 let requests=0;
 try{
  install('window',{isSecureContext:false});
  await assert.rejects(startWavRecording(),/安全连接/);
  install('window',{isSecureContext:true});
  install('document',{permissionsPolicy:{allowsFeature:()=>false}});
  install('navigator',{mediaDevices:{getUserMedia:async()=>{requests++;throw new DOMException('denied','NotAllowedError');}}});
  await assert.rejects(startWavRecording(),/内嵌预览不允许麦克风/);
  assert.equal(requests,0);
  install('document',{permissionsPolicy:{allowsFeature:()=>true}});
  await assert.rejects(startWavRecording(),/系统麦克风隐私权限/);
  assert.equal(requests,1);
 }finally{
  for(const [key,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
 }
});
