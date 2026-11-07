import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { teachingPackageSchema, type TeachingPackage } from '@/domain/teaching-package';
import { resolveCaseId } from '@/lib/case-identity';

export function teachingPackageVersion(value:Omit<TeachingPackage,'version'>|TeachingPackage):string {
  const {version: _version,...content}=value as TeachingPackage;
  void _version;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0,20);
}

const recoveredPackages=new Map<string,TeachingPackage>();
let recoveredIndex:Record<string,string>={};

/** Install only packages whose content hash and source binding were verified by the recovery decoder. */
export function registerRecoveredTeachingPackages(packages:TeachingPackage[],entries:Record<string,string>):void {
  const nextPackages=new Map(recoveredPackages);
  for(const record of packages){
    const selected=record.version;
    if(!/^[a-f0-9]{20}$/.test(selected)||teachingPackageVersion(record)!==selected)throw new Error('TEACHING_PACKAGE_VERSION_INVALID');
    if(entries[record.caseId]!==selected)throw new Error('TEACHING_PACKAGE_INDEX_INVALID');
    const existing=nextPackages.get(selected);
    if(existing&&JSON.stringify(existing)!==JSON.stringify(record))throw new Error('TEACHING_PACKAGE_VERSION_CONFLICT');
    nextPackages.set(selected,record);
  }
  const nextIndex={...recoveredIndex};
  for(const [caseId,selected] of Object.entries(entries)){
    if(!nextPackages.has(selected)||nextPackages.get(selected)?.caseId!==caseId)throw new Error('TEACHING_PACKAGE_INDEX_INVALID');
    nextIndex[caseId]=selected;
  }
  recoveredPackages.clear();for(const [key,value] of nextPackages)recoveredPackages.set(key,value);
  recoveredIndex=nextIndex;
}

function validRecoveredPackage(internalId:string,selected:string|undefined,sourceVersion?:string|null):TeachingPackage|null {
  if(!selected||!/^[a-f0-9]{20}$/.test(selected))return null;
  const record=recoveredPackages.get(selected);
  if(!record||record.caseId!==internalId||teachingPackageVersion(record)!==selected)return null;
  if(sourceVersion&&sourceVersion!==record.sourceVersion)return null;
  return record;
}

/** Private content installation. Missing content never enables a synthetic fallback on the real platform. */
export function readTeachingPackage(caseId:string,version?:string|null,sourceVersion?:string|null):TeachingPackage|null {
  const internalId=resolveCaseId(caseId);
  const selected=version||recoveredIndex[internalId];
  const recovered=validRecoveredPackage(internalId,selected,sourceVersion);
  if(recovered)return recovered;
  // An explicitly bound recovered version must never fall through to a different local generation.
  if(version&&recoveredPackages.has(version))return null;
  try {
    const root=path.resolve(process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT||path.join(process.cwd(),'knowledge','training-packages'));
    let localSelected=version;
    if(!localSelected){
      const index=JSON.parse(readFileSync(path.join(root,'index.json'),'utf8')) as {entries:Record<string,string>};
      localSelected=index.entries[internalId];
    }
    if(!localSelected||!/^\w{20}$/.test(localSelected))return null;
    const raw=JSON.parse(readFileSync(path.join(root,'packages',`${localSelected}.json`),'utf8')) as TeachingPackage;
    const record=teachingPackageSchema.parse(raw);
    if(record.caseId!==internalId||record.version!==localSelected||teachingPackageVersion(raw)!==localSelected)return null;
    if(sourceVersion&&sourceVersion!==record.sourceVersion)return null;
    return record;
  }catch{return null;}
}
