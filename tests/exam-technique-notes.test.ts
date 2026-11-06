import assert from 'node:assert/strict';
import test from 'node:test';
import { EXAM_LOCATIONS, SOURCE_EXAM_TOOL_IDS } from '../src/domain/source-exam-contract';
import { TECHNIQUE_NOTE_BADGE, examTechniqueNote } from '../src/domain/exam-technique-notes';
import { sourceExamDefinitions } from '../src/domain/exam-methods';

const TOOL_IDS: readonly string[] = [...SOURCE_EXAM_TOOL_IDS, 'hand-hygiene'];
const PART_IDS: readonly string[] = EXAM_LOCATIONS.map(([id]) => id);
/** 抽取规则产出的每一个 器材×部位 组合都必须有第二层要领，否则学生点到就是空白。 */
const RULE_COMBOS = sourceExamDefinitions('体温38.5℃').map(([toolId, bodyPartId]) => [toolId, bodyPartId] as const);

test('徽标文案一字不改，且强制标注非本例所见与未审核', () => {
  assert.equal(TECHNIQUE_NOTE_BADGE, '一般规律 · 非本例所见 · 未经临床审核');
});

test('抽取规则覆盖的每个组合都是常规组合，要领与正常表现均非空且为一般规律表述', () => {
  assert.ok(RULE_COMBOS.length >= 33, `规则组合数异常：${RULE_COMBOS.length}`);
  for (const [toolId, bodyPartId] of RULE_COMBOS) {
    const note = examTechniqueNote(toolId, bodyPartId);
    assert.equal(note?.kind, 'routine', `${toolId}×${bodyPartId}`);
    if (note?.kind !== 'routine') continue;
    assert.ok(note.technique.trim().length >= 20, `${toolId}×${bodyPartId} 要领过短`);
    assert.ok(note.expectedNormal.startsWith('一般规律：'), `${toolId}×${bodyPartId} 未以一般规律开头`);
  }
  // 手卫生由病例固定注入，不在抽取规则里，但必须有要领
  assert.equal(examTechniqueNote('hand-hygiene', 'hands')?.kind, 'routine');
});

test('任何合法组合都不返回 null，且不把通用要领伪装成本例所见', () => {
  const forbidden = /本例|该患儿|本病例记录|患儿可见|本次查体见/;
  const notes = new Set<string>();
  for (const toolId of TOOL_IDS) {
    for (const bodyPartId of PART_IDS) {
      const note = examTechniqueNote(toolId, bodyPartId);
      assert.ok(note, `${toolId}×${bodyPartId} 返回 null`);
      const text = note.kind === 'routine' ? `${note.technique}${note.expectedNormal}` : note.note;
      assert.ok(!forbidden.test(text), `${toolId}×${bodyPartId} 文案像是在描述具体病人`);
      if (note.kind === 'not-routine') notes.add(note.note);
    }
  }
  // 非常规说明按器材/部位分组，不能 278 个组合共用一句话
  assert.ok(notes.size > 100, `非常规说明只有 ${notes.size} 种，退化成模板话`);
});

test('未知器材或部位返回 null，不用空文案掩盖拼写错误', () => {
  assert.equal(examTechniqueNote('no-such-tool', 'neck'), null);
  assert.equal(examTechniqueNote('stethoscope', 'no-such-part'), null);
  assert.equal(examTechniqueNote('', ''), null);
});

test('非常规组合明确说不是常规检查，并指出该部位常规用什么器材', () => {
  const note = examTechniqueNote('percussion', 'finger');
  assert.equal(note?.kind, 'not-routine');
  assert.ok(note?.kind === 'not-routine' && note.note.includes('叩诊'));
  assert.ok(note?.kind === 'not-routine' && note.note.includes('血氧仪'));
  // 非常规组合不得给出「正常表现」，否则等于替病例编造阴性结论
  assert.equal(note?.kind === 'not-routine' && 'expectedNormal' in note, false);
});
