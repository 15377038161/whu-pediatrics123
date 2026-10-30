import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { recordSchema, getKnowledgeRoot } from '../src/lib/teacher-case-data';
import { TEACHER_CASE_CATALOG } from '../src/domain/teacher-case-catalog';
import { TEACHER_CASE_LINKS } from '../src/domain/teacher-case-links';
import { getCase } from '../src/domain/case';
import { controlledCaseReadiness } from '../src/lib/teacher-case-import';
import { buildCaseInitialization } from './generate-case53-init-sql';

/** Offline only: private source bytes never go to stdout or Git. */
async function main() {
  const [caseId, target] = process.argv.slice(2);
  if (!caseId || !target || !TEACHER_CASE_CATALOG.some(c => c.id === caseId && c.folder) || TEACHER_CASE_LINKS[caseId]) throw new Error('PILOT_SOURCE_REQUIRED');
  const output = path.resolve(target);
  if (!output.startsWith(path.resolve('output') + path.sep) || existsSync(output)) throw new Error('PILOT_NEW_PRIVATE_DIRECTORY_REQUIRED');
  const raw = readFileSync(path.join(getKnowledgeRoot(), 'teaching-cases', `${caseId}.json`));
  const record = recordSchema.parse(JSON.parse(raw.toString('utf8')));
  if (record.caseId !== caseId) throw new Error('PILOT_ID_MISMATCH');
  if(controlledCaseReadiness(record).length)throw new Error('PILOT_SOURCE_INCOMPLETE');
  const built = await buildCaseInitialization(record);
  const runtime = getCase(caseId, built.version);
  if (!runtime.sourceFacts) throw new Error('PILOT_RUNTIME_MISSING');
  const media = [...(record.testMedia ?? []).map(x => ({ action: x.testId, media: x.media })), ...(record.examMedia ?? []).map(x => ({ action: x.examId, media: x.media }))];
  for (const binding of record.testMedia ?? []) if (!runtime.tests.some(t => t.id === binding.testId)) throw new Error('PILOT_TEST_BINDING_INVALID');
  for (const binding of record.examMedia ?? []) if (!runtime.exams.some(e => e.id === binding.examId)) throw new Error('PILOT_EXAM_BINDING_INVALID');
  const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
  const doc = [`# 首例教师核对文档`, `病例版本：${built.version}`, '状态：由既有受控数据生成，尚未完成本轮原件复核、线上及医学验收。',
    `## 基本信息\n\n年龄：${record.age}\n\n性别：${record.sex}\n\n主诉：${record.complaint}`,
    ...Object.entries(record.sections).map(([key,value]) => `## ${key}\n\n${value || '原始材料未提供'}`),
    `## 生命体征\n\n${json(record.vitals)}`, `## 查体方法、部位与体位\n\n${json(record.examRules ?? [])}`, `## 附件绑定\n\n${json(media)}`,
    `## 来源\n\n${json(record.documents.map(d => ({source:d.source,sha256:d.sha256})))}`,
    '## 核对要求\n\n逐项回看原件的数值、单位、时点及附件用途；缺项不得补正常值。修订运行JSON后重新制作包，禁止只改本文件后宣称生效。'].join('\n\n');
  const files: Record<string, Uint8Array> = {
    [`knowledge/teaching-cases/${caseId}.json`]: raw,
    'teacher-review.md': strToU8(doc),
    'private-import.sql': strToU8(built.sql),
    'bindings.json': strToU8(json(media)),
    'pilot-definition.json': strToU8(json({schemaVersion:1, entryId:caseId, sourceId:caseId, contentVersion:built.version, mode:'guided', relatedEntries:Object.entries(TEACHER_CASE_LINKS).filter(([,x])=>x.sourceId===caseId).map(([id])=>id), requiredAcceptance:['A01','A02','A03','A04','A05','A06','A07','A08','A09','A10','A11'], activationAllowed:false, externalObjectsVerified:false})),
  };
  const manifest = {schemaVersion:1, contentVersion:built.version, totalSources:1, files:Object.entries(files).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})), externalFileIds:[...new Set(media.flatMap(x=>x.media.map(m=>m.fileId)))], unresolved:['original-source-review','object-readback-and-decode','controlled-migrations-and-import','entry-scoped-version-selection','real-account-browser-and-device-acceptance']};
  files['manifest.json'] = strToU8(json(manifest));
  mkdirSync(output, {recursive:true});
  for (const [name,bytes] of Object.entries(files)) {const file=path.join(output,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,bytes,{mode:0o600,flag:'wx'});}
  const zip=zipSync(files);writeFileSync(path.join(output,'pilot-case.zip'),zip,{mode:0o600,flag:'wx'});
  writeFileSync(path.join(output,'receipt.json'),json({contentVersion:built.version,files:Object.keys(files).length,externalObjects:manifest.externalFileIds.length,sha256:createHash('sha256').update(zip).digest('hex'),bytes:zip.length,imported:false,activated:false}),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({files:Object.keys(files).length,externalObjects:manifest.externalFileIds.length,contentVersion:built.version,imported:false,activated:false}));
}
void main().catch(()=>{console.error('PILOT_BUNDLE_FAILED');process.exitCode=1;});
