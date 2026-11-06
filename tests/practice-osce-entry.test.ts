import assert from 'node:assert/strict';
import test from 'node:test';
import { practiceDeepLink } from '@/components/report-view';
import { practiceScenarios } from '@/domain/practice-scenarios';
import { RANDOM_OSCE_STATION } from '@/domain/osce-stations';
import { createSessionSchema } from '@/lib/validation';
import { PRACTICE_FOCUS_VALUES, type PracticeFocus, type TrainingReport } from '@/domain/agent';

type DimensionKey = keyof TrainingReport['abilities'];

/** 会话创建 schema 实际接受的 focus 集合：不读内部结构，直接拿请求探，避免只测到字面量而不是服务端行为。 */
function schemaAcceptsFocus(focus: string): boolean {
  return createSessionSchema.safeParse({ mode: 'practice', caseId: 'case-a', focus, clientRequestId: crypto.randomUUID() }).success;
}

function focusOf(href: string): string | null {
  return new URL(href, 'http://probe.local').searchParams.get('focus');
}

test('报告深链带上原病例，学生不必自己找是哪一例', () => {
  const href = practiceDeepLink('teacher-川崎病', ['examination']);
  assert.equal(new URL(href, 'http://probe.local').pathname, '/student/practice');
  assert.equal(new URL(href, 'http://probe.local').searchParams.get('case'), 'teacher-川崎病');
  assert.equal(focusOf(href), 'exam', 'examination 维度必须映射到 exam 专项，映射错就是把学生送进不相干训练');
});

test('深链只认排名最高且有对应专项的维度，没有专项的维度跳过而不是硬塞', () => {
  assert.equal(focusOf(practiceDeepLink('case-a', ['reasoning', 'professionalism', 'safety'])), 'safety');
  assert.equal(focusOf(practiceDeepLink('case-a', ['professionalism', 'communication'])), 'communication');
  assert.equal(focusOf(practiceDeepLink('case-a', ['history', 'examination'])), 'history', '排名更高的维度优先');
  // 病史缺口项与报告快照缺口项的 dimension 为 null，不得参与专项推荐。
  assert.equal(focusOf(practiceDeepLink('case-a', [null, 'examination'])), 'exam');
});

test('六维全都没有对应专项时只带病例，不编造 focus 参数', () => {
  const href = practiceDeepLink('case-a', ['reasoning', 'professionalism', null]);
  assert.equal(href, '/student/practice?case=case-a');
  assert.equal(focusOf(href), null, '带上 focus=reasoning 会 404 到不存在的专项');
  assert.equal(practiceDeepLink('case-a', []), '/student/practice?case=case-a');
});

test('病例标识进 URL 前必须编码，含 & 或中文的 id 不能截断查询串', () => {
  const href = practiceDeepLink('teacher-肺炎支原体肺炎&x=1', ['history']);
  assert.ok(!href.includes('teacher-肺炎支原体肺炎&x=1'), '未编码的 & 会把 focus 参数吃掉');
  assert.equal(new URL(href, 'http://probe.local').searchParams.get('case'), 'teacher-肺炎支原体肺炎&x=1');
  assert.equal(focusOf(href), 'history');
});

test('深链里的 focus 同时被训练页白名单与会话创建 schema 接受，否则页面能点、服务端会拒', () => {
  for (const dimension of ['history', 'examination', 'safety', 'communication'] as DimensionKey[]) {
    const focus = focusOf(practiceDeepLink('case-a', [dimension]));
    assert.ok(focus, `${dimension} 没有产出 focus`);
    assert.ok((PRACTICE_FOCUS_VALUES as readonly string[]).includes(focus), `${focus} 不在训练页白名单，?focus= 会被静默丢弃`);
    assert.equal(schemaAcceptsFocus(focus), true, `${focus} 被创建 schema 拒绝，服务端 400`);
  }
  // 六维里另两维没有专项，深链也不会产出它们；万一产出必须被两端同时挡住。
  for (const invalid of ['reasoning', 'professionalism', '']) {
    assert.equal((PRACTICE_FOCUS_VALUES as readonly string[]).includes(invalid), false, invalid);
    assert.equal(schemaAcceptsFocus(invalid), false, `${invalid} 竟然被创建 schema 接受`);
  }
});

test('专项卡片的四个 focus 与场景目录、创建 schema 枚举三方一致，不会出现点得到却开不了的卡片', () => {
  assert.deepEqual(Object.keys(practiceScenarios).sort(), [...PRACTICE_FOCUS_VALUES].sort(), '场景目录与专项枚举不同步，卡片会渲染出 undefined 标题');
  for (const focus of PRACTICE_FOCUS_VALUES) {
    assert.equal(schemaAcceptsFocus(focus), true, `${focus} 有卡片有场景，但创建请求被拒`);
    assert.ok(practiceScenarios[focus as PracticeFocus].title.length > 0, `${focus} 场景没有标题`);
  }
});

test('专项与 OSCE 的随机抽例请求都不带 caseId，抽中前页面与地址栏无法预告病种', () => {
  for (const [mode, focus] of [['osce', undefined], ['practice', 'exam']] as Array<[string, PracticeFocus | undefined]>) {
    const payload = { mode, random: true, focus, excludeCaseId: undefined, allowRepeat: false, clientRequestId: crypto.randomUUID() };
    assert.equal('caseId' in payload, false, `${mode} 入口自带 caseId 就不是随机抽例`);
    const parsed = createSessionSchema.safeParse(payload);
    assert.equal(parsed.success, true, `${mode} 随机入口请求被 schema 拒绝：${JSON.stringify(parsed.error?.issues)}`);
    assert.equal(createSessionSchema.safeParse({ ...payload, caseId: 'case-a' }).success, false, `${mode} 随机与指定病例必须互斥`);
  }
});

test('OSCE 随机站不绑定病例，页面倒计时取的就是站点契约里的时限', () => {
  assert.equal(RANDOM_OSCE_STATION.caseId, null);
  assert.equal(RANDOM_OSCE_STATION.caseVersion, null);
  assert.equal(RANDOM_OSCE_STATION.ready, true, '随机站未发布，OSCE 入口就是空的（正是「点不进去」的成因）');
  assert.ok(RANDOM_OSCE_STATION.timeLimitSeconds >= 600, '时限短于 10 分钟不够走完六个阶段');
});
