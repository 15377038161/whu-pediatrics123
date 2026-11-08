/** Fetch only a code-registered immutable generation; no credential input, arbitrary fileId or DB writes. */
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {StorageClient} from 'coder-coding-dev-sdk';
import {controlledTrainingContentBundles} from '../../src/lib/controlled-case-registry';

const [generation,outputDirectory]=process.argv.slice(2);
if(!/^[a-f0-9]{20}$/.test(generation||'')||!outputDirectory)throw new Error('Usage: fetch-runtime <registered-generation> <private-knowledge-archive-directory>');
const root=path.resolve(outputDirectory),knowledge=path.resolve('knowledge');
if(!root.startsWith(knowledge+path.sep))throw new Error('FETCH_TARGET_OUTSIDE_PRIVATE_KNOWLEDGE');
const reference=controlledTrainingContentBundles.find(item=>item.archive===`peds-training-content-${generation}.zip`);
if(!reference||!reference.expected)throw new Error('UNREGISTERED_TRAINING_GENERATION');
const hash=(raw:Uint8Array)=>createHash('sha256').update(raw).digest('hex');
async function main(){
  const storage=new StorageClient();let fetched=0,reused=0;
  const archives=[...reference!.media,reference!];
  for(const item of archives){
    if(path.basename(item.archive)!==item.archive)throw new Error('REGISTERED_PATH_INVALID');
    const file=path.join(root,item.archive);
    if(existsSync(file)){
      const bytes=readFileSync(file);
      if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw new Error('EXISTING_ARCHIVE_CONFLICT');
      reused++;continue;
    }
    const bytes=await storage.readFile({fileId:item.fileId});
    if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw new Error('REMOTE_ARCHIVE_INTEGRITY_FAILED');
    mkdirSync(root,{recursive:true});writeFileSync(file,bytes,{flag:'wx',mode:0o600});fetched++;
  }
  const manifest=JSON.stringify({schemaVersion:1,generation,contentArchive:reference!.archive,...reference!.expected,archives:archives.map(item=>({file:item.archive,bytes:item.bytes,sha256:item.sha256}))},null,2);
  const file=path.join(root,'peds-training-upload-manifest.json');
  if(existsSync(file)&&readFileSync(file,'utf8')!==manifest)throw new Error('EXISTING_UPLOAD_MANIFEST_CONFLICT');
  if(!existsSync(file))writeFileSync(file,manifest,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({generation,fetched,reused,remoteArchiveIntegrity:'passed',...reference!.expected,databaseWrites:false}));
}
void main();
