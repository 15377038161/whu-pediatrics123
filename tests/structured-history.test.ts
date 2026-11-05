import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HISTORY_DISCLAIMER,
  HISTORY_SECTIONS,
  gradeStructuredHistory,
  isHistoryAnswerEmpty,
} from '../src/domain/structured-history';

const fullAnswer = {
  chief: '发热咳嗽 3 天',
  present: '3 天前受凉后突然起病，阵发性咳嗽，夜间加重，伴气促，精神差食欲下降，曾门诊口服退热药无明显缓解',
  past: '既往体健，无住院史，无手术外伤史，否认药物食物过敏，无输血史',
  personal: '第 2 胎第 2 产，孕 39 周顺产，出生体重 3.2kg，母乳喂养，已添加辅食，发育与同龄儿相近，卡介苗乙肝已接种',
  family: '父母体健，家族中无类似疾病，无结核肝炎等传染病接触史',
  social: '居住城市，上幼儿园，近期无外出旅游，无宠物接触',
};

test('覆盖全部要点的答案得满分', () => {
  const grade = gradeStructuredHistory(fullAnswer);
  assert.equal(grade.percent, 100);
  assert.equal(grade.totalScore, grade.maxScore);
  assert.deepEqual(grade.missingPoints, []);
});

test('只填主诉时按要点给部分分，并把必问项列为漏问', () => {
  const grade = gradeStructuredHistory({ chief: '发热咳嗽 3 天' });
  assert.ok(grade.percent > 0 && grade.percent < 40);
  assert.equal(grade.sections[0].hits.length, 2);
  const missing = grade.missingPoints.join('\n');
  assert.match(missing, /现病史/);
  assert.match(missing, /漏问：/);
});

test('同义表述可命中：剖宫产算出生史，奶粉算喂养史', () => {
  const grade = gradeStructuredHistory({ personal: '第 1 胎第 1 产，孕 38 周剖宫产，出生体重 3.0kg，奶粉喂养，已按计划接种疫苗' });
  const personal = grade.sections.find((section) => section.id === 'personal')!;
  assert.ok(personal.hits.includes('出生史'));
  assert.ok(personal.hits.includes('喂养史'));
  assert.ok(personal.hits.includes('预防接种史'));
});

test('空答案与空白答案都判 0 分且不抛错', () => {
  const empty = gradeStructuredHistory({});
  assert.equal(empty.totalScore, 0);
  assert.equal(empty.percent, 0);
  assert.equal(isHistoryAnswerEmpty({}), true);
  assert.equal(isHistoryAnswerEmpty({ chief: '   ' }), true);
  assert.equal(isHistoryAnswerEmpty({ chief: '发热 3 天' }), false);
});

test('总分的分母与提纲要点总数一致', () => {
  const expected = HISTORY_SECTIONS.reduce((sum, section) => sum + section.points.length, 0);
  assert.equal(gradeStructuredHistory({}).maxScore, expected);
  assert.equal(expected, 20);
});

test('未知分区键被忽略，超长文本不抛错', () => {
  const grade = gradeStructuredHistory({ unknown: '随便写点什么', chief: '发热'.repeat(5000) });
  assert.equal(grade.sections.length, HISTORY_SECTIONS.length);
  assert.ok(grade.totalScore <= grade.maxScore);
});

test('漏问提示中必问项排在可选遗漏之前', () => {
  const grade = gradeStructuredHistory({ chief: '发热咳嗽 3 天' });
  const firstOptional = grade.missingPoints.findIndex((item) => /手术与外伤史|输血史|生长发育史|居住与托幼|流行病学接触史|诱因|家族中类似|传染病接触/.test(item));
  const lastRequired = Math.max(
    ...grade.missingPoints
      .map((item, index) => (/手术与外伤史|输血史|生长发育史|居住与托幼|流行病学接触史|诱因|家族中类似|传染病接触/.test(item) ? -1 : index)),
  );
  assert.ok(firstOptional === -1 || firstOptional > lastRequired);
});

test('免责声明写明不计入临床成绩', () => {
  assert.match(HISTORY_DISCLAIMER, /不计入临床成绩/);
});