/** 核验已人工阅读的病例事实能否在现有引擎中取得。非真实模型/浏览器验收。 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import { getCase } from '@/domain/case';

async function main() {
  process.env.ENABLE_AI_FIXTURE = 'true';
  const checks: Array<{ check: string; passed: boolean }> = [];
  const session = createInitialSession('content-review-local', 'guided', 'teacher-川崎病');
  const patient = getCase(session.caseId);
  assert.equal(patient.age, '5岁');
  assert.equal(patient.sex, '女');
  checks.push({ check: '川崎病年龄性别与正文相符', passed: true });
  const onset = await runAgentTurn(session, { type: 'ASK_QUESTION', data: { text: '为什么来就诊？' } }, 'content-kd-chief');
  assert.ok(onset.newMessages.some(item => item.actor === 'parent' && item.content.includes('2天')));
  checks.push({ check: '初诊主诉仍为发热2天，不偷换后续病程', passed: true });
  await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'content-kd-prep');
  const exam = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'flashlight', bodyPartId: 'forehead' } }, 'content-kd-eyes');
  assert.ok(exam.newMessages.some(item => item.content.includes('结膜充血')));
  const eyeRule = patient.exams.find(item => item.toolId === 'flashlight' && item.bodyPartId === 'forehead');
  assert.ok(eyeRule && session.unlockedEvidence.includes(eyeRule.evidenceCode));
  checks.push({ check: '头面操作取得结膜充血并写入证据', passed: true });
  const lymphExam = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'palpation', bodyPartId: 'neck' } }, 'content-kd-lymph');
  assert.ok(lymphExam.newMessages.some(item => item.content.includes('颈部及腹股沟浅表淋巴结可触及肿大') && item.content.includes('质韧活动可') && item.content.includes('无触痛')));
  const lymphRule = patient.exams.find(item => item.toolId === 'palpation' && item.bodyPartId === 'neck');
  assert.ok(lymphRule && session.unlockedEvidence.includes(lymphRule.evidenceCode));
  const neckInspect = await runAgentTurn(session, { type: 'EXAM_ACTION', data: { toolId: 'inspection', bodyPartId: 'neck' } }, 'content-kd-neck-inspect');
  assert.ok(neckInspect.newMessages.some(item => item.content.includes('颈软') && !item.content.includes('淋巴结')));
  checks.push({ check: '颈部触诊取得淋巴结肿大及质地续段并入证据，视诊不混入触诊内容', passed: true });
  const mouthRule = patient.exams.find(item => item.toolId === 'tongue-depressor');
  assert.ok(mouthRule?.result.includes('咽红'));
  assert.ok(!mouthRule?.result.includes('草莓舌'));
  checks.push({ check: '初诊口咽查体不提前展示后续草莓舌', passed: true });
  const endocrine = getCase('teacher-外周性性早熟');
  assert.equal(endocrine.age, '2岁11月');
  assert.ok(endocrine.sourceFacts?.sections.tests.includes('516.00pg/mL'));
  assert.ok(endocrine.sourceFacts?.sections.tests.includes('20.50pg/mL'));
  checks.push({ check: '性早熟保留两时点雌二醇，不覆盖原始初值', passed: true });
  const endocrineSession = createInitialSession('content-review-local', 'guided', endocrine.id);
  await runAgentTurn(endocrineSession, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'content-endocrine-prep');
  for (const [toolId, expected] of [['inspection', 'Tanner分期B2期'], ['palpation', '双侧乳房结节约3*3cm']]) {
    const observed = await runAgentTurn(endocrineSession, { type: 'EXAM_ACTION', data: { toolId, bodyPartId: 'chest' } }, `content-endocrine-${toolId}`);
    assert.ok(observed.newMessages.some(item => item.content.includes(expected)));
    const rule = endocrine.exams.find(item => item.toolId === toolId && item.bodyPartId === 'chest');
    assert.ok(rule && endocrineSession.unlockedEvidence.includes(rule.evidenceCode));
  }
  checks.push({ check: '性早熟胸部视诊与触诊分别取得原始发育体征并入证据', passed: true });
  const leukemia = getCase('teacher-急性白血病-急性淋巴细胞白血病');
  const leukemiaSession = createInitialSession('content-review-local', 'guided', leukemia.id);
  await runAgentTurn(leukemiaSession, { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } }, 'content-leuk-prep');
  const leukemiaLymph = await runAgentTurn(leukemiaSession, { type: 'EXAM_ACTION', data: { toolId: 'palpation', bodyPartId: 'neck' } }, 'content-leuk-lymph');
  const leukemiaRule = leukemia.exams.find(item => item.toolId === 'palpation' && item.bodyPartId === 'neck');
  assert.ok(leukemiaRule && leukemiaSession.unlockedEvidence.includes(leukemiaRule.evidenceCode));
  for (const expected of ['枕部、耳前耳后', '大小约1.2*1.7cm左右', '质硬', '相互融合成片状', '无触痛']) {
    assert.ok(leukemiaLymph.newMessages.some(item => item.content.includes(expected)), `白血病淋巴结证据应含：${expected}`);
  }
  // 头面检查不得因“耳前耳后”抢走淋巴结记录，也不得丢失本例真实眼部阴性
  const leukemiaHead = await runAgentTurn(leukemiaSession, { type: 'EXAM_ACTION', data: { toolId: 'flashlight', bodyPartId: 'forehead' } }, 'content-leuk-head');
  assert.ok(leukemiaHead.newMessages.some(item => item.content.includes('双眼睑无水肿') && !item.content.includes('淋巴结')));
  checks.push({ check: '白血病多部位淋巴结及质地大小续段可由颈部触诊完整取得，头面检查不抢走', passed: true });
  const leukemiaFacts = leukemia.sourceFacts;
  assert.ok(leukemiaFacts && !leukemiaFacts.documents.some(doc => (/ZY\d{8,}/.test(doc.text) || /床号[：:]\s*\d+/.test(doc.text))));
  assert.ok(leukemiaFacts.sections.exam.includes('肝肋下锁骨中线6cm') && leukemiaFacts.sections.tests.includes('原始淋巴细胞为主，占94.5%'));
  checks.push({ check: '白血病运行文档标识残留已清理，五章节与骨髓关键事实保留', passed: true });
  const leukemiaAbd = await runAgentTurn(leukemiaSession, { type: 'EXAM_ACTION', data: { toolId: 'palpation', bodyPartId: 'abdomen', posture: 'supine' } }, 'content-leuk-abd');
  assert.ok(leukemiaAbd.newMessages.some(item => item.content.includes('肝肋下锁骨中线6cm') && item.content.includes('脾脏肋下约7cm')));
  const leukemiaAbdRule = leukemia.exams.find(item => item.toolId === 'palpation' && item.bodyPartId === 'abdomen');
  assert.ok(leukemiaAbdRule && leukemiaSession.unlockedEvidence.includes(leukemiaAbdRule.evidenceCode));
  checks.push({ check: '白血病仰卧腹部触诊取得肝脾肿大原文并入证据', passed: true });
  for (const result of ['糖类抗原125:34.67U/mL', '糖类抗原153:9.12U/mL', '糖类抗原199:74.01U/mL']) {
    assert.ok(endocrine.sourceFacts?.sections.tests.includes(result));
    assert.ok(endocrine.sourceFacts?.sections.plan.includes(result));
  }
  checks.push({ check: '三项黏连检验项目按同源清楚记录恢复分隔，数值不改', passed: true });
  const renal = getCase('teacher-肾病综合征').sourceFacts;
  assert.ok(renal && !renal.documents.some(doc => /^姓\s*名[:：].*?年\s*龄[:：].*?性\s*别[:：]/m.test(doc.text)));
  assert.ok(renal.sections.exam.includes('身高1142cm'));
  checks.push({ check: '已移除已知身份栏残留，原文身高矛盾保留待核实', passed: true });
  const output = path.resolve('outputs/case-library-review/20261021/content-engine-evidence.json');
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ verifiedAt: new Date().toISOString(), mode: 'local_engine_fixture', limitations: ['未调用真实模型', '未验证浏览器/数据库/发布', '不代表医学审核通过'], checks }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: checks.length, failed: 0, mode: 'local_engine_fixture' }));
}
main().catch(() => { console.error('病例内容引擎验证失败；未输出病历正文或凭据。'); process.exitCode = 1; });
