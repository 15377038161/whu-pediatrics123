import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { teachingPackageSchema } from '@/domain/teaching-package';
import { syntheticTeacherCase } from './fixtures/teacher-case';
import { decodeControlledCaseBundle, decodeControlledTrainingContent, decodeControlledTrainingMediaArchive, installRecoveredTrainingContent, ensureControlledCaseBundle,readRecoveredTrainingMedia } from '@/lib/controlled-case-bundle';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { registerControlledCase, getControlledCase } from '@/lib/controlled-case-store';
import { getCaseMediaLink } from '@/lib/case-media';
import { readTeachingPackage, teachingPackageVersion } from '@/lib/teaching-package-store';
import {controlledTrainingContentBundles, type ControlledTrainingContentReference} from '@/lib/controlled-case-registry';
import {defaultCaseVersionDeps,resolveTeacherCaseVersion} from '@/lib/case-version-select';

const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
test('controlled object bundle preserves source version and rejects tampered bytes or wrong identity',()=>{
  const record=syntheticTeacherCase();const bytes=strToU8(JSON.stringify(record));
  const name=`knowledge/teaching-cases/${record.caseId}.json`;
  const version=computeCaseDataVersion(record);
  const manifest={schemaVersion:1,totalSources:1,contentVersion:version,files:[{path:name,bytes:bytes.length,sha256:hash(bytes)}]};
  const zip=zipSync({[name]:bytes,'manifest.json':strToU8(JSON.stringify(manifest))});
  const expected={sourceId:record.caseId,version,sha256:hash(zip)};
  assert.deepEqual(decodeControlledCaseBundle(zip,expected),record);
  assert.throws(()=>decodeControlledCaseBundle(zip,{...expected,sha256:'0'.repeat(64)}),/INTEGRITY/);
  assert.throws(()=>decodeControlledCaseBundle(zip,{...expected,version:'0'.repeat(16)}),/MANIFEST/);
  registerControlledCase(record,version);
  assert.equal(getControlledCase(record.caseId),null,'unbound readers cannot silently choose an uploaded version');
  assert.equal(getControlledCase(record.caseId,'0'.repeat(16)),null,'old sessions never read a new bundle');
  assert.deepEqual(getControlledCase(record.caseId,version),record);
});

test('multi-source recovery binds every source/package version and fails closed on missing or mismatched content',async()=>{
  const source=syntheticTeacherCase();
  const sourceVersion=computeCaseDataVersion(source);
  const sourceBytes=strToU8(JSON.stringify(source));
  const mediaBytes=strToU8('recovered-image-fixture');
  const mediaSha256=hash(mediaBytes);
  const mediaPath=`runtime/media/${mediaSha256}.png`;
  const mediaZip=zipSync({[mediaPath]:mediaBytes});
  const mediaRef={fileId:'synthetic-media-archive',sha256:hash(mediaZip),bytes:mediaZip.length,archive:'media-01.zip'};
  const pack=teachingPackageSchema.parse({
    schemaVersion:1,caseId:source.caseId,sourceId:source.caseId,sourceVersion,version:'pending',relation:'independent',
    title:'合成恢复包',age:source.age,sex:source.sex,reviewStatus:'automated-unreviewed',complaint:source.complaint,
    persona:{appearance:'合成',caregiver:'家长',speaking:'自然',cooperation:'可配合',knowledgeBoundary:'仅已知事实'},
    historyFacts:[],exams:[],tests:[],management:[],referenceNote:{},rubric:[],references:[],
  });
  pack.version=teachingPackageVersion(pack);
  const encode=(value:typeof pack,omitPackage=false):{reference:ControlledTrainingContentReference;zip:Uint8Array}=>{
    const packagePath=`runtime/packages/${value.version}.json`;
    const files:Record<string,Uint8Array>={
      'runtime/index.json':strToU8(JSON.stringify({schemaVersion:1,entries:{[source.caseId]:value.version}})),
      [`source-cases/${source.caseId}.json`]:sourceBytes,
      [packagePath]:strToU8(JSON.stringify(value)),
      [mediaPath]:mediaBytes,
    };
    const manifest={schemaVersion:1,entries:1,sources:1,media:1,files:Object.entries(files).map(([filePath,data])=>({
      path:filePath,bytes:data.length,sha256:hash(data),archive:filePath===mediaPath?'media-01.zip':'content.zip',
    }))};
    files['content-manifest.json']=strToU8(JSON.stringify(manifest));
    if(omitPackage)delete files[packagePath];
    const zip=zipSync(files);
    return {zip,reference:{fileId:'synthetic-content',sha256:hash(zip),bytes:zip.length,archive:'content.zip',media:[mediaRef],expected:{entries:1,sources:1,media:1}}};
  };

  const fixture=encode(pack);
  const decoded=decodeControlledTrainingContent(fixture.zip,fixture.reference);
  assert.equal(decoded.sources.length,1);assert.equal(decoded.packages.length,1);assert.equal(decoded.media.size,1);
  assert.throws(()=>decodeControlledTrainingContent(fixture.zip,{...fixture.reference,sha256:'0'.repeat(64)}),/INTEGRITY/);
  const missing=encode(pack,true);
  assert.throws(()=>decodeControlledTrainingContent(missing.zip,missing.reference),/FILE_MISSING/);
  const wrongSource=teachingPackageSchema.parse({...pack,sourceVersion:'0'.repeat(16),version:'pending'});
  wrongSource.version=teachingPackageVersion(wrongSource);
  const mismatch=encode(wrongSource);
  assert.throws(()=>decodeControlledTrainingContent(mismatch.zip,mismatch.reference),/SOURCE_VERSION/);
  const descriptor=decoded.media.get(mediaSha256)!;
  assert.deepEqual(decodeControlledTrainingMediaArchive(mediaZip,mediaRef,descriptor),mediaBytes);
  assert.throws(()=>decodeControlledTrainingMediaArchive(mediaZip,{...mediaRef,sha256:'0'.repeat(64)},descriptor),/INTEGRITY/);

  registerControlledCase(source,sourceVersion);
  assert.equal(readTeachingPackage(source.caseId,undefined,sourceVersion),null);
  const previousRegistry=controlledTrainingContentBundles.splice(0,controlledTrainingContentBundles.length,fixture.reference);
  const previousRecovery=process.env.PEDIATRICS_TRAINING_RECOVERY;
  process.env.PEDIATRICS_TRAINING_RECOVERY='object-storage';
  let archiveReads=0;
  const loadArchive=async(fileId:string)=>{assert.equal(fileId,fixture.reference.fileId);archiveReads++;return fixture.zip;};
  try{
    await ensureControlledCaseBundle(source.caseId,sourceVersion,loadArchive);
    assert.equal(readTeachingPackage(source.caseId,undefined,sourceVersion)?.version,pack.version,'warm source must not suppress independent teaching installation');
    await ensureControlledCaseBundle(source.caseId,sourceVersion,loadArchive);
    await ensureControlledCaseBundle(source.caseId,'0'.repeat(16),loadArchive);
    assert.equal(archiveReads,1,'verified generation must not redownload for absent historical bindings');
    const previousRoot=process.env.PEDIATRICS_KNOWLEDGE_ROOT;
    const emptyRoot=mkdtempSync(path.join(os.tmpdir(),'peds-empty-source-'));
    process.env.PEDIATRICS_KNOWLEDGE_ROOT=emptyRoot;
    try{
      assert.equal(defaultCaseVersionDeps.getLocalImportVersion(source.caseId),sourceVersion,'cold sandbox resolves a recomputed private source before unverified DB latest');
      const resolution=await resolveTeacherCaseVersion(source.caseId,{accessToken:'synthetic-never-transmitted',role:'student',isPreview:false},{...defaultCaseVersionDeps,getActiveCaseVersion:async()=> '0'.repeat(16)});
      assert.equal(resolution.version,'0'.repeat(16),'explicit publication binding still wins; never replace legacy active versions');
      assert.equal(resolution.source,'active');
    }finally{
      if(previousRoot===undefined)delete process.env.PEDIATRICS_KNOWLEDGE_ROOT;else process.env.PEDIATRICS_KNOWLEDGE_ROOT=previousRoot;
      rmSync(emptyRoot,{recursive:true,force:true});
    }
  }finally{
    controlledTrainingContentBundles.splice(0,controlledTrainingContentBundles.length,...previousRegistry);
    if(previousRecovery===undefined)delete process.env.PEDIATRICS_TRAINING_RECOVERY;else process.env.PEDIATRICS_TRAINING_RECOVERY=previousRecovery;
  }
  installRecoveredTrainingContent(decoded,fixture.reference);
  assert.deepEqual(getControlledCase(source.caseId,sourceVersion),source);
  assert.equal(getControlledCase(source.caseId,'0'.repeat(16)),null);
  assert.equal(readTeachingPackage(source.caseId,pack.version,sourceVersion)?.version,pack.version);
  assert.equal(readTeachingPackage(source.caseId,pack.version,'0'.repeat(16)),null);
  assert.equal(readTeachingPackage(source.caseId,'0'.repeat(20)),null);

  const root=mkdtempSync(path.join(os.tmpdir(),'peds-recovered-media-'));
  const previous=process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT;
  process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT=root;
  try{
    const link=await getCaseMediaLink(`training-media:${mediaSha256}`);
    assert.ok(link.url.startsWith('data:image/png;base64,'));
    await assert.rejects(()=>getCaseMediaLink(`training-media:${'0'.repeat(64)}`),/FILE_UNAVAILABLE/);
  }finally{
    if(previous===undefined)delete process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT;else process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT=previous;
    rmSync(root,{recursive:true,force:true});
  }
});

test('a shared media archive validates all registered members, coalesces reads and caches verified pixels privately',async()=>{
  const bytes=[strToU8('first-group-image'),strToU8('second-group-image')];
  const descriptors=bytes.map(raw=>({sha256:hash(raw),path:`runtime/media/${hash(raw)}.png`,bytes:raw.length,archive:'synthetic-two-images.zip',fileId:`training-media:${hash(raw)}`}));
  const zip=zipSync(Object.fromEntries(descriptors.map((item,i)=>[item.path,bytes[i]])));
  const reference={fileId:'synthetic-two-images',sha256:hash(zip),bytes:zip.length,archive:'synthetic-two-images.zip'};
  installRecoveredTrainingContent({sources:[],packages:[],entries:{},media:new Map(descriptors.map(item=>[item.sha256,item])),embeddedMedia:new Map()},{...reference,media:[reference]});
  const root=mkdtempSync(path.join(os.tmpdir(),'peds-shared-media-'));
  const previous=process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT;process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT=root;
  let calls=0;
  try{
    const load=async(id:string)=>{assert.equal(id,reference.fileId);calls++;return zip;};
    const values=await Promise.all(descriptors.map(item=>readRecoveredTrainingMedia(item.fileId,load)));
    assert.equal(calls,1);assert.deepEqual(values,bytes);
    for(const [i,item] of descriptors.entries()){
      assert.deepEqual(new Uint8Array(readFileSync(path.join(root,'media',`${item.sha256}.png`))),bytes[i]);
      assert.ok((await getCaseMediaLink(item.fileId)).url.startsWith('data:image/png;base64,'));
    }
  }finally{
    if(previous===undefined)delete process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT;else process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT=previous;
    rmSync(root,{recursive:true,force:true});
  }
});

test('identical verified media can be reused across generation archives without weakening conflict checks',()=>{
  const raw=strToU8('same-pixels-across-controlled-generations');
  const sha256=hash(raw);
  const descriptor={sha256,path:`runtime/media/${sha256}.png`,bytes:raw.length,archive:'generation-a.zip',fileId:`training-media:${sha256}`};
  const reference=(archive:string,fileId:string):ControlledTrainingContentReference=>({
    fileId,sha256:hash(strToU8(fileId)),bytes:1,archive:'content.zip',
    media:[{fileId:`${fileId}-media`,sha256:hash(strToU8(archive)),bytes:1,archive}],
    expected:{entries:0,sources:0,media:1},
  });
  const content=(media:typeof descriptor)=>({sources:[],packages:[],entries:{},media:new Map([[media.sha256,media]]),embeddedMedia:new Map()});
  installRecoveredTrainingContent(content(descriptor),reference(descriptor.archive,'generation-a'));
  assert.doesNotThrow(()=>installRecoveredTrainingContent(content({...descriptor,archive:'generation-b.zip'}),reference('generation-b.zip','generation-b')));
  assert.throws(()=>installRecoveredTrainingContent(content({...descriptor,archive:'generation-c.zip',bytes:descriptor.bytes+1}),reference('generation-c.zip','generation-c')),/TRAINING_CONTENT_MEDIA_CONFLICT/);
});
