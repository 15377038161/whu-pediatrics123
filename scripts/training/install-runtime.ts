/** Verify every private archive before writing an immutable, isolated local generation. No database writes. */
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {unzipSync} from 'fflate';
import {decodeControlledTrainingContent,decodeControlledTrainingMediaArchiveSet} from '../../src/lib/controlled-case-bundle';
import type {ControlledArchiveReference,ControlledTrainingContentReference} from '../../src/lib/controlled-case-registry';

const [archiveDirectory,targetDirectory,...flags]=process.argv.slice(2);
if(!archiveDirectory||!targetDirectory||flags.some(value=>value!=='--verify-only'))throw new Error('Usage: install-runtime <archive-directory> <new-knowledge-generation-directory> [--verify-only]');
const archiveRoot=path.resolve(archiveDirectory),target=path.resolve(targetDirectory),knowledge=path.resolve('knowledge');
if(!target.startsWith(knowledge+path.sep)||target===knowledge)throw new Error('INSTALL_TARGET_OUTSIDE_PRIVATE_KNOWLEDGE');
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(readFileSync(path.join(archiveRoot,'peds-training-upload-manifest.json'),'utf8')) as {schemaVersion:number;generation:string;contentArchive:string;entries:number;sources:number;media:number;archives:Array<{file:string;bytes:number;sha256:string}>};
if(manifest.schemaVersion!==1||manifest.entries!==67||manifest.sources!==53||!/^[a-f0-9]{20}$/.test(manifest.generation)||!Array.isArray(manifest.archives))throw new Error('UPLOAD_MANIFEST_INVALID');
const archiveNames=new Set<string>();
for(const item of manifest.archives){
  if(!/^peds-training-(?:content|media)-[a-f0-9]{20}(?:-\d{2})?\.zip$/.test(item.file)||archiveNames.has(item.file)||!Number.isSafeInteger(item.bytes)||item.bytes<1||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('UPLOAD_MANIFEST_INVALID');
  archiveNames.add(item.file);
}
const reference=(name:string):ControlledArchiveReference=>{
  const item=manifest.archives.find(value=>value.file===name);
  if(!item)throw new Error('ARCHIVE_NOT_DECLARED');
  return {fileId:`local-install:${name}`,archive:name,bytes:item.bytes,sha256:item.sha256};
};
const contentReference:ControlledTrainingContentReference={...reference(manifest.contentArchive),media:manifest.archives.filter(item=>item.file!==manifest.contentArchive).map(item=>reference(item.file)),expected:{entries:manifest.entries,sources:manifest.sources,media:manifest.media}};
const contentBytes=readFileSync(path.join(archiveRoot,manifest.contentArchive));
const decoded=decodeControlledTrainingContent(contentBytes,contentReference);
const media=new Map<string,Uint8Array>();
for(const ref of contentReference.media){
  const descriptors=[...decoded.media.values()].filter(item=>item.archive===ref.archive);
  const loaded=decodeControlledTrainingMediaArchiveSet(readFileSync(path.join(archiveRoot,ref.archive)),ref,descriptors);
  for(const [digest,bytes] of loaded)media.set(digest,bytes);
}
if(media.size!==decoded.media.size)throw new Error('INSTALL_MEDIA_INCOMPLETE');
const files=new Map<string,Uint8Array>();
files.set('content-manifest.json',unzipSync(contentBytes)['content-manifest.json']);
for(const source of decoded.sources)files.set(`source-cases/${source.caseId}.json`,Buffer.from(JSON.stringify(source,null,2)));
for(const pack of decoded.packages)files.set(`runtime/packages/${pack.version}.json`,Buffer.from(JSON.stringify(pack,null,2)));
for(const [digest,bytes] of media)files.set(`runtime/media/${digest}.png`,bytes);
const index=Buffer.from(JSON.stringify({schemaVersion:1,entries:decoded.entries},null,2));
if(hash(index).slice(0,20)!==manifest.generation)throw new Error('INSTALL_GENERATION_INVALID');
// Reject conflicts before writing any file. Index is finalized only after every payload file.
files.set('runtime/index.json',index);
for(const [name,bytes] of files){
  const file=path.resolve(target,name);
  if(!file.startsWith(target+path.sep))throw new Error('INSTALL_PATH_INVALID');
  if(existsSync(file)&&hash(readFileSync(file))!==hash(bytes))throw new Error('INSTALL_EXISTING_GENERATION_CONFLICT');
}
if(!flags.includes('--verify-only'))for(const [name,bytes] of files){
  const file=path.join(target,name);mkdirSync(path.dirname(file),{recursive:true});
  if(!existsSync(file))writeFileSync(file,bytes,{flag:'wx',mode:0o600});
}
console.log(JSON.stringify({mode:flags.includes('--verify-only')?'verified-only':'installed',generation:manifest.generation,entries:decoded.packages.length,sources:decoded.sources.length,media:media.size,files:files.size,databaseWrites:false}));
