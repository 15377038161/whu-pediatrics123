import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { syntheticTeacherCase } from './fixtures/teacher-case';
import { decodeControlledCaseBundle } from '@/lib/controlled-case-bundle';
import { computeCaseDataVersion } from '@/lib/case-data-version';
import { registerControlledCase, getControlledCase } from '@/lib/controlled-case-store';

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
