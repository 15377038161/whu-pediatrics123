import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentMessage, ClinicalEvent, SessionState } from '@/domain/agent';
import { extractVitalSigns, resolveDisplayedVitals } from '@/domain/vital-signs';

function event(overrides: Partial<ClinicalEvent>): ClinicalEvent {
  return {
    id: crypto.randomUUID(),
    clientEventId: crypto.randomUUID(),
    type: 'EXAM_ACTION',
    stage: 'exam',
    summary: '',
    correct: true,
    evidenceCodes: ['EX_TEMP'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function message(overrides: Partial<AgentMessage>): AgentMessage {
  return {
    id: crypto.randomUUID(),
    actor: 'student',
    content: '',
    emotion: 'calm',
    kind: 'dialogue',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function sessionWith(vitals: SessionState['vitals'], events: ClinicalEvent[] = [], messages: AgentMessage[] = []): Pick<SessionState, 'vitals' | 'events' | 'messages'> {
  return { vitals, events, messages };
}

test('查体原文提取：T/R/P 与 SpO₂ 分别落位，心率不会被误认成呼吸频率', () => {
  assert.deepEqual(extractVitalSigns('4.查体：T 36.4℃，R 32次/分，P135次/分，神清，双肺呼吸音稍粗。'), {
    temperature: 36.4,
    heartRate: 135,
    respiratoryRate: 32,
  });
  assert.deepEqual(extractVitalSigns('静息状态SpO₂ 93%，脉搏124次/分。'), { heartRate: 124, spo2: 93 });
  assert.deepEqual(extractVitalSigns('SPO2 维持在97%（给氧时）以上。'), { spo2: 97 });
  assert.deepEqual(extractVitalSigns('教学模拟设定：本次 SpO₂ 读数为 99%，脉率为 90 次/分。'), { spo2: 99 });
  assert.deepEqual(extractVitalSigns('经皮血氧饱和度 91%，HR 148次/分，RR 44次/分'), {
    heartRate: 148,
    respiratoryRate: 44,
    spo2: 91,
  });
});

test('问诊原文提取：家长说「最高烧到39度」也能得到体温，但不从无单位文字猜数值', () => {
  assert.deepEqual(extractVitalSigns('最高烧到39度呢，烧的时候还打哆嗦，吃了退烧药能退下来。'), { temperature: 39 });
  assert.deepEqual(extractVitalSigns('双肺呼吸音稍粗，未闻及啰音。'), {});
  assert.deepEqual(extractVitalSigns('呼吸 32 次/分'), { respiratoryRate: 32 });
});

test('展示合并：本轮查体覆盖接诊记录，问诊值只补空缺，来源逐项标注', () => {
  const question = message({ actor: 'student', content: '体温多少？' });
  const answer = message({ actor: 'parent', content: '最高烧到39度呢。' });
  const historyEvent = event({
    type: 'ASK_QUESTION',
    stage: 'history',
    summary: '依据病例正文回答：体温多少？',
    evidenceCodes: ['SOURCE_HX_2'],
    correct: null,
    createdAt: new Date(Date.now() + 1000).toISOString(),
  });
  const examEvent = event({
    summary: '体温测量：病例记录：T36.4℃',
    measurements: [{metric:'temperature',value:36.4,unit:'℃',method:'耳温',site:'耳部',origin:'source',sourceLocator:'SOURCE_EX_1',sourceTimepoint:null,measuredAt:new Date(Date.now()+2000).toISOString()}],
    createdAt: new Date(Date.now() + 2000).toISOString(),
  });

  const withExam = resolveDisplayedVitals(sessionWith(
    { temperature: null, heartRate: null, respiratoryRate: null, spo2: null },
    [historyEvent, examEvent],
    [question, answer],
  ));
  assert.equal(withExam.temperature.value, 36.4, '本轮实测应覆盖问诊里的最高体温');
  assert.equal(withExam.temperature.source, 'exam');
  assert.deepEqual(withExam.temperature.measurement, examEvent.measurements?.[0]);
  assert.equal(withExam.heartRate.value, null);
  assert.equal(withExam.heartRate.source, null);

  const historyOnly = resolveDisplayedVitals(sessionWith(
    { temperature: null, heartRate: null, respiratoryRate: null, spo2: null },
    [historyEvent],
    [question, answer],
  ));
  assert.deepEqual(historyOnly.temperature, { value: 39, source: 'history' }, '没有实测时应展示问诊已获得的体温并标明来源');

  const initial = resolveDisplayedVitals(sessionWith(
    { temperature: 36.5, heartRate: 137, respiratoryRate: null, spo2: 94 },
    [historyEvent],
    [question, answer],
  ));
  assert.deepEqual(initial.temperature, { value: 36.5, source: 'initial' }, '接诊记录已有的体温不应被问诊里的历史最高值覆盖');
  assert.deepEqual(initial.heartRate, { value: 137, source: 'initial' });
  assert.deepEqual(initial.spo2, { value: 94, source: 'initial' });
  assert.equal(initial.respiratoryRate.value, null);
});

test('失败的查体不产生体征；未获得项目保持 null', () => {
  const blocked = event({ correct: false, summary: 'thermometer×forehead：本病例资料未提供该检查的体征记录', evidenceCodes: [] });
  const displayed = resolveDisplayedVitals(sessionWith(
    { temperature: null, heartRate: null, respiratoryRate: null, spo2: null },
    [blocked],
    [],
  ));
  assert.equal(displayed.temperature.value, null);
  assert.equal(displayed.temperature.source, null);
});

test('教学模拟血氧参与显示与回填，但来源不能冒充原患者实测', () => {
  const simulated = event({
    summary: '手指检查：教学模拟设定：本次 SpO₂ 读数为 99%，脉率为 90 次/分。不是原患者新增实测。',
    measurements: [{metric:'spo2',value:99,unit:'%',method:'固定教学模拟值',site:'手指',origin:'teaching-simulation',sourceLocator:'TEACH_EX_oximeter_finger',sourceTimepoint:null,measuredAt:new Date().toISOString()}],
    evidenceCodes: ['TEACH_EX_oximeter_finger'],
  });
  const displayed = resolveDisplayedVitals(sessionWith(
    { temperature: null, heartRate: null, respiratoryRate: null, spo2: null },
    [simulated],
    [],
  ));
  assert.equal(displayed.spo2.value, 99);
  assert.equal(displayed.spo2.source, 'simulation');
  assert.deepEqual(displayed.spo2.measurement, simulated.measurements?.[0]);
});