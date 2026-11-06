import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CaseAnalysisBlock, SessionState, TrainingReport } from '../src/domain/agent';
import { CaseAnalysisSection } from '../src/components/case-analysis-section';
import { groundCaseAnswerKey, type CaseAnswerKeyRecord } from '../src/domain/case-analysis';
import type { PointJudgementMap } from '../src/domain/diagnosis-answer';
import { gradeCaseAnalysis, type CaseAnalysisCaseInput } from '../src/lib/case-analysis-ai';
import {
  CASE_ANALYSIS_DEFAULT_CASE_ID,
  caseAnalysisCaseIds,
  isCaseAnalysisCase,
  isCaseAnalysisEnabled,
} from '../src/lib/case-analysis-config';
import { attachCaseAnalysis } from '../src/lib/case-analysis-report';
import { dkaFullJudgements, dkaGeneratedKey, dkaSource } from './fixtures/dka-case-analysis';

const DKA = CASE_ANALYSIS_DEFAULT_CASE_ID;

function makeInput(): CaseAnalysisCaseInput {
  return {
    caseId: DKA,
    version: 'a'.repeat(16),
    sourceName: '1型糖尿病伴有酮症酸中毒',
    age: '6岁',
    sex: '女',
    complaint: '多饮多尿1周，呕吐伴乏力精神差2天',
    sections: dkaSource,
  };
}

function makeRecord(): CaseAnswerKeyRecord {
  const grounded = groundCaseAnswerKey(dkaGeneratedKey, dkaSource);
  assert.ok('key' in grounded);
  return {
    caseId: DKA,
    version: 'a'.repeat(16),
    status: 'auto',
    key: grounded.key,
    model: 'test-model',
    promptVersion: 'case-analysis-v1',
    sourceFingerprint: 'a'.repeat(16),
    generatedAt: '2026-11-06T00:00:00.000Z',
    dropped: grounded.dropped,
  };
}

function makeSession(caseId = DKA): SessionState {
  return {
    caseId,
    sourceSnapshotVersion: null,
    decision: {
      diagnosis: '1型糖尿病伴有酮症酸中毒',
      secondaryDiagnosis: ['维生素D缺乏'],
      summary: '多饮多尿伴呕吐、深大呼吸，血糖和血酮升高。',
      diagnosisBasis: '多饮多尿1周，深大呼吸，血糖32.8mmol/L，血气pH下降，血酮体升高。',
      differentials: '',
    },
    plan: { priority: '补液', detail: '胰岛素静脉泵入、补钾、监测血糖。' },
  } as unknown as SessionState;
}

function makeReport(): TrainingReport {
  return { totalScore: 55, maxScore: 100 } as unknown as TrainingReport;
}

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test('开关默认关闭；病例白名单默认只含 DKA', async () => {
  await withEnv({ CASE_ANALYSIS_ENABLED: undefined, CASE_ANALYSIS_CASE_IDS: undefined }, async () => {
    assert.equal(isCaseAnalysisEnabled(), false);
    assert.equal(isCaseAnalysisCase(DKA), true);
    assert.equal(isCaseAnalysisCase('teacher-川崎病'), false);
    assert.ok(caseAnalysisCaseIds().has(DKA));
  });
  await withEnv({ CASE_ANALYSIS_ENABLED: 'true', CASE_ANALYSIS_CASE_IDS: 'teacher-川崎病, teacher-癫痫' }, async () => {
    assert.equal(isCaseAnalysisEnabled(), true);
    assert.equal(isCaseAnalysisCase('teacher-川崎病'), true);
    assert.equal(isCaseAnalysisCase(DKA), false);
  });
});

test('开关关闭时报告完全不变', async () => {
  await withEnv({ CASE_ANALYSIS_ENABLED: '0', CASE_ANALYSIS_CASE_IDS: undefined }, async () => {
    const report = makeReport();
    await attachCaseAnalysis(report, makeSession(), {
      getKey: async () => makeRecord(),
      readCase: () => makeInput(),
    });
    assert.equal(report.caseAnalysis, undefined);
    assert.equal(report.totalScore, 55);
  });
});

test('DKA 开启时附加影子分，不改旧总分', async () => {
  await withEnv({ CASE_ANALYSIS_ENABLED: '1', CASE_ANALYSIS_CASE_IDS: undefined }, async () => {
    const report = makeReport();
    await attachCaseAnalysis(report, makeSession(), {
      getKey: async () => makeRecord(),
      readCase: () => makeInput(),
      grade: (key, submission) => gradeCaseAnalysis(key, submission, {
        judgements: dkaFullJudgements as PointJudgementMap,
      }),
    });
    assert.equal(report.totalScore, 55);
    assert.equal(report.caseAnalysis?.status, 'scored');
    assert.equal(report.caseAnalysis?.percent, 100);
    assert.equal(report.caseAnalysis?.rawScore, 100);
    assert.equal(report.caseAnalysis?.rawMaxScore, 100);
    assert.equal(report.caseAnalysis?.usedFallback, false);
    assert.ok((report.caseAnalysis?.points?.length ?? 0) > 0);
  });
});

test('诊断与治疗均未提交时仍附加零分明细，不改旧总分', async () => {
  await withEnv({ CASE_ANALYSIS_ENABLED: '1', CASE_ANALYSIS_CASE_IDS: undefined }, async () => {
    const report = makeReport();
    const session = { ...makeSession(), decision: null, plan: null };
    await attachCaseAnalysis(report, session, {
      getKey: async () => makeRecord(),
      readCase: () => makeInput(),
      grade: (key, submission) => gradeCaseAnalysis(key, submission, {
        judgements: dkaFullJudgements as PointJudgementMap,
      }),
    });
    assert.equal(report.totalScore, 55);
    assert.equal(report.caseAnalysis?.status, 'scored');
    assert.equal(report.caseAnalysis?.percent, 0);
    assert.equal(report.caseAnalysis?.rawScore, 0);
    assert.ok(report.caseAnalysis?.points?.some((point) => point.stage === 'plan' && point.status === 'missing'));
  });
});

test('非白名单病例不附加影子分', async () => {
  await withEnv({ CASE_ANALYSIS_ENABLED: '1', CASE_ANALYSIS_CASE_IDS: 'teacher-川崎病' }, async () => {
    const report = makeReport();
    await attachCaseAnalysis(report, makeSession(), {
      getKey: async () => makeRecord(),
      readCase: () => makeInput(),
    });
    assert.equal(report.caseAnalysis, undefined);
  });
});

test('标答未生成时附加 not_assessable，不阻塞报告', async () => {
  await withEnv({ CASE_ANALYSIS_ENABLED: '1', CASE_ANALYSIS_CASE_IDS: undefined }, async () => {
    const report = makeReport();
    await attachCaseAnalysis(report, makeSession(), {
      getKey: async () => null,
      readCase: () => makeInput(),
    });
    assert.equal(report.totalScore, 55);
    assert.equal(report.caseAnalysis?.status, 'not_assessable');
    assert.equal(report.caseAnalysis?.reason, 'KEY_NOT_READY');
  });
});

test('影子分组件渲染试点分、逐点状态与漏项', () => {
  const block: CaseAnalysisBlock = {
    status: 'scored',
    percent: 46,
    rawScore: 46,
    rawMaxScore: 100,
    usedFallback: false,
    disclaimer: '病例分析试点分：不影响主分数。',
    missingPoints: ['诊断依据：缺少「深大呼吸」'],
    points: [
      { section: 'primary', id: 'primary', label: '支气管肺炎', status: 'covered', score: 30, maxScore: 30 },
      { section: 'evidence', id: 'ev-1', label: '发热咳嗽', status: 'missing', score: 0, maxScore: 12.5 },
    ],
  };
  const html = renderToStaticMarkup(createElement(CaseAnalysisSection, { block }));
  assert.ok(html.includes('病例分析 · 试点分'));
  assert.ok(html.includes('46'));
  assert.ok(html.includes('查看漏掉的得分点'));
  assert.ok(html.includes('诊断阶段'));
  assert.ok(html.includes('命中'));
  assert.ok(html.includes('未命中'));
  assert.ok(html.includes('不影响主分数'));
});

test('标答表不可用时附加 STORE_UNAVAILABLE，不抛错', async () => {
  await withEnv({ CASE_ANALYSIS_ENABLED: '1', CASE_ANALYSIS_CASE_IDS: undefined }, async () => {
    const report = makeReport();
    await attachCaseAnalysis(report, makeSession(), {
      getKey: async () => { throw new Error('table missing'); },
      readCase: () => makeInput(),
    });
    assert.equal(report.caseAnalysis?.status, 'not_assessable');
    assert.equal(report.caseAnalysis?.reason, 'STORE_UNAVAILABLE');
  });
});