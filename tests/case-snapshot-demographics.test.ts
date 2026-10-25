import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSnapshotDemographics } from '@/lib/case-snapshot';

test('人口学提取：患儿句式（常规来源形态）', () => {
  const r = extractSnapshotDemographics('主诉：发热、咳嗽伴声嘶1天\n【病史】\n入院情况：\n1.患儿，女，8岁27天；\n2.发热、咳嗽伴声嘶1天；');
  assert.equal(r.sex, '女');
  assert.equal(r.age, '8岁27天');
});

test('人口学提取：患者句式（肝豆状核变性来源形态，头部占位不抢答）', () => {
  const head = '病例名称：肝豆状核变性\n病例ID：teacher-肝豆状核变性\n年龄：6岁\n性别：性别未记录\n主诉：因"发现肝功能异常1月余"入院\n【病例结构化摘要】\n【病史】\n入院情况2020-11-01\n1.患者，男，6岁；\n2.因"发现肝功能异常1月余"入院；';
  const r = extractSnapshotDemographics(head);
  assert.equal(r.sex, '男');
  assert.equal(r.age, '6岁');
});

test('人口学提取：性别声明（男/女性形态均可）', () => {
  assert.equal(extractSnapshotDemographics('性别：男\n主诉：合成').sex, '男');
  assert.equal(extractSnapshotDemographics('性别：女性。\n主诉：合成').sex, '女');
});

test('人口学提取：新生儿"男婴/女婴"形态不丢', () => {
  assert.equal(extractSnapshotDemographics('1.患儿，男婴，1天；').sex, '男');
  assert.equal(extractSnapshotDemographics('1.患儿，女婴，3天；').sex, '女');
});

test('人口学提取：拒绝"患者女儿"误命中与"性别：性别未记录"占位', () => {
  assert.equal(extractSnapshotDemographics('患者女儿代诉：父亲发热3天').sex, undefined);
  assert.equal(extractSnapshotDemographics('性别：性别未记录\n主诉：合成').sex, undefined);
});

test('人口学提取：患儿句式"男童/女童"识别且年龄保留（Codex复现漏性别修复）', () => {
  const girl = extractSnapshotDemographics('主诉：合成\n【病史】\n1.患儿，女童，5岁；\n2.合成病程；');
  assert.equal(girl.sex, '女');
  assert.equal(girl.age, '5岁');
  const boy = extractSnapshotDemographics('主诉：合成\n【病史】\n1.患儿，男童，5岁；\n2.合成病程；');
  assert.equal(boy.sex, '男');
  assert.equal(boy.age, '5岁');
});

test('人口学提取：显式声明"性别：男童/女童"识别', () => {
  assert.equal(extractSnapshotDemographics('性别：女童\n主诉：合成').sex, '女');
  assert.equal(extractSnapshotDemographics('性别：男童\n主诉：合成').sex, '男');
});

test('人口学提取：照护者女性/患者女儿/性别未知仍不得推成患儿性别', () => {
  assert.equal(extractSnapshotDemographics('照护者女性，患儿5岁').sex, undefined);
  assert.equal(extractSnapshotDemographics('患者女儿代诉：父亲发热3天').sex, undefined);
  assert.equal(extractSnapshotDemographics('性别未知\n主诉：合成').sex, undefined);
  assert.equal(extractSnapshotDemographics('性别：未知\n主诉：合成').sex, undefined);
});

test('人口学提取：患者句式"男童/女童/男婴/女婴"组合识别（合成工程边界）', () => {
  const boy = extractSnapshotDemographics('主诉：合成\n【病史】\n1.患者，男童，7岁；\n2.合成病程；');
  assert.equal(boy.sex, '男');
  assert.equal(boy.age, '7岁');
  const girl = extractSnapshotDemographics('主诉：合成\n【病史】\n1.患者，女童，7岁；\n2.合成病程；');
  assert.equal(girl.sex, '女');
  assert.equal(girl.age, '7岁');
  assert.equal(extractSnapshotDemographics('1.患者，男婴，2天；').sex, '男');
  assert.equal(extractSnapshotDemographics('1.患者，女婴，3天；').sex, '女');
});

test('人口学提取：冲突时患儿/患者句式优先于性别声明（合成工程边界）', () => {
  // 提取优先级 demo（患儿/患者句式）> sexDecl（性别声明）> sexInline：头部声明为占位或陈旧值时，临床记录句式优先。
  assert.equal(extractSnapshotDemographics('性别：男\n【病史】\n1.患儿，女，5岁；\n2.合成病程；').sex, '女');
  assert.equal(extractSnapshotDemographics('性别：女\n【病史】\n1.患者，男，6岁；\n2.合成病程；').sex, '男');
  // 无患儿/患者句式时声明仍生效（既有行为保持，不扩大补丁语义）。
  assert.equal(extractSnapshotDemographics('性别：男\n主诉：合成').sex, '男');
});

test('人口学提取：母亲/女儿等照护者性别不冒充患者（合成工程边界）', () => {
  // 母亲女性不覆盖同句病史中的患儿男性。
  const r = extractSnapshotDemographics('母亲，女，32岁；患儿，男，5岁；');
  assert.equal(r.sex, '男');
  assert.equal(r.age, '5岁');
  // 无患儿/患者性别句式时，照护者与女儿均不产生患儿性别（女后跟儿被前瞻拒绝）。
  assert.equal(extractSnapshotDemographics('患儿父亲代诉；母亲和女儿陪诊').sex, undefined);
  assert.equal(extractSnapshotDemographics('患者女儿，女，12岁；父亲发热3天').sex, undefined);
  // 待核验占位与"N岁女童"无患儿/患者前缀的目录式表述均不猜性别。
  assert.equal(extractSnapshotDemographics('性别：待核验\n主诉：合成').sex, undefined);
  assert.equal(extractSnapshotDemographics('5岁女童发热、咳嗽伴喘息').sex, undefined);
});
