import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createInitialSession,runAgentTurn} from '@/lib/agent-engine';
import {buildReport} from '@/lib/scoring';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReportView} from '@/components/report-view';
import {readTeacherCaseData} from '@/lib/teacher-case-data';
import {computeCaseDataVersion} from '@/lib/case-data-version';

test('来源病例专项报告只评价开放环节，沟通质量保持未评分，完整接诊不变',async()=>{
 const prefix=path.join(os.tmpdir(),'peds-source-focused-');
 const root=mkdtempSync(prefix);const old=process.env.PEDIATRICS_KNOWLEDGE_ROOT;
 const fixture=process.env.ENABLE_AI_FIXTURE;
 try {
  mkdirSync(path.join(root,'teaching-cases'));
  const id='teacher-肝豆状核变性';
  writeFileSync(path.join(root,'teaching-cases',id+'.json'),JSON.stringify({caseId:id,sourceName:'合成工程病例',sourceDocument:'synthetic.txt',age:'5岁',sex:'女',complaint:'合成主诉',
   sections:{history:'患儿，女童，5岁。合成病史。',exam:'胸部：合成查体所见。',tests:'血常规：合成结果。',diagnosis:'合成诊断',plan:'合成处置'},
   vitals:{temperature:null,heartRate:null,respiratoryRate:null,spo2:null},documents:[],
   testRelease:[{testId:'source-test-0',availableFromStage:'assessment'}]}));
  process.env.PEDIATRICS_KNOWLEDGE_ROOT=root;process.env.ENABLE_AI_FIXTURE='true';
  const communication=createInitialSession('isolated-engine','practice',id,'communication');
  await runAgentTurn(communication,{type:'SEND_COMMUNICATION',data:{text:'我理解您的担心，具体情况需要进一步评估，我们会说明下一步安排。'}},'communication');
  const commReport=buildReport(communication);
  assert.equal(commReport.assessableMaxScore,0);
  assert.deepEqual(commReport.evaluatedAbilities,['communication']);
  assert.equal(commReport.unscored,true);
  assert.equal(commReport.evidence.find(e=>e.code==='SOURCE_PROCESS_communication')?.status,'not_assessable');
  assert.equal(commReport.improvements.length,0,'不因未开放的问诊、查体、诊断和处置扣分');
  assert.ok(commReport.studentSubmissions?.communication);
  const html=renderToStaticMarkup(createElement(ReportView,{report:commReport,readonly:true}));
  assert.equal((html.match(/class="dimension"/g)||[]).length,1);
  assert.ok(html.includes('无法评价')&&html.includes('专项过程记录'));
  const history=createInitialSession('isolated-engine','practice',id,'history');
  await runAgentTurn(history,{type:'ASK_QUESTION',data:{text:'孩子多大，是什么性别？'}},'history');
  const report=buildReport(history);
  assert.deepEqual(report.evaluatedAbilities,['history']);
  assert.equal(report.assessableMaxScore,25);
  assert.equal(report.abilities.examination,0);
  assert.equal(report.evidence.filter(e=>e.maxScore>0).length,1);
  const full=buildReport(createInitialSession('isolated-engine','guided',id));
  assert.equal(full.assessableMaxScore,100,'完整接诊原有过程分口径保持');
  assert.equal(full.unscored,undefined);
  const emptyHtml=renderToStaticMarkup(createElement(ReportView,{report:full,readonly:true}));
  assert.ok(emptyHtml.includes('本病例的信息采集复盘'),'尚未取得记录时也必须展示采集缺口');
  assert.ok(emptyHtml.includes('教学机制图'),'教学图不依赖计分操作事件');
  assert.ok(emptyHtml.includes('本次未申请'));
  assert.ok(!emptyHtml.includes('<h2>本轮已获得的图片</h2>'),'没有媒体事件时不展示空图片栏目');
  const mediaOnly={...full,sourceSnapshotVersion:computeCaseDataVersion(readTeacherCaseData(id)!),releasedMediaEventIds:['synthetic-unscored-media-event']};
  assert.ok(renderToStaticMarkup(createElement(ReportView,{report:mediaOnly,readonly:true})).includes('正在读取本轮已获得的图片'),'媒体释放与是否计分分别判断');
  const pending=createInitialSession('isolated-engine','immersive',id);
  await runAgentTurn(pending,{type:'ORDER_TEST',data:{testId:'source-test-0'}},'pending-result');
  const pendingReport=buildReport(pending);
  assert.equal(pendingReport.collectionReview?.find(item=>item.area==='tests')?.acquisitionStatus,'requested_unavailable');
  assert.equal(pendingReport.collectionReview?.find(item=>item.area==='tests')?.collected,0);
  const pendingHtml=renderToStaticMarkup(createElement(ReportView,{report:pendingReport,readonly:true}));
  assert.ok(pendingHtml.includes('沉浸式病例教学')&&!pendingHtml.includes('引导训练'));
  assert.ok(pendingHtml.includes('已申请，但尚无已取得的结果证据'));
  assert.ok(pendingHtml.includes('不将其认定为漏做或解释错误'));
  pending.orderedTests=[];
  assert.equal(pendingReport.collectionReview?.find(item=>item.area==='tests')?.acquisitionStatus,'requested_unavailable','报告按生成时状态冻结');
 } finally {
  if(old===undefined)delete process.env.PEDIATRICS_KNOWLEDGE_ROOT;else process.env.PEDIATRICS_KNOWLEDGE_ROOT=old;
  if(fixture===undefined)delete process.env.ENABLE_AI_FIXTURE;else process.env.ENABLE_AI_FIXTURE=fixture;
  assert.ok(path.resolve(root).startsWith(path.resolve(prefix)));
  rmSync(root,{recursive:true,force:true});
 }
});
