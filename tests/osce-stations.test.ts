import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RANDOM_OSCE_STATION, formatTimeLimit, getOsceStation, listReadyStations, osceStations, resolveOsceStation,
} from '@/domain/osce-stations';
import { agentTurnSchema } from '@/lib/validation';
import { getCase } from '@/domain/case';

// 站点门控直接吃 allowedActions，写错一个字母就是「学生点了没反应」，所以拿事件 schema 当真值表。
const EVENT_TYPES: readonly string[] = agentTurnSchema.shape.event.options.map((option) => option.shape.type.value);

test('OSCE 改为随机抽例：随机站不绑定病例，页面倒计时与服务端计时同源 15:00', () => {
  assert.equal(RANDOM_OSCE_STATION.caseId, null);
  assert.equal(RANDOM_OSCE_STATION.caseVersion, null);
  assert.equal(RANDOM_OSCE_STATION.ready, true);
  assert.equal(RANDOM_OSCE_STATION.timeLimitSeconds, 900);
  assert.equal(formatTimeLimit(RANDOM_OSCE_STATION.timeLimitSeconds), '15:00');
  assert.ok(RANDOM_OSCE_STATION.capabilityGoals.length >= 3, '开始前不公示能力目标，闭卷就成了黑箱');
  assert.equal(RANDOM_OSCE_STATION.technicalInterruptionPolicy.expiryAction, 'freeze');
  assert.equal(RANDOM_OSCE_STATION.technicalInterruptionPolicy.pausesTimerOnInterruption, false);
});

test('resolveOsceStation 对任何病例都有站点，历史会话不会因站点解绑而失去门控', () => {
  //  retired 合成站绑定的病例已退役，但历史会话仍要能精确匹配到自己的站点定义。
  assert.equal(resolveOsceStation('peds-respiratory-001').stationId, 'osce-station-respiratory-fever');
  assert.equal(resolveOsceStation('peds-respiratory-001').timeLimitSeconds, 480);
  for (const caseId of ['dcdf43acad052794', 'no-such-case', '']) {
    assert.equal(resolveOsceStation(caseId), RANDOM_OSCE_STATION, `${caseId} 落不到随机站就会 fail-closed 锁死`);
  }
  assert.equal(getOsceStation('no-such-case'), null);
});

test('可用站点必须真能开例：要么随机抽，要么绑定的病例在目录里（否则就是「点不进去」）', () => {
  const ready = listReadyStations();
  assert.ok(ready.includes(RANDOM_OSCE_STATION), '随机站没进可用列表，OSCE 入口就是空的');
  for (const station of ready) {
    const boundCaseId = station.caseId;
    if (boundCaseId === null) continue;
    assert.doesNotThrow(() => getCase(boundCaseId), `${station.stationId} 绑定病例取不到，学生点进去必然失败`);
  }
  //  退役合成站只保留定义供历史会话匹配，不得再作为可用站点发布。
  for (const station of osceStations) {
    assert.equal(station.ready, false, `${station.stationId} 是退役合成站，重新发布会把学生送回不存在的病例`);
  }
});

test('allowedActions 全部是真实事件类型，闭卷站仍开放问诊/查体/开单/诊断/处置/沟通与冻结提交', () => {
  for (const station of [...osceStations, RANDOM_OSCE_STATION]) {
    for (const action of station.allowedActions) {
      assert.ok(EVENT_TYPES.includes(action), `${station.stationId} 的 ${action} 不是合法事件类型，服务端会静默拒绝`);
    }
    for (const required of ['ASK_QUESTION', 'EXAM_ACTION', 'ORDER_TEST', 'SUBMIT_DECISION', 'SUBMIT_PLAN', 'SEND_COMMUNICATION', 'NAVIGATE_STAGE', 'FINISH_SESSION'] as const) {
      assert.ok(station.allowedActions.includes(required), `${station.stationId} 缺 ${required}，该阶段无法完成`);
    }
  }
  assert.deepEqual(
    [...RANDOM_OSCE_STATION.allowedActions].sort(),
    [...osceStations[0].allowedActions].sort(),
    '随机站与既有站的开放动作不一致，会让同一套页面文案对两种会话含义不同',
  );
  assert.equal(RANDOM_OSCE_STATION.requiredStages.length, 6);
});
