import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { recordSchema, getTeacherSourceId } from '@/lib/teacher-case-data';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { getControlledCase, registerControlledCase } from '@/lib/controlled-case-store';

import { controlledCaseBundles as bundles, type BundleReference } from '@/lib/controlled-case-registry';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
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
}
