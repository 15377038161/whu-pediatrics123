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

/** Private local content installation. Missing content never enables a synthetic fallback on the real platform. */
export function readTeachingPackage(caseId:string,version?:string|null,sourceVersion?:string|null):TeachingPackage|null {
  try {
    const root=path.resolve(process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT||path.join(process.cwd(),'knowledge','training-packages'));
    const internalId=resolveCaseId(caseId);
    let selected=version;
    if(!selected){
      const index=JSON.parse(readFileSync(path.join(root,'index.json'),'utf8')) as {entries:Record<string,string>};
      selected=index.entries[internalId];
    }
    if(!selected||!/^\w{20}$/.test(selected))return null;
    const raw=JSON.parse(readFileSync(path.join(root,'packages',`${selected}.json`),'utf8')) as TeachingPackage;
    const record=teachingPackageSchema.parse(raw);
    if(record.caseId!==internalId||record.version!==selected||teachingPackageVersion(raw)!==selected)return null;
    if(sourceVersion&&sourceVersion!==record.sourceVersion)return null;
    return record;
  }catch{return null;}
}
