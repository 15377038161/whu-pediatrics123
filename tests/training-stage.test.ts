import test from 'node:test';
import assert from 'node:assert/strict';
import { isStandaloneCommunicationPractice, stageForTrainingNavigation } from '../src/domain/training-stage';

test('普通引导、OSCE与沉浸式训练把内部沟通阶段归一到病史沟通入口', () => {
  for (const mode of ['guided', 'osce', 'immersive'] as const) {
    assert.equal(stageForTrainingNavigation('communication', mode), 'history');
    assert.equal(stageForTrainingNavigation('history', mode), 'history');
    assert.equal(stageForTrainingNavigation('exam', mode), 'exam');
  }
});

test('专项沟通保留独立阶段，其他专项不错误合并', () => {
  assert.equal(isStandaloneCommunicationPractice('practice', 'communication'), true);
  assert.equal(stageForTrainingNavigation('communication', 'practice', 'communication'), 'communication');
  assert.equal(isStandaloneCommunicationPractice('practice', 'history'), false);
  assert.equal(stageForTrainingNavigation('communication', 'practice', 'history'), 'history');
});
