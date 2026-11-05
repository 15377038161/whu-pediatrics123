import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASEPTIC_PROCEDURES,
  PROCEDURES,
  PROCEDURE_GROUP_LABELS,
  PROCEDURE_SLUGS,
  PUNCTURE_PROCEDURES,
  RESUSCITATION_PROCEDURES,
  findProcedure,
  isProcedureComplete,
  proceduresByGroup,
  type ClinicalProcedure,
} from '@/domain/clinical-procedures';

function param(procedure: ClinicalProcedure, label: string): string {
  const found = procedure.parameters.find((item) => item.label === label);
  if (!found) assert.fail(`${procedure.slug} 缺少参数条目「${label}」`);
  return found.value;
}

function joined(procedure: ClinicalProcedure, key: 'indications' | 'contraindications' | 'complications' | 'pediatricNotes' | 'preparation' | 'sources'): string {
  return procedure[key].join('\n');
}

function stepsText(procedure: ClinicalProcedure): string {
  return procedure.steps.map((step) => `${step.title}：${step.detail}`).join('\n');
}

/** 目录完整性：8 项操作覆盖老师点名的全部技能，slug 唯一，分组齐备。 */
test('PROCEDURES：8 项技能操作目录完整且 slug 唯一', () => {
  assert.equal(PROCEDURES.length, 8);
  assert.equal(new Set(PROCEDURE_SLUGS).size, 8);
  for (const slug of PROCEDURE_SLUGS) assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.deepEqual(ASEPTIC_PROCEDURES.map((item) => item.slug), ['surgical-gowning', 'sterile-gloving', 'skin-prep-draping']);
  assert.deepEqual(PUNCTURE_PROCEDURES.map((item) => item.slug), ['thoracentesis', 'lumbar-puncture', 'abdominal-paracentesis', 'bone-marrow-aspiration']);
  assert.deepEqual(RESUSCITATION_PROCEDURES.map((item) => item.slug), ['pediatric-cpr']);
  assert.equal(proceduresByGroup('aseptic').length, 3);
  assert.equal(proceduresByGroup('puncture').length, 4);
  assert.equal(proceduresByGroup('resuscitation').length, 1);
  assert.equal(PROCEDURE_GROUP_LABELS.aseptic, '无菌准备');
  assert.equal(PROCEDURE_GROUP_LABELS.puncture, '穿刺技术');
  assert.equal(PROCEDURE_GROUP_LABELS.resuscitation, '急救复苏');
});

/** 空壳检查（C1）：任何字段留空都不允许上界面，正文必须自证完整。 */
test('isProcedureComplete：8 项操作全部通过完整性校验', () => {
  for (const procedure of PROCEDURES) {
    assert.ok(isProcedureComplete(procedure), `${procedure.slug} 正文不完整`);
    assert.ok(procedure.title.length > 0);
    assert.ok(procedure.summary.length >= 20, `${procedure.slug} 摘要过短`);
    assert.ok(procedure.parameters.length >= 3, `${procedure.slug} 关键数值不足 3 条`);
    for (const item of procedure.parameters) {
      assert.ok(item.label.trim().length > 0);
      assert.ok(item.value.trim().length > 0, `${procedure.slug} 参数「${item.label}」留空`);
    }
    for (const step of procedure.steps) {
      assert.ok(step.title.trim().length > 0);
      assert.ok(step.detail.trim().length >= 10, `${procedure.slug} 步骤「${step.title}」正文过短`);
    }
    for (const source of procedure.sources) assert.ok(source.trim().length > 0);
    assert.ok(joined(procedure, 'complications').length > 0);
    assert.ok(joined(procedure, 'pediatricNotes').length > 0);
  }
});

/** 穿刺类必须同时给出适应证与禁忌症，且都不得少于 3 条（老师点名的安全边界）。 */
test('四大穿刺：适应证与禁忌症均不少于 3 条', () => {
  for (const procedure of PUNCTURE_PROCEDURES) {
    assert.ok(procedure.indications.length >= 3, `${procedure.slug} 适应证不足`);
    assert.ok(procedure.contraindications.length >= 3, `${procedure.slug} 禁忌症不足`);
    assert.ok(joined(procedure, 'contraindications').includes('出血倾向'), `${procedure.slug} 未列出血倾向禁忌`);
    assert.ok(joined(procedure, 'contraindications').includes('感染'), `${procedure.slug} 未列穿刺部位感染禁忌`);
  }
});

/** 消毒铺巾的量化红线：范围 15 cm 以上、无菌单下垂 30 cm 以下、婴幼儿禁用碘酒。 */
test('skin-prep-draping：消毒范围与铺巾下垂距离量化到条', () => {
  const procedure = findProcedure('skin-prep-draping');
  assert.ok(procedure);
  assert.match(param(procedure, '消毒范围'), /15 cm 以上/);
  assert.match(param(procedure, '无菌单下垂'), /30 cm 以下/);
  assert.match(param(procedure, '首选消毒剂'), /婴幼儿用 0\.5% 碘伏/);
  assert.match(param(procedure, '首选消毒剂'), /禁用碘酒/);
  assert.match(stepsText(procedure), /先铺操作者对面或相对不洁区/);
  assert.match(stepsText(procedure), /由手术台内向外推移/);
  assert.match(joined(procedure, 'complications'), /化学性灼伤/);
  assert.match(joined(procedure, 'pediatricNotes'), /体温/);
});

/** 穿手术衣与戴手套的无菌区边界必须写清，避免只背步骤不讲污染判定。 */
test('surgical-gowning / sterile-gloving：无菌区与污染判定明确', () => {
  const gown = findProcedure('surgical-gowning');
  assert.ok(gown);
  assert.match(param(gown, '无菌区范围'), /肩以下、腰以上/);
  assert.match(param(gown, '有菌区'), /背部/);
  assert.match(stepsText(gown), /捏住手术衣衣领内面/);
  assert.match(stepsText(gown), /整个身体转动/);
  const glove = findProcedure('sterile-gloving');
  assert.ok(glove);
  assert.match(param(glove, '核心原则'), /未戴手套的手只触手套内面/);
  assert.match(stepsText(glove), /反折部翻上/);
  assert.match(stepsText(glove), /脱后仍需按规范洗手/);
  assert.match(joined(glove, 'complications'), /破损/);
});

/** 腰穿：儿童穿刺间隙、压力正常值、留取量与术后体位为考核与安全要点。 */
test('lumbar-puncture：儿童取 L4–L5、压力与留取量、术后平卧 4–6 小时', () => {
  const procedure = findProcedure('lumbar-puncture');
  assert.ok(procedure);
  assert.match(param(procedure, '儿童穿刺间隙'), /L4–L5/);
  assert.match(param(procedure, '正常脑脊液压力'), /0\.69–1\.96 kPa/);
  assert.match(param(procedure, '小儿留取量'), /2–4 mL/);
  assert.match(param(procedure, '术后体位'), /去枕平卧 4–6 小时/);
  assert.match(joined(procedure, 'contraindications'), /脑疝先兆/);
  assert.match(joined(procedure, 'contraindications'), /视乳头水肿/);
  assert.match(joined(procedure, 'complications'), /脑疝/);
  assert.match(stepsText(procedure), /不得压迫颈部与胸腹/);
  assert.match(joined(procedure, 'pediatricNotes'), /L4–L5/);
});

/** 胸穿：抽气与抽液穿刺点不同，儿童单次限量与胸膜反应处置必须写明。 */
test('thoracentesis：抽气/抽液穿刺点区分，儿童限量与胸膜反应处置', () => {
  const procedure = findProcedure('thoracentesis');
  assert.ok(procedure);
  assert.match(param(procedure, '抽气穿刺点'), /锁骨中线第 2 肋间/);
  assert.match(param(procedure, '抽液穿刺点'), /肩胛下角线第 7–9 肋间/);
  assert.match(param(procedure, '进针路径'), /下一肋骨上缘/);
  assert.match(param(procedure, '儿童抽液量'), /5–10 mL\/kg/);
  assert.match(param(procedure, '儿童抽液量'), /首次不超过 300 mL/);
  assert.match(stepsText(procedure), /胸膜反应/);
  assert.match(stepsText(procedure), /立即停止抽液/);
  assert.match(joined(procedure, 'complications'), /复张性肺水肿/);
  assert.match(joined(procedure, 'pediatricNotes'), /超声引导/);
});

/** 腹穿：Z 形路径防漏液、排空膀胱、SBP 阈值与放液后循环管理。 */
test('abdominal-paracentesis：Z 形路径、排空膀胱与 SBP 阈值', () => {
  const procedure = findProcedure('abdominal-paracentesis');
  assert.ok(procedure);
  assert.match(param(procedure, '首选穿刺点'), /中、外 1\/3 交点/);
  assert.match(param(procedure, '进针路径'), /Z 形路径/);
  assert.match(param(procedure, '儿童放液量'), /10–20 mL\/kg/);
  assert.match(param(procedure, 'SBP 诊断阈值'), /≥250\/mm³/);
  assert.match(joined(procedure, 'preparation'), /排空膀胱/);
  assert.match(stepsText(procedure), /补充白蛋白/);
  assert.match(joined(procedure, 'complications'), /肠穿孔/);
  assert.match(joined(procedure, 'pediatricNotes'), /肾病综合征/);
});

/** 骨穿：按年龄选部位（婴幼儿胫骨、2 岁以上髂后上棘），抽取量与胸骨禁忌。 */
test('bone-marrow-aspiration：按年龄选部位、抽取量 0.2–0.5 mL、儿童不做胸骨穿刺', () => {
  const procedure = findProcedure('bone-marrow-aspiration');
  assert.ok(procedure);
  assert.match(param(procedure, '2 岁以下部位'), /胫骨粗隆下方 1–2 cm/);
  assert.match(param(procedure, '2 岁以上部位'), /髂后上棘/);
  assert.match(param(procedure, '胸骨穿刺'), /儿童慎用/);
  assert.match(param(procedure, '抽取量'), /^0\.2–0\.5 mL/);
  assert.match(param(procedure, '术后压迫'), /10 分钟以上/);
  assert.match(joined(procedure, 'contraindications'), /血友病/);
  assert.match(joined(procedure, 'contraindications'), /干抽（dry tap）不是禁忌/);
  assert.match(joined(procedure, 'indications'), /微小残留病/);
  assert.match(stepsText(procedure), /骨膜/);
  assert.match(joined(procedure, 'pediatricNotes'), /儿童不做胸骨穿刺/);
});

/** 婴儿心肺复苏：按压、通气、除颤、给药四组安全数字逐条钉住（AHA 2020 儿科口径）。 */
test('pediatric-cpr：按压深度频率与比例、除颤能量阶梯', () => {
  const procedure = findProcedure('pediatric-cpr');
  assert.ok(procedure);
  assert.match(param(procedure, '按压部位'), /两乳头连线中点下方/);
  assert.match(param(procedure, '按压手法'), /单人两指法/);
  assert.match(param(procedure, '按压手法'), /双掌环抱-拇指法/);
  assert.match(param(procedure, '按压深度'), /婴儿约 4 cm/);
  assert.match(param(procedure, '按压深度'), /儿童约 5 cm/);
  assert.match(param(procedure, '按压频率'), /^100–120 次\/分/);
  assert.match(param(procedure, '按压通气比'), /单人 30:2/);
  assert.match(param(procedure, '按压通气比'), /双人（院内专业人员）15:2/);
  assert.match(param(procedure, '除颤能量'), /首次 2 J\/kg/);
  assert.match(param(procedure, '除颤能量'), /第二次 4 J\/kg/);
  assert.match(param(procedure, '除颤能量'), /≥6 J\/kg/);
  assert.match(param(procedure, '除颤能量'), /不超过 10 J\/kg/);
});

/** 高级气道后通气频率是儿科与成人最易混淆处：儿童 20–30 次/分，不得写成成人 10 次/分。 */
test('pediatric-cpr：建立高级气道后通气 20–30 次/分（儿科口径，非成人 10 次/分）', () => {
  const procedure = findProcedure('pediatric-cpr');
  assert.ok(procedure);
  assert.match(param(procedure, '建立高级气道后'), /每 2–3 秒 1 次（20–30 次\/分）/);
  assert.ok(!param(procedure, '建立高级气道后').includes('10 次/分'));
  assert.match(stepsText(procedure), /每 2–3 秒 1 次（20–30 次\/分）/);
});

/** 给药与通路：肾上腺素剂量与间隔、骨内首选、胺碘酮上限、低血糖葡萄糖剂量按新生儿/儿童分列。 */
test('pediatric-cpr：肾上腺素、胺碘酮、葡萄糖剂量与骨内通路', () => {
  const procedure = findProcedure('pediatric-cpr');
  assert.ok(procedure);
  assert.match(param(procedure, '肾上腺素'), /^0\.01 mg\/kg（1:10000 溶液 0\.1 mL\/kg）/);
  assert.match(param(procedure, '肾上腺素'), /每 3–5 分钟重复/);
  assert.match(param(procedure, '肾上腺素'), /单次最大 1 mg/);
  assert.match(param(procedure, '首选给药通路'), /骨内（IO，婴儿首选胫骨近端）/);
  assert.match(param(procedure, '胺碘酮'), /5 mg\/kg/);
  assert.match(param(procedure, '胺碘酮'), /单次最大 300 mg/);
  assert.match(param(procedure, '低血糖处理'), /新生儿 10% 葡萄糖 2 mL\/kg/);
  assert.match(param(procedure, '低血糖处理'), /婴幼儿与儿童 10% 葡萄糖 5 mL\/kg/);
  assert.match(stepsText(procedure), /6H6T/);
  assert.match(stepsText(procedure), /SpO₂ 94%–99%/);
  assert.match(stepsText(procedure), /阿托品 0\.02 mg\/kg/);
  assert.match(joined(procedure, 'pediatricNotes'), /双人核对/);
  assert.match(joined(procedure, 'pediatricNotes'), /\/student\/dosing/);
  assert.match(joined(procedure, 'pediatricNotes'), /呼吸衰竭或休克进展而来/);
});

/** 儿童心搏骤停多为呼吸源性：不得写成「只做按压」的成人口径。 */
test('pediatric-cpr：强调通气与氧合同等重要', () => {
  const procedure = findProcedure('pediatric-cpr');
  assert.ok(procedure);
  assert.match(joined(procedure, 'pediatricNotes'), /不能只做按压/);
  assert.match(stepsText(procedure), /婴儿头部保持「中立位」/);
  assert.match(stepsText(procedure), /不做盲目手指掏挖/);
  assert.match(joined(procedure, 'complications'), /过度通气/);
});

/** 未收录的技能不得编造正文：findProcedure 返回 null，界面据此显示缺项说明。 */
test('findProcedure：未收录 slug 返回 null，收录 slug 返回同名条目', () => {
  assert.equal(findProcedure('appendectomy'), null);
  assert.equal(findProcedure(''), null);
  assert.equal(findProcedure('Pediatric-CPR'), null);
  for (const slug of PROCEDURE_SLUGS) {
    const procedure = findProcedure(slug);
    assert.ok(procedure);
    assert.equal(procedure.slug, slug);
  }
});

/** 出处可核验：每项操作至少一条教材或指南出处，禁止无源正文。 */
test('sources：每项操作都有教材或指南出处', () => {
  for (const procedure of PROCEDURES) {
    const sources = joined(procedure, 'sources');
    assert.ok(/教材|指南|规范|共识|实用儿科学/.test(sources), `${procedure.slug} 缺少可核验出处`);
  }
});
