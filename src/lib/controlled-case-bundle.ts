import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import type { TeachingPackage } from '@/domain/teaching-package';
import { teachingPackageSchema } from '@/domain/teaching-package';
import { recordSchema, getTeacherSourceId, type TeacherCaseData } from '@/lib/teacher-case-data';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { getControlledCase, registerControlledCase } from '@/lib/controlled-case-store';
import { readTeachingPackage, registerRecoveredTeachingPackages, teachingPackageVersion } from '@/lib/teaching-package-store';
import {
  controlledCaseBundles as bundles,
  controlledTrainingContentBundles,
  type BundleReference,
  type ControlledArchiveReference,
  type ControlledTrainingContentReference,
} from '@/lib/controlled-case-registry';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const safePath=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')&&!value.split('/').includes('..');

export function decodeControlledCaseBundle(bytes: Uint8Array, expected: Pick<BundleReference,'sourceId'|'version'|'sha256'>) {
  if (bytes.length > 8_000_000 || digest(bytes) !== expected.sha256) throw new Error('CASE_BUNDLE_INTEGRITY_FAILED');
  const files = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  if (manifest.schemaVersion !== 1 || manifest.totalSources !== 1 || manifest.contentVersion !== expected.version || !Array.isArray(manifest.files)) throw new Error('CASE_BUNDLE_MANIFEST_INVALID');
  for (const file of manifest.files) {
    const data = files[file.path];
    if (!data || data.length !== file.bytes || digest(data) !== file.sha256) throw new Error('CASE_BUNDLE_INTEGRITY_FAILED');
  }
  const record = recordSchema.parse(JSON.parse(strFromU8(files[`knowledge/teaching-cases/${expected.sourceId}.json`])));
  if (record.caseId !== expected.sourceId || computeCaseDataVersion(record) !== expected.version) throw new Error('CASE_BUNDLE_VERSION_INVALID');
  return record;
}

interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
  archive: string;
}

export interface RecoveredTrainingMedia extends ManifestFile {
  fileId: string;
}

export interface RecoveredTrainingContent {
  entries: Record<string,string>;
  sources: TeacherCaseData[];
  packages: TeachingPackage[];
  media: Map<string,RecoveredTrainingMedia>;
  embeddedMedia: Map<string,Uint8Array>;
}

function contentJson(bytes:Uint8Array|undefined):unknown {
  if(!bytes)throw new Error('TRAINING_CONTENT_FILE_MISSING');
  try{return JSON.parse(strFromU8(bytes));}catch{throw new Error('TRAINING_CONTENT_JSON_INVALID');}
}

function verifyArchiveReference(bytes:Uint8Array,expected:ControlledArchiveReference,maxBytes:number,code:string):void {
  if(bytes.length>maxBytes||bytes.length!==expected.bytes||digest(bytes)!==expected.sha256)throw new Error(code);
}

/**
 * Decode the multi-source format without changing the legacy single-source decoder above.
 * Every source and teaching package is rebound by its own computed version before installation.
 */
export function decodeControlledTrainingContent(bytes:Uint8Array,expected:ControlledTrainingContentReference):RecoveredTrainingContent {
  verifyArchiveReference(bytes,expected,64_000_000,'TRAINING_CONTENT_INTEGRITY_FAILED');
  let files:Record<string,Uint8Array>;
  try{files=unzipSync(bytes);}catch{throw new Error('TRAINING_CONTENT_INTEGRITY_FAILED');}
  const manifest=contentJson(files['content-manifest.json']) as {
    schemaVersion?:unknown;entries?:unknown;sources?:unknown;media?:unknown;files?:unknown;
  };
  if(manifest.schemaVersion!==1||!Number.isInteger(manifest.entries)||!Number.isInteger(manifest.sources)||!Number.isInteger(manifest.media)||!Array.isArray(manifest.files))throw new Error('TRAINING_CONTENT_MANIFEST_INVALID');
  const counts={entries:manifest.entries as number,sources:manifest.sources as number,media:manifest.media as number};
  if(Object.values(counts).some(value=>value<0)||manifest.files.length!==counts.entries+counts.sources+counts.media+1)throw new Error('TRAINING_CONTENT_MANIFEST_INVALID');
  if(expected.expected&&(counts.entries!==expected.expected.entries||counts.sources!==expected.expected.sources||counts.media!==expected.expected.media))throw new Error('TRAINING_CONTENT_COUNT_INVALID');
  const declared=new Map<string,ManifestFile>();
  for(const value of manifest.files){
    const file=value as Partial<ManifestFile>;
    if(!safePath(file.path)||declared.has(file.path)||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||(file.bytes as number)<0||typeof file.archive!=='string'||!file.archive)throw new Error('TRAINING_CONTENT_MANIFEST_INVALID');
    declared.set(file.path,file as ManifestFile);
  }
  const packagePaths=[...declared.keys()].filter(file=>file.startsWith('runtime/packages/')&&file.endsWith('.json'));
  const sourcePaths=[...declared.keys()].filter(file=>file.startsWith('source-cases/')&&file.endsWith('.json'));
  const mediaPaths=[...declared.keys()].filter(file=>file.startsWith('runtime/media/')&&file.endsWith('.png'));
  if(packagePaths.length!==counts.entries||sourcePaths.length!==counts.sources||mediaPaths.length!==counts.media||declared.size!==packagePaths.length+sourcePaths.length+mediaPaths.length+1||!declared.has('runtime/index.json'))throw new Error('TRAINING_CONTENT_MANIFEST_INVALID');
  for(const [filePath,data] of Object.entries(files)){
    if(filePath==='content-manifest.json')continue;
    const file=declared.get(filePath);
    if(!file||data.length!==file.bytes||digest(data)!==file.sha256)throw new Error('TRAINING_CONTENT_INTEGRITY_FAILED');
  }
  for(const filePath of ['runtime/index.json',...packagePaths,...sourcePaths])if(!files[filePath])throw new Error('TRAINING_CONTENT_FILE_MISSING');

  const index=contentJson(files['runtime/index.json']) as {schemaVersion?:unknown;entries?:unknown};
  if(index.schemaVersion!==1||!index.entries||typeof index.entries!=='object'||Array.isArray(index.entries))throw new Error('TRAINING_CONTENT_INDEX_INVALID');
  const entries=index.entries as Record<string,unknown>;
  if(Object.keys(entries).length!==counts.entries||Object.values(entries).some(version=>typeof version!=='string'||!/^[a-f0-9]{20}$/.test(version)))throw new Error('TRAINING_CONTENT_INDEX_INVALID');

  const sources:TeacherCaseData[]=[];
  const sourceVersions=new Map<string,string>();
  for(const filePath of sourcePaths){
    const record=recordSchema.parse(contentJson(files[filePath]));
    if(filePath!==`source-cases/${record.caseId}.json`||sourceVersions.has(record.caseId))throw new Error('TRAINING_CONTENT_SOURCE_INVALID');
    const version=computeCaseDataVersion(record);
    if(!/^[a-f0-9]{16}$/.test(version))throw new Error('TRAINING_CONTENT_SOURCE_INVALID');
    sourceVersions.set(record.caseId,version);sources.push(record);
  }

  const packages:TeachingPackage[]=[];
  const indexedVersions=new Set<string>();
  for(const filePath of packagePaths){
    const version=filePath.slice('runtime/packages/'.length,-'.json'.length);
    const record=teachingPackageSchema.parse(contentJson(files[filePath]));
    if(record.version!==version||teachingPackageVersion(record)!==version||entries[record.caseId]!==version||indexedVersions.has(version))throw new Error('TRAINING_CONTENT_PACKAGE_INVALID');
    if(sourceVersions.get(record.sourceId)!==record.sourceVersion)throw new Error('TRAINING_CONTENT_SOURCE_VERSION_INVALID');
    indexedVersions.add(version);packages.push(record);
  }
  for(const [caseId,version] of Object.entries(entries)){
    const record=packages.find(item=>item.caseId===caseId&&item.version===version);
    if(!record)throw new Error('TRAINING_CONTENT_INDEX_INVALID');
  }

  const media=new Map<string,RecoveredTrainingMedia>();
  const embeddedMedia=new Map<string,Uint8Array>();
  for(const filePath of mediaPaths){
    const file=declared.get(filePath)!;
    if(filePath!==`runtime/media/${file.sha256}.png`||media.has(file.sha256))throw new Error('TRAINING_CONTENT_MEDIA_INVALID');
    const descriptor={...file,fileId:`training-media:${file.sha256}`};
    media.set(file.sha256,descriptor);
    if(files[filePath])embeddedMedia.set(file.sha256,files[filePath]);
  }
  return {entries:entries as Record<string,string>,sources,packages,media,embeddedMedia};
}

const recoveredMedia=new Map<string,RecoveredTrainingMedia>();
const recoveredMediaArchives=new Map<string,ControlledArchiveReference>();
const mediaCache=new Map<string,Uint8Array>();
const mediaInflight=new Map<string,Promise<Uint8Array|null>>();
const MEDIA_CACHE_LIMIT=12;

function cacheMedia(key:string,bytes:Uint8Array):void {
  mediaCache.delete(key);mediaCache.set(key,bytes);
  while(mediaCache.size>MEDIA_CACHE_LIMIT){const oldest=mediaCache.keys().next().value;if(typeof oldest!=='string')break;mediaCache.delete(oldest);}
}

export function installRecoveredTrainingContent(content:RecoveredTrainingContent,reference:ControlledTrainingContentReference):void {
  const archiveNames=new Set(reference.media.map(item=>item.archive));
  for(const descriptor of content.media.values())if(!archiveNames.has(descriptor.archive)&&!content.embeddedMedia.has(descriptor.sha256))throw new Error('TRAINING_CONTENT_MEDIA_ARCHIVE_MISSING');
  for(const archive of reference.media){
    const existing=recoveredMediaArchives.get(archive.archive);
    if(existing&&(existing.fileId!==archive.fileId||existing.sha256!==archive.sha256||existing.bytes!==archive.bytes))throw new Error('TRAINING_CONTENT_MEDIA_ARCHIVE_CONFLICT');
  }
  for(const record of content.sources)registerControlledCase(record,computeCaseDataVersion(record));
  registerRecoveredTeachingPackages(content.packages,content.entries);
  for(const archive of reference.media)recoveredMediaArchives.set(archive.archive,archive);
  for(const [sha256,descriptor] of content.media){
    const existing=recoveredMedia.get(sha256);
    if(existing&&JSON.stringify(existing)!==JSON.stringify(descriptor))throw new Error('TRAINING_CONTENT_MEDIA_CONFLICT');
    recoveredMedia.set(sha256,descriptor);
    const embedded=content.embeddedMedia.get(sha256);if(embedded)cacheMedia(descriptor.fileId,embedded);
  }
}

export function decodeControlledTrainingMediaArchiveSet(bytes:Uint8Array,reference:ControlledArchiveReference,descriptors:readonly RecoveredTrainingMedia[]):Map<string,Uint8Array> {
  verifyArchiveReference(bytes,reference,128_000_000,'TRAINING_MEDIA_ARCHIVE_INTEGRITY_FAILED');
  if(descriptors.length===0||descriptors.some(descriptor=>reference.archive!==descriptor.archive||!descriptor.fileId.startsWith('training-media:')||descriptor.sha256!==descriptor.fileId.slice('training-media:'.length)))throw new Error('TRAINING_MEDIA_BINDING_INVALID');
  let files:Record<string,Uint8Array>;
  try{files=unzipSync(bytes);}catch{throw new Error('TRAINING_MEDIA_ARCHIVE_INTEGRITY_FAILED');}
  const expectedPaths=new Set(descriptors.map(descriptor=>descriptor.path));
  if(expectedPaths.size!==descriptors.length||Object.keys(files).some(filePath=>!expectedPaths.has(filePath)))throw new Error('TRAINING_MEDIA_ARCHIVE_CONTENT_INVALID');
  const result=new Map<string,Uint8Array>();
  for(const descriptor of descriptors){
    const data=files[descriptor.path];
    if(!data||data.length>3_000_000||data.length!==descriptor.bytes||digest(data)!==descriptor.sha256)throw new Error('TRAINING_MEDIA_INTEGRITY_FAILED');
    result.set(descriptor.sha256,data);
  }
  return result;
}

export function decodeControlledTrainingMediaArchive(bytes:Uint8Array,reference:ControlledArchiveReference,descriptor:RecoveredTrainingMedia):Uint8Array {
  return decodeControlledTrainingMediaArchiveSet(bytes,reference,[descriptor]).get(descriptor.sha256)!;
}

/** Resolve a released image from its exact content manifest and archive; no fileId-only object lookup. */
export async function readRecoveredTrainingMedia(fileId:string):Promise<Uint8Array|null> {
  const cached=mediaCache.get(fileId);if(cached)return cached;
  const sha256=fileId.startsWith('training-media:')?fileId.slice('training-media:'.length):'';
  const descriptor=recoveredMedia.get(sha256);if(!descriptor)return null;
  const reference=recoveredMediaArchives.get(descriptor.archive);if(!reference)return null;
  let task=mediaInflight.get(fileId);
  if(!task){
    task=(async()=>{
      const {StorageClient}=await import('coder-coding-dev-sdk');
      const bytes=await new StorageClient().readFile({fileId:reference.fileId});
      const data=decodeControlledTrainingMediaArchive(bytes,reference,descriptor);
      cacheMedia(fileId,data);return data;
    })();mediaInflight.set(fileId,task);
  }
  try{return await task;}finally{mediaInflight.delete(fileId);}
}

const inflight = new Map<string,Promise<void>>();
export async function ensureControlledCaseBundle(caseId: string, version?: string | null): Promise<void> {
  const sourceId=getTeacherSourceId(caseId);
  for (const ref of bundles.filter(b=>b.sourceId===sourceId && (!version || b.version===version))) {
    if (getControlledCase(sourceId,ref.version)) continue;
    let task=inflight.get(ref.fileId);
    if(!task){
      task=(async()=>{
        const {StorageClient}=await import('coder-coding-dev-sdk');
        const bytes=await new StorageClient().readFile({fileId:ref.fileId});
        registerControlledCase(decodeControlledCaseBundle(bytes,ref),ref.version);
      })();inflight.set(ref.fileId,task);
    }
    try { await task; } finally { inflight.delete(ref.fileId); }
  }
  if(!version||getControlledCase(sourceId,version))return;
  for(const ref of controlledTrainingContentBundles){
    let task=inflight.get(`content:${ref.fileId}`);
    if(!task){
      task=(async()=>{
        const {StorageClient}=await import('coder-coding-dev-sdk');
        const bytes=await new StorageClient().readFile({fileId:ref.fileId});
        installRecoveredTrainingContent(decodeControlledTrainingContent(bytes,ref),ref);
      })();inflight.set(`content:${ref.fileId}`,task);
    }
    try{await task;}finally{inflight.delete(`content:${ref.fileId}`);}
    if(getControlledCase(sourceId,version)&&readTeachingPackage(caseId,version,version))return;
  }
}
