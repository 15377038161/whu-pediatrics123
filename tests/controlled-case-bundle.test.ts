import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { teachingPackageSchema } from '@/domain/teaching-package';
import { syntheticTeacherCase } from './fixtures/teacher-case';
import { decodeControlledCaseBundle, decodeControlledTrainingContent, decodeControlledTrainingMediaArchive, installRecoveredTrainingContent } from '@/lib/controlled-case-bundle';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { registerControlledCase, getControlledCase } from '@/lib/controlled-case-store';
import { getCaseMediaLink } from '@/lib/case-media';
import { readTeachingPackage, teachingPackageVersion } from '@/lib/teaching-package-store';
import type { ControlledTrainingContentReference } from '@/lib/controlled-case-registry';

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
