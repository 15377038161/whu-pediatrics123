import assert from 'node:assert/strict';
import test from 'node:test';
import { TEACHER_CASE_LINKS } from '../src/domain/teacher-case-links';
import { TEACHER_CASE_CATALOG } from '../src/domain/teacher-case-catalog';
import {
  filterTrustedRecallCandidates,
  isTrustedSourceTitle,
  trustedSourceTitles,
} from '../src/lib/case-snapshot';

/** 召回来源过滤（失败关闭）合成夹具测试：异源/同源/别名/空标题/无独立来源五类场景。
 *  纯函数测试，不触真实知识库/DB；夹具均为合成文本，无患者内容。 */

test('可信标题派生：仅正文 txt 与同源影像册 pdf 两个精确形态', () => {
  assert.deepEqual(trustedSourceTitles('急性喉炎'), ['急性喉炎.txt', '急性喉炎_完整影像资料册.pdf']);
});

test('精确匹配：同源标题通过，空标题/异源/关键词相近一律拒绝', () => {
  const trusted = trustedSourceTitles('新生儿呼吸窘迫综合征');
  assert.equal(isTrustedSourceTitle('新生儿呼吸窘迫综合征.txt', trusted), true);
  assert.equal(isTrustedSourceTitle('  新生儿呼吸窘迫综合征.txt  ', trusted), true); // trim 后精确
  assert.equal(isTrustedSourceTitle('新生儿呼吸窘迫综合征_完整影像资料册.pdf', trusted), true);
  assert.equal(isTrustedSourceTitle(null, trusted), false); // 来源元数据缺失（失败关闭）
  assert.equal(isTrustedSourceTitle('', trusted), false); // 空标题
  assert.equal(isTrustedSourceTitle(undefined, trusted), false);
  assert.equal(isTrustedSourceTitle('先天性肌无力.txt', trusted), false); // 异源（NRDS 混召实证样例）
  assert.equal(isTrustedSourceTitle('新生儿呼吸窘迫.txt', trusted), false); // 关键词相近非精确
  assert.equal(isTrustedSourceTitle('病例目录与调用交接.txt', trusted), false); // 平台目录文档非病例来源
});

test('候选过滤（合成夹具）：异源与空标题拒绝、同源多分片全保留', () => {
  const trusted = trustedSourceTitles('川崎病');
  const candidates = [
    { title: '川崎病.txt', content: '同源分片一' },
    { title: '川崎病.txt', content: '同源分片二' }, // 同文档多分片全保留
    { title: '川崎病_完整影像资料册.pdf', content: '影像册分片' },
    { title: '先天性肌无力.txt', content: '异源分片（不得拼入）' },
    { title: '', content: '空标题分片（来源不可证）' },
    { title: null, content: '元数据缺失分片' },
  ];
  const kept = filterTrustedRecallCandidates(candidates, trusted);
  assert.equal(kept.length, 3);
  assert.ok(kept.every((item) => trusted.includes((item.title ?? '').trim())));
  assert.ok(!kept.some((item) => item.content.includes('异源') || item.content.includes('空标题') || item.content.includes('元数据缺失')));
});

test('候选过滤：全部异源/空标题时返回空集（失败关闭 → 资料不足，不拼入任何候选）', () => {
  const trusted = trustedSourceTitles('风湿热');
  const kept = filterTrustedRecallCandidates([
    { title: '其他病例A.txt', content: 'x' },
    { title: null, content: 'y' },
  ], trusted);
  assert.equal(kept.length, 0);
});

test('别名权威映射：14 项全部解析到带独立来源文件夹的源病例，别名名不作为可信标题', () => {
  const links = Object.entries(TEACHER_CASE_LINKS);
  assert.equal(links.length, 14);
  for (const [aliasId, link] of links) {
    const source = TEACHER_CASE_CATALOG.find((item) => item.id === link.sourceId);
    assert.ok(source, `${aliasId} 映射目标不存在`);
    assert.ok(source!.folder, `${aliasId} 映射目标无独立来源文件夹`);
    // 可信标题按源病例名派生；以别名命名的候选（库内不应存在）必须被拒绝（失败关闭）
    const trusted = trustedSourceTitles(source!.name);
    const aliasName = aliasId.replace(/^teacher-/, '');
    assert.equal(isTrustedSourceTitle(`${aliasName}.txt`, trusted), false, `${aliasId} 别名标题不得通过`);
  }
});

test('别名样例：毛细支气管炎 → 急性毛细支气管炎（按源名派生可信标题）', () => {
  const link = TEACHER_CASE_LINKS['teacher-毛细支气管炎'];
  assert.equal(link?.sourceId, 'teacher-急性毛细支气管炎');
  const source = TEACHER_CASE_CATALOG.find((item) => item.id === link!.sourceId);
  assert.deepEqual(trustedSourceTitles(source!.name), ['急性毛细支气管炎.txt', '急性毛细支气管炎_完整影像资料册.pdf']);
});

test('无独立来源（D 类 3 项）：folder 空且不在别名映射 → 召回失败关闭（资料不足，不编造）', () => {
  const noSource = ['teacher-新生儿脑梗死', 'teacher-支气管肺炎', 'teacher-格林巴利综合征'];
  for (const id of noSource) {
    const item = TEACHER_CASE_CATALOG.find((entry) => entry.id === id);
    assert.ok(item, `${id} 不在目录`);
    assert.equal(item!.folder, null);
    assert.ok(!TEACHER_CASE_LINKS[id], `${id} 不得存在于别名映射`);
  }
});

test('目录计数口径：70 教师项 = 53 独立来源文件夹 + 14 别名（folder 空）+ 3 缺来源', () => {
  assert.equal(TEACHER_CASE_CATALOG.length, 70);
  const withFolder = TEACHER_CASE_CATALOG.filter((item) => item.folder).length;
  const aliases = Object.keys(TEACHER_CASE_LINKS).length;
  const noSource = TEACHER_CASE_CATALOG.filter((item) => !item.folder && !TEACHER_CASE_LINKS[item.id]).length;
  assert.equal(withFolder, 53);
  assert.equal(aliases, 14);
  assert.equal(noSource, 3);
});
