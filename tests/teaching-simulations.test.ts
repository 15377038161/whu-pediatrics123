import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import illustrations from '../src/domain/case-teaching-illustrations.json';
import {readFileSync,existsSync} from 'node:fs';
import {readTeacherCaseData} from '../src/lib/teacher-case-data';
import {computeCaseDataVersion} from '../src/lib/case-data-version';
import {getCase} from '../src/domain/case';
import {createInitialSession,runAgentTurn} from '../src/lib/agent-engine';
import {getCaseMediaLink,findReleasedMedia} from '../src/lib/case-media';
import {buildReport} from '../src/lib/scoring';
import {admissionProfile} from '../src/lib/case-admission';
import {getPublicCase} from '../src/domain/case-catalog';
import {isScorableCase,classifyCase} from '../src/domain/case-classification';
import {publicCaseId} from '../src/lib/case-identity';
const cases=['teacher-支气管肺炎','teacher-新生儿脑梗死','teacher-格林巴利综合征'];

test('三例无原件入口具有明确模拟来源、完整结构和同版本门控，不把旧版本换成新患者',()=>{
 for(const id of cases){
  const record=readTeacherCaseData(id);assert.ok(record?.teachingSimulation);
  assert.equal(record.documents.length,0);assert.ok(Object.values(record.sections).every(s=>s.trim().length>60));
  const version=computeCaseDataVersion(record);assert.equal(readTeacherCaseData(id,version)?.caseId,id);
  assert.equal(readTeacherCaseData(id,'unmatched-historical-version'),null);
  assert.notEqual(version,computeCaseDataVersion({...record,teachingSimulation:undefined}));
  assert.match(admissionProfile(getPublicCase(publicCaseId(id))).subtitle,/AI教学模拟/);
  assert.equal(isScorableCase(getPublicCase(publicCaseId(id))),true);
  assert.equal(classifyCase(getPublicCase(publicCaseId(id))).readiness.label,'教学模拟');
 }
});

test('三例真实引擎：问诊→所有适用查体/检查→诊断处置沟通→报告及JSON恢复，教学图仅随对应操作释放',async()=>{
 const old=process.env.ENABLE_AI_FIXTURE;process.env.ENABLE_AI_FIXTURE='true';
 try{for(const id of cases){
  const source=readTeacherCaseData(id)!;const version=computeCaseDataVersion(source);
  const session=createInitialSession('isolated-teaching-test','immersive',id,undefined,version);session.sourceSnapshotVersion=version;
  assert.equal(session.caseOptions?.teachingSimulation,true);
  assert.equal(session.caseOptions?.complaint,source.complaint);
  assert.equal(session.caseOptions?.sourceName,'AI教学模拟病例');
  const definition=getCase(id,version,session.id);
  const media=source.testMedia![0].media[0];assert.equal(findReleasedMedia(session,media.fileId),null);
  await runAgentTurn(session,{type:'ASK_QUESTION',data:{text:'孩子多大，是男孩还是女孩，病程有什么变化？'}},'hx');
  for(const exam of definition.exams) await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:exam.toolId,bodyPartId:exam.bodyPartId,posture:'supine'}},exam.id);
  for(const check of definition.tests) await runAgentTurn(session,{type:'ORDER_TEST',data:{testId:check.id}},check.id);
  assert.ok(findReleasedMedia(session,media.fileId));
  const link=await getCaseMediaLink(media.fileId);assert.ok(existsSync('public'+link.url));
  assert.equal(readFileSync('public'+link.url).subarray(1,4).toString(),'PNG');
  await runAgentTurn(session,{type:'SUBMIT_DECISION',data:{diagnosis:'教学场景提交',summary:'依据已取得的证据完成工程验证',diagnosisBasis:'已采集病史、完成适用查体并取得本病例检查结果，本提交仅检验字段保存，不代表临床质量已审核',differentials:'需结合已有检查比较'}},'dx');
  await runAgentTurn(session,{type:'SUBMIT_PLAN',data:{priority:'评估及监测',detail:'教学计划保存验证，并说明复评与升级处理条件'}},'plan');
  await runAgentTurn(session,{type:'SEND_COMMUNICATION',data:{text:'我理解您的担心，将说明当前问题、检查结果和下一步评估及复评安排。'}},'comm');
  await runAgentTurn(session,{type:'FINISH_SESSION',data:{}},'finish');
  const report=buildReport(session,'teaching-report');assert.equal(report.sourceSnapshotVersion,version);
  const mediaEvent=session.events.find(e=>e.media?.some(m=>m.fileId===media.fileId));assert.ok(mediaEvent);assert.ok(report.releasedMediaEventIds?.includes(mediaEvent.id));
  const restored=JSON.parse(JSON.stringify(session));assert.ok(findReleasedMedia(restored,media.fileId));
  assert.equal(buildReport(restored,'restored').totalScore,report.totalScore);
  if(id.includes('新生儿'))assert.ok(!session.messages.some(m=>m.actor==='child'&&m.kind==='dialogue'));
 }}finally{if(old===undefined)delete process.env.ENABLE_AI_FIXTURE;else process.env.ENABLE_AI_FIXTURE=old;}
});

test('非登记教学图不能转成任意本地或外部URL',async()=>{
 await assert.rejects(()=>getCaseMediaLink('teaching-illustration:v1:../../secret'),/FILE_UNAVAILABLE/);
});


test('来源病例报告给出具体采集覆盖，不因问过一次就称病史完整，不在复盘泄露整份病史',async()=>{
 const old=process.env.ENABLE_AI_FIXTURE;process.env.ENABLE_AI_FIXTURE='true';
 try{
  const record=readTeacherCaseData(cases[0])!;const session=createInitialSession('coverage-test','guided',cases[0],undefined,computeCaseDataVersion(record));
  const initial=buildReport(session,'before');assert.ok(initial.collectionReview?.some(item=>item.area==='history'&&item.collected===0));
  const reply=await runAgentTurn(session,{type:'ASK_QUESTION',data:{text:'孩子主要症状是什么？'}},'complaint-only');
  assert.deepEqual(session.askedIntents,['SOURCE_HX_-2']);assert.ok(!reply.newMessages.some(m=>m.content.includes('足月顺产')));
  const report=buildReport(session,'after');assert.equal(report.totalScore,25);
  assert.ok(report.improvements.some(item=>item.includes('病史记录待核对')));
  assert.ok(!JSON.stringify(report.collectionReview).includes(record.sections.history));
  const def=getCase(cases[0]);await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:'hand-hygiene',bodyPartId:'hands'}},'prepare');
  const exam=def.exams.find(e=>e.evidenceCode!=='EX_PREP')!;
  await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId:exam.toolId,bodyPartId:exam.bodyPartId,posture:'supine'}},'specific-exam');
  const after=buildReport(session,'exam');assert.ok(after.collectionReview?.some(item=>item.area==='exam'&&item.collected===1&&item.eventIds.length>0));
 }finally{if(old===undefined)delete process.env.ENABLE_AI_FIXTURE;else process.env.ENABLE_AI_FIXTURE=old;}
});

test('70病例教学图登记完整、字节指纹一致；只用本地概念素材，不伪造临床影像',()=>{
 assert.equal(Object.keys(illustrations).length,70);
 for(const entry of Object.values(illustrations)){
  assert.match(entry.url,/^\/media\/teaching\/v1\/[a-z0-9-]+\.(png|svg)$/);
  const bytes=readFileSync('public'+entry.url);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  assert.match(entry.caption,/非真实患者影像/);
  if(entry.url.endsWith('.svg'))assert.ok(!/<script|foreignObject|https?:/i.test(bytes.toString().replace('http:\/\/www.w3.org/2000/svg','')));
 }
 const record=readTeacherCaseData(cases[0])!;const session=createInitialSession('figure-test','guided',cases[0],undefined,computeCaseDataVersion(record));
 const report=buildReport(session,'snapshot');assert.deepEqual(report.learningIllustration,illustrations[cases[0] as keyof typeof illustrations]);
});
