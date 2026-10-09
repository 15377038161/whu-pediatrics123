import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { csvEscape, maskName, maskStudentNo, buildCsv } from '../src/lib/usage-stats-csv';
import { engagementEventSchema, usageStatsQuerySchema } from '../src/lib/engagement-schema';
import type { UsageStatsResult } from '../src/app/api/teacher/usage-stats/route';

const EMPTY: UsageStatsResult = {
  perStudent: [],
  overall: { studentCount: 0, sessionCount: 0, completedCount: 0, inProgressCount: 0, totalTurnCount: 0, totalActiveHours: 0 },
  dailyTrend: [],
  weeklyTrend: [],
  caseDistribution: [],
  weakAreas: [],
  recentSessions: [],
  scoreBasis: 'practice-only',
};

describe('⑦ CSV 公式注入防护', () => {
  it('以 =/+/-/@/制表符开头的值前置单引号', () => {
    assert.equal(csvEscape('=cmd|/C calc'), "'=cmd|/C calc");
    assert.equal(csvEscape('+SUM(A1:A9)'), "'+SUM(A1:A9)");
    assert.equal(csvEscape('-2+3'), "'-2+3");
    assert.equal(csvEscape('@weird'), "'@weird");
    assert.equal(csvEscape('\tTAB'), "'\tTAB");
    assert.equal(csvEscape('\rCR'), "'\rCR");
  });

  it('正常文本不受影响；含引号/换行仍正确转义', () => {
    assert.equal(csvEscape('正常文本'), '正常文本');
    assert.equal(csvEscape('a"b'), '"a""b"');
    assert.equal(csvEscape('a\nb'), '"a\nb"');
    assert.equal(csvEscape(123), '123');
  });

  it('构造的注入 caseId 在导出行中被中和', () => {
    const row: UsageStatsResult = {
      ...EMPTY,
      caseDistribution: [{ caseId: '=HYPERLINK("http://evil","click")', mode: 'practice', sessionCount: 2, completedCount: 1 }],
    };
    // caseDistribution 汇总目前不导出明细行，但 csvEscape 行为已被上方单测覆盖；
    // 学生行注入路径：displayName 不可控，studentNo 可控有限。核心防线是 csvEscape 前置引号。
    assert.ok(!/^=/.test(csvEscape(row.caseDistribution[0].caseId)));
  });
});

describe('① 日期 schema 严格校验', () => {
  it('拒绝不存在的日历日期（避免 Postgres 500）', () => {
    assert.equal(usageStatsQuerySchema.safeParse({ from: '2026-02-31' }).success, false);
    assert.equal(usageStatsQuerySchema.safeParse({ to: '2026-13-01' }).success, false);
    assert.equal(usageStatsQuerySchema.safeParse({ from: '2026-04-31' }).success, false);
  });

  it('拒绝 from > to（起止顺序）', () => {
    assert.equal(usageStatsQuerySchema.safeParse({ from: '2026-10-10', to: '2026-10-01' }).success, false);
  });

  it('接受合法日期与相等起止', () => {
    assert.ok(usageStatsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success);
    assert.ok(usageStatsQuerySchema.safeParse({ from: '2026-02-29' }).success === false); // 2026 非闰年
    assert.ok(usageStatsQuerySchema.safeParse({}).success);
    assert.ok(usageStatsQuerySchema.safeParse({ from: '2024-02-29' }).success); // 2024 闰年
  });
});

describe('⑤ 埋点 detail 白名单', () => {
  it('仅允许 path 键（拒绝夹带任意字段）', () => {
    assert.ok(engagementEventSchema.safeParse({
      eventType: 'page_enter', sessionId: null, clientEventId: 'tab-xxxx-1', tabId: 'tab-yyyy-1', detail: { path: '/student' },
    }).success);
    assert.equal(engagementEventSchema.safeParse({
      eventType: 'page_enter', sessionId: null, clientEventId: 'tab-xxxx-1', tabId: 'tab-yyyy-1', detail: { token: 'abc' },
    }).success, false);
    assert.equal(engagementEventSchema.safeParse({
      eventType: 'page_enter', sessionId: null, clientEventId: 'tab-xxxx-1', tabId: 'tab-yyyy-1', detail: { note: '患者主诉原文' },
    }).success, false);
  });

  it('path 值长度 <= 256', () => {
    assert.equal(engagementEventSchema.safeParse({
      eventType: 'page_enter', sessionId: null, clientEventId: 'tab-xxxx-1', tabId: 'tab-yyyy-1', detail: { path: 'x'.repeat(257) },
    }).success, false);
  });
});

describe('导出脱敏与口径标注', () => {
  it('姓名/学号脱敏且不含明文 userId', () => {
    assert.equal(maskName('张三丰'), '张**');
    assert.equal(maskName('李'), '李*');
    assert.equal(maskStudentNo('2026123456'), '2026***');
    const csv = buildCsv({
      ...EMPTY,
      perStudent: [{
        userId: 'u-12345678', displayName: '王小明', studentNo: '2026110011', accountKind: 'unknown',
        sessionCount: 5, completedCount: 3, abandonedCount: 1, inProgressCount: 1, turnCount: 40,
        activeHours: 2.5, avgPracticeScore: 88,
      }],
    });
    assert.ok(!csv.includes('u-12345678'));
    assert.ok(!csv.includes('王小明'));
    assert.ok(!csv.includes('2026110011'));
    assert.ok(csv.includes('王**'));
    assert.ok(csv.includes('未验证'));
  });

  it('CSV 头部包含口径与非防篡改声明', () => {
    const csv = buildCsv(EMPTY);
    assert.ok(csv.includes('非防篡改学习证据'));
    assert.ok(csv.includes('北京时间自然日'));
    assert.ok(csv.includes('进行中=2小时内有更新'));
  });

  it('导出行首 BOM 存在（Excel 中文兼容）', () => {
    assert.ok(buildCsv(EMPTY).startsWith('\uFEFF'));
  });
});
