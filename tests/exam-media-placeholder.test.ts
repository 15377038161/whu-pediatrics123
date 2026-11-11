import './fixtures/legacy-engine-catalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClinicalEvent } from '@/domain/agent';
import type { CaseIntake } from '@/domain/case-intake';
import { createInitialSession } from '@/lib/agent-engine';
import { SharedCaseRecord } from '@/components/shared-case-record';

const PLACEHOLDER = '本例未提供实拍图';

function event(id: string, type: ClinicalEvent['type'], summary: string, media?: ClinicalEvent['media']): ClinicalEvent {
  return { id, clientEventId: id, type, stage: 'exam', summary, correct: null, evidenceCodes: [`EV-${id}`], media, createdAt: '2026-11-05T10:00:00.000Z' };
}

function render(events: ClinicalEvent[]): string {
  const session = createInitialSession('exam-placeholder-probe', 'immersive');
  session.events.push(...events);
  return renderToStaticMarkup(createElement(SharedCaseRecord, { session, onOpenNote: () => undefined }));
}

test('查体记录无媒体时如实说明未提供实拍图，不留白', () => {
  const html = render([event('e1', 'EXAM_ACTION', '肺部听诊：双肺可闻及细湿啰音')]);
  assert.ok(html.includes(PLACEHOLDER), '无图查体结果必须给出诚实说明，否则留白会被误读为加载失败');
  assert.ok(html.includes('双肺可闻及细湿啰音'), '文字结果照常展示');
});

test('查体记录已释放媒体时不再声明未提供实拍图', () => {
  const html = render([event('e2', 'EXAM_ACTION', '咽喉视诊：咽部充血', [{ fileId: 'file-1', kind: 'image', caption: '咽部示意图' }])]);
  assert.ok(!html.includes(PLACEHOLDER), '有图时不得再声称未提供实拍图');
});

test('诚实占位只用于查体，问诊与辅助检查条目不受影响', () => {
  const html = render([
    event('h1', 'ASK_QUESTION', '依据病例正文回答：发热多久了'),
    event('t1', 'ORDER_TEST', '血常规：白细胞 12.3×10⁹/L'),
  ]);
  assert.ok(!html.includes(PLACEHOLDER), '辅助检查结果多为文字/报告，不套用查体口径');
});

test('共享病例记录不再渲染独立接诊基本信息模块，但保留生命体征', () => {
  const session = createInitialSession('exam-placeholder-probe', 'immersive');
  session.caseOptions = {
    sourceName: '测试病例', age: '8岁', sex: '女', hasSource: true, exams: [], tests: [],
    intake: { initialVitals: [{ code: 'spo2', sourceLocator: 'source.vitals.spo2' }] } as CaseIntake,
  };
  const html = renderToStaticMarkup(createElement(SharedCaseRecord, { session, onOpenNote: () => undefined }));
  assert.ok(html.includes('生命体征'));
  assert.equal(html.includes('接诊基本信息'), false);
  assert.equal(html.includes('case-intake-summary'), false);
});
