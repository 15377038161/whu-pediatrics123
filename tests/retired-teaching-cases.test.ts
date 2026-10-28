import test from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {CASE_CATALOG} from '@/domain/case-catalog';import {TEACHER_CASE_CATALOG} from '@/domain/teacher-case-catalog';
import {publicCaseId,isTrainableCase} from '@/lib/case-identity';import {readTeacherCaseData} from '@/lib/teacher-case-data';import {getLocalImportVersion} from '@/lib/teacher-case-import';
import {getCase} from '@/domain/case';import {createInitialSession,runAgentTurn} from '@/lib/agent-engine';import {computeCaseDataVersion} from '@/lib/case-data-version';import {listReadyStations} from '@/domain/osce-stations';
import illustrations from '@/domain/case-teaching-illustrations.json';import {syntheticTeacherCase,withSyntheticTeacherCase} from './fixtures/teacher-case';
const retired=['teacher-支气管肺炎','teacher-新生儿脑梗死','teacher-格林巴利综合征'];

test('三例AI独立病例从有效目录/新建各模式/回退/导入移除，身份映射保留',()=>{
 assert.equal(TEACHER_CASE_CATALOG.length,67);
 for(const id of retired){assert.ok(publicCaseId(id).startsWith('case-'));assert.equal(isTrainableCase(id),false);assert.ok(!CASE_CATALOG.some(x=>x.id===publicCaseId(id)));assert.ok(!TEACHER_CASE_CATALOG.some(x=>x.id===id));assert.equal(readTeacherCaseData(id),null);assert.equal(getLocalImportVersion(id),null);
  for(const mode of ['guided','immersive','osce','practice'] as const)assert.throws(()=>createInitialSession('synthetic',mode,id,mode==='practice'?'history':undefined),/CASE_NOT_FOUND/);
  assert.ok(!listReadyStations().some(x=>x.caseId===id||x.caseId===publicCaseId(id)));
 }
 assert.equal(existsSync('src/domain/teaching-simulations.json'),false);
});

test('已停用病例精确旧版可读；当前同名文件不删除、不回退，历史会话拒绝新操作',async()=>withSyntheticTeacherCase(async root=>{
 const id=retired[0],old=syntheticTeacherCase({caseId:id,teachingSimulation:true}),version=computeCaseDataVersion(old),dir=path.join(root,'teaching-case-versions',id);mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,version+'.json'),JSON.stringify(old));
 const current=path.join(root,'teaching-cases',id+'.json');writeFileSync(current,JSON.stringify({...old,teachingSimulation:undefined,complaint:'保留的同名真实资料占位，不作原患者事实'}));
 const before=readFileSync(current);assert.equal(readTeacherCaseData(id),null);assert.deepEqual(readTeacherCaseData(id,version),old);assert.equal(getCase(id,version).sourceFacts?.caseId,id);assert.equal(readTeacherCaseData(id,'0000000000000000'),null);assert.deepEqual(readFileSync(current),before);
 const historical=createInitialSession('synthetic','immersive','teacher-川崎病');historical.caseId=id;historical.sourceSnapshotVersion=version;const frozen=structuredClone(historical);
 await assert.rejects(()=>runAgentTurn(historical,{type:'ASK_QUESTION',data:{text:'合成问题'}},'retired'),/CASE_RETIRED/);assert.deepEqual(historical,frozen);
 assert.throws(()=>createInitialSession('synthetic','immersive',id,undefined,version),/CASE_NOT_FOUND/);
}));

test('现行67入口概念图指纹完整，退役原URL保留供历史报告回放',()=>{
 assert.equal(Object.keys(illustrations).length,67);
 for(const item of Object.values(illustrations)){assert.equal(createHash('sha256').update(readFileSync('public'+item.url)).digest('hex'),item.sha256);assert.match(item.caption,/非真实患者影像/);}
 for(const id of retired)assert.ok(!(id in illustrations));
 for(const name of ['pneumonia','neonatal-stroke','gbs'])assert.ok(existsSync(`public/media/teaching/v1/${name}.png`));
});
