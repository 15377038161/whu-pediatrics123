import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {strFromU8,unzipSync} from 'fflate';
import {decodeControlledTrainingContent} from '../../src/lib/controlled-case-bundle';
import {registerControlledCase} from '../../src/lib/controlled-case-store';
import {computeCaseDataVersion} from '../../src/lib/case-data-version';
import {registerRecoveredTeachingPackages,teachingPackageVersion} from '../../src/lib/teaching-package-store';
import {teachingPackageSchema,type TeachingPackage} from '../../src/domain/teaching-package';
import type {ControlledTrainingContentReference} from '../../src/lib/controlled-case-registry';

export interface LocalStageOneRuntime {
  packages:TeachingPackage[];
  entries:Record<string,string>;
  sources:number;
  sourceArchiveSha256:string;
}

/** Decode the controlled source archive, then replace only its teaching generation with the verified new runtime. */
export function installLocalStageOne(contentArchive:string,runtimeRoot:string):LocalStageOneRuntime {
  const bytes=readFileSync(contentArchive);
  const sourceArchiveSha256=createHash('sha256').update(bytes).digest('hex');
  const archiveManifest=JSON.parse(strFromU8(unzipSync(bytes)['content-manifest.json'])) as {entries:number;sources:number;media:number};
  const reference:ControlledTrainingContentReference={
    fileId:`local-stage-one:${sourceArchiveSha256}`,archive:path.basename(contentArchive),bytes:bytes.length,sha256:sourceArchiveSha256,
    media:[],expected:{entries:archiveManifest.entries,sources:archiveManifest.sources,media:archiveManifest.media},
  };
  const decoded=decodeControlledTrainingContent(bytes,reference);
  const sourceVersions=new Map<string,string>();
  for(const source of decoded.sources){
    const version=computeCaseDataVersion(source);sourceVersions.set(source.caseId,version);registerControlledCase(source,version);
  }
  const index=JSON.parse(readFileSync(path.join(runtimeRoot,'index.json'),'utf8')) as {schemaVersion:number;entries:Record<string,string>};
  if(index.schemaVersion!==1||Object.keys(index.entries).length!==67)throw new Error('STAGE_ONE_INDEX_INVALID');
  const packages:TeachingPackage[]=[];
  const versions=new Set<string>();
  for(const [caseId,version] of Object.entries(index.entries)){
    const raw=JSON.parse(readFileSync(path.join(runtimeRoot,'packages',`${version}.json`),'utf8')) as TeachingPackage;
    const pack=teachingPackageSchema.parse(raw);
    if(pack.caseId!==caseId||pack.version!==version||teachingPackageVersion(pack)!==version||versions.has(version))throw new Error(`STAGE_ONE_PACKAGE_INVALID:${caseId}`);
    if(sourceVersions.get(pack.sourceId)!==pack.sourceVersion)throw new Error(`STAGE_ONE_SOURCE_VERSION_INVALID:${caseId}`);
    versions.add(version);packages.push(pack);
  }
  registerRecoveredTeachingPackages(packages,index.entries);
  process.env.PEDIATRICS_TRAINING_PACKAGE_ROOT=runtimeRoot;
  return {packages,entries:index.entries,sources:decoded.sources.length,sourceArchiveSha256};
}
