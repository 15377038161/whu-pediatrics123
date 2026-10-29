import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import {createServer} from 'node:http';
import { requireMediaBindingReview, verifyMediaOriginal, verifyRegisteredMedia, type MediaBindingReview, type MediaSource } from '../scripts/case-audit/media-binding-review';
const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const bytes = Buffer.from('synthetic media bytes');
const standalone: MediaSource = {kind:'standalone-image',originalSha256:digest(bytes),locatorSha256:digest('private synthetic locator')};
const embedded: MediaSource = {kind:'document-embedded',documentSha256:digest('synthetic document'),archiveEntry:'word/media/image1.png'};
function fixture(source: MediaSource = standalone) {
  const expected = {caseId:'synthetic',candidateSha256:digest('candidate'),source,testId:'source-test-0',captionSha256:digest('caption')};
  const review: MediaBindingReview = {...expected,imageSha256:digest(bytes),reviewer:'synthetic-purpose-checker',reviewedAt:'2026-10-27T16:00:00+08:00',usageAuthorized:true,purposeStatus:'approved',authorization:{basis:'user-confirmed-teacher-authorization',confirmedAt:'2026-10-27T16:00:00+08:00',reference:'synthetic user instruction'}};
  return {expected,review};
}
test('教师已确认授权允许未做视觉审核的材料；独立图不需要虚构DOCX', () => {
  const {expected,review}=fixture();
  assert.doesNotThrow(() => requireMediaBindingReview(review,expected,bytes));
  assert.doesNotThrow(() => requireMediaBindingReview({...review,privacyStatus:'unreviewed'},expected,bytes));
  const doc=fixture(embedded);
  assert.doesNotThrow(() => requireMediaBindingReview(doc.review,doc.expected,bytes));
});

test('复用存储对象实际HTTP核字节，错误对象/状态/长度拒绝且不输出签名URL',async()=>{
 const server=createServer((req,res)=>{if(req.url==='/missing'){res.writeHead(404);res.end();return;}
  if(req.url==='/wrong'){res.end(Buffer.alloc(bytes.length,1));return;}
  if(req.url==='/extra'){res.writeHead(200,{'transfer-encoding':'chunked'});res.write(bytes);res.end('extra');return;}
  res.end(bytes);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');
 const root=`http://127.0.0.1:${address.port}`;
 try{
  const lookup={getFile:async({fileId}:{fileId:string})=>({url:root+'/'+fileId})};
  await assert.doesNotReject(()=>verifyRegisteredMedia('correct',bytes,lookup));
  for(const id of ['wrong','missing','extra'])await assert.rejects(()=>verifyRegisteredMedia(id,bytes,lookup),/^Error: MEDIA_REGISTERED_MISMATCH$/);
  await assert.rejects(()=>verifyRegisteredMedia('correct',Buffer.from('short'),lookup),/MEDIA_REGISTERED_MISMATCH/);
  let queried=false;await assert.rejects(()=>verifyRegisteredMedia('https://invalid-id',bytes,{getFile:async()=>{queried=true;return {url:root};}}),/MEDIA_REGISTERED_MISMATCH/);assert.equal(queried,false);
  await assert.rejects(()=>verifyRegisteredMedia('correct',bytes,{getFile:async()=>{throw Error('https://private.invalid/?sig=synthetic-secret');}}),error=>error instanceof Error&&error.message==='MEDIA_REGISTERED_MISMATCH');
 }finally{await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});}
});
test('来源、用途、候选、图注或字节变化拒绝，授权不能冒充用途核对', () => {
  const {expected,review}=fixture();
  assert.throws(() => requireMediaBindingReview(undefined,expected,bytes),/MEDIA_REVIEW_MISSING_OR_STALE/);
  assert.throws(() => requireMediaBindingReview(review,expected,Buffer.from('changed pixels')),/MEDIA_REVIEW_MISSING_OR_STALE/);
  const changes = [{caseId:'other'},{candidateSha256:digest('other')},{testId:'source-test-1'},
    {captionSha256:digest('other')},{reviewer:''},{reviewedAt:'invalid'},{usageAuthorized:false},{purposeStatus:'unreviewed'},
    {authorization:undefined},{authorization:{...review.authorization,reference:''}},
    {source:{...standalone,locatorSha256:digest('other')}},{source:embedded},
    {source:{...standalone,originalSha256:digest('other')}}];
  for (const change of changes) assert.throws(() => requireMediaBindingReview({...review,...change} as MediaBindingReview,expected,bytes),/MEDIA_REVIEW_MISSING_OR_STALE/);
  const wrong: MediaSource={...standalone,originalSha256:digest('other')};
  assert.throws(() => requireMediaBindingReview({...review,source:wrong},{...expected,source:wrong},bytes),/MEDIA_REVIEW_MISSING_OR_STALE/);
});

test('上传前读原件复核：独立图定位/字节与DOCX真实内嵌条目匹配', () => {
  const locator='D:/private/synthetic/image.png';
  const source: MediaSource={kind:'standalone-image',originalSha256:digest(bytes),locatorSha256:digest(locator)};
  assert.doesNotThrow(()=>verifyMediaOriginal(source,bytes,locator,bytes));
  assert.throws(()=>verifyMediaOriginal(source,bytes,locator+'other',bytes),/MEDIA_SOURCE_MISMATCH/);
  assert.throws(()=>verifyMediaOriginal(source,Buffer.from('other'),locator,bytes),/MEDIA_SOURCE_MISMATCH/);
  const doc=Buffer.from(zipSync({'word/media/image1.png':bytes,'word/media/image2.png':Buffer.from('other')}));
  const embeddedSource: MediaSource={kind:'document-embedded',documentSha256:digest(doc),archiveEntry:'word/media/image1.png'};
  assert.doesNotThrow(()=>verifyMediaOriginal(embeddedSource,doc,'private.docx',bytes));
  assert.throws(()=>verifyMediaOriginal({...embeddedSource,archiveEntry:'word/media/image2.png'},doc,'private.docx',bytes),/MEDIA_SOURCE_MISMATCH/);
  assert.throws(()=>verifyMediaOriginal({...embeddedSource,archiveEntry:'word/media/absent.png'},doc,'private.docx',bytes),/MEDIA_SOURCE_MISMATCH/);
});
