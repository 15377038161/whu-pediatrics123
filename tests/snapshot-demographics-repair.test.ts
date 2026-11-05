import assert from 'node:assert/strict';
import test from 'node:test';
import { repairSnapshotDemographics } from '@/lib/case-snapshot';

// 部署环境 knowledge/ 不入库，运行态读数据库快照；快照顶层 age/sex 在建快照时由病史头
// 500 字窗口提取，窗口漏掉人口学句即把占位串当真值落库。同一快照的 sections.history
// 仍含人口学句，读取时必须回读重推，否则人物形象回落占位剪影。
test('占位 age/sex 从同记录 sections.history 回读重推（室上速来源形态）', () => {
  const repaired = repairSnapshotDemographics({
    age: '年龄未记录',
    sex: '性别未记录',
    sections: { history: '2023-05-2719:53\n患者[身份信息已隐去]\n病例特点:1.患儿，女，6岁；\n2.发热伴乏力半天；' },
  });
  assert.equal(repaired.sex, '女');
  assert.equal(repaired.age, '6岁');
});

test('真实 age/sex 不被重推覆盖', () => {
  const repaired = repairSnapshotDemographics({
    age: '8岁27天',
    sex: '女',
    sections: { history: '1.患儿，男，3岁；' },
  });
  assert.equal(repaired.sex, '女');
  assert.equal(repaired.age, '8岁27天');
});

test('仅缺一项时只补该项', () => {
  const repaired = repairSnapshotDemographics({
    age: '年龄未记录',
    sex: '男',
    sections: { history: '1.患儿，男，1岁2月；' },
  });
  assert.equal(repaired.sex, '男');
  assert.equal(repaired.age, '1岁2月');
});

test('正文确无人口学句时保持占位，不猜不造', () => {
  const repaired = repairSnapshotDemographics({
    age: '年龄未记录',
    sex: '性别未记录',
    sections: { history: '主诉：发热3天。\n现病史：无其他记录。' },
  });
  assert.equal(repaired.sex, '性别未记录');
  assert.equal(repaired.age, '年龄未记录');
});

test('只有性别句时补性别，病程时长不得被当年龄', () => {
  const repaired = repairSnapshotDemographics({
    age: '年龄未记录',
    sex: '性别未记录',
    sections: { history: '患儿，女\n主诉：发热3天。\n现病史：无其他记录。' },
  });
  assert.equal(repaired.sex, '女');
  assert.equal(repaired.age, '年龄未记录');
});

test('空记录与缺 sections 不抛错', () => {
  assert.deepEqual(repairSnapshotDemographics({}), { age: undefined, sex: undefined });
  assert.deepEqual(repairSnapshotDemographics({ age: '年龄未记录', sex: '性别未记录' }), { age: '年龄未记录', sex: '性别未记录' });
});
