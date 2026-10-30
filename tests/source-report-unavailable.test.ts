import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createInitialSession } from '@/lib/agent-engine';
import { buildReport } from '@/lib/scoring';

process.env.PEDIATRICS_KNOWLEDGE_ROOT=path.resolve('tests/fixtures/knowledge');

test('bound source recovery failure preserves submissions and never becomes a zero-score assessment',()=>{
  const session=createInitialSession('synthetic-student','guided','teacher-肾病综合征',undefined,'ffffffffffffffff');
  session.decision={diagnosis:'合成提交',summary:'合成摘要',diagnosisBasis:'合成诊断依据仅供测试',differentials:'合成鉴别'};
  const report=buildReport(session);
  assert.equal(report.unscored,true);
  assert.equal(report.assessableMaxScore,0);
  assert.equal(report.studentDecision?.diagnosis,'合成提交');
  assert.deepEqual(report.improvements,[]);
  assert.ok(report.evidence.every(item=>item.score===0 && item.maxScore===0));
  assert.match(report.unscoredReason!,/绑定版本.*未能读取/);
  assert.ok(!report.recommendation.includes('暂无独立原始病历'));
});

test('available source retains normal process scoring even when student omits tasks',()=>{
  const session=createInitialSession('synthetic-student','guided','teacher-肾病综合征');
  const report=buildReport(session);
  assert.equal(report.unscored,undefined);
  assert.equal(report.assessableMaxScore,100);
  assert.ok(report.improvements.length>0);
});
