import './fixtures/legacy-engine-catalog';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentEvent } from '@/domain/agent';
import { ExamObservationCard, type ExamObservation } from '@/components/exam-region-panel';
import { partLabel } from '@/domain/exam-regions';
import { TECHNIQUE_NOTE_BADGE, examTechniqueNote } from '@/domain/exam-technique-notes';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';
import {ANATOMY_REGIONS} from '@/domain/exam-anatomy';
import {ClinicalExam,RegionDiagram} from '@/components/clinical-exam';
import {EXAM_INSTRUMENTS} from '@/domain/exam-anatomy';

const noop = () => undefined;

test('自主查体首屏保留人物图片并提供全部器材，选择不预先透露有效组合',()=>{
  const html=renderToStaticMarkup(createElement(ClinicalExam,{image:'/test-person.webp',alt:'合成测试患儿',posture:'standing',position:'standing',positions:['standing','supine'],onPositionChange:noop,busy:false,hygieneCompleted:false,observation:null,onExamine:noop,onCloseObservation:noop,onReplayAudio:noop}));
  assert.ok(html.includes('alt="合成测试患儿"'));
  for(const tool of EXAM_INSTRUMENTS.filter(item=>item.id!=='hand-hygiene')) assert.ok(html.includes(`alt="${tool.label}"`),tool.label+'必须有图片且能自主选择');
  assert.ok(html.includes('开始检查'));
  assert.ok(html.includes('用文字选择具体部位'));
});

test('源记录会话也区分错误器材与资料缺失，三种体温计不可混用且不释放证据',async()=>{
  const session=createInitialSession('wrong-tool-probe','immersive');
  for(const [toolId,bodyPartId] of [['axillary-thermometer','forehead'],['infrared-thermometer','axilla'],['tympanic-thermometer','eyes']] as const){
    const before=[...session.unlockedEvidence];
    const turn=await runAgentTurn(session,{type:'EXAM_ACTION',data:{toolId,bodyPartId}},`mismatch-${toolId}`);
    assert.deepEqual(session.unlockedEvidence,before);
    assert.equal(session.events.at(-1)?.correct,false);
    assert.match(turn.feedback??'',/不匹配/);
    assert.equal(turn.newMessages.length,0);
  }
});

test('胸部后面不显示心前区与心脏听诊区，左右标记随观察面改变',()=>{
  const region=ANATOMY_REGIONS.find(r=>r.id==='rg-chest')!;
  const back=renderToStaticMarkup(createElement(RegionDiagram,{region,aspect:'back',selected:null,onSelect:noop,busy:false}));
  assert.equal(back.includes('aria-label="心前区"'),false);
  assert.equal(back.includes('aria-label="二尖瓣听诊区"'),false);
  assert.ok(back.includes('aria-label="右后肺野"'));
  assert.ok(back.includes('患者左侧'));
});

function observation(status: 'success' | 'blocked', toolId: string, bodyPartId: string, detail: string): ExamObservation {
  return { bodyPartId, toolId, detail, title: `${toolId} · ${partLabel(bodyPartId)}`, status, sound: null };
}

test('双层反馈：第一层是病例原文，第二层强制带未审核徽标且不冒充本例所见', () => {
  const detail = '双肺可闻及细湿啰音，以右下肺为著';
  const html = renderToStaticMarkup(createElement(ExamObservationCard, {
    observation: observation('success', 'stethoscope', 'chest-lung', detail), onClose: noop, onReplayAudio: noop,
  }));
  assert.ok(html.includes('本例所见 · 摘自病例原始记录'), '第一层没标明来源，学生会把通用要领当成本例体征');
  const first = html.indexOf('exam-observation-detail');
  const second = html.indexOf('exam-technique-note');
  assert.ok(first > -1 && second > first, '两层顺序颠倒，通用要领会被读成病例结论');
  assert.ok(html.slice(first, second).includes(detail), '第一层没有逐字展示服务端释放的原文');
  assert.ok(html.includes(TECHNIQUE_NOTE_BADGE), '第二层缺未审核徽标');
  const note = examTechniqueNote('stethoscope', 'chest-lung');
  assert.equal(note?.kind, 'routine');
  if (note?.kind === 'routine') {
    assert.ok(html.includes(note.technique) && html.includes(note.expectedNormal), '常规组合没渲染操作要领与一般正常表现');
    assert.equal(html.slice(first, second).includes(note.expectedNormal), false, '一般正常表现混进了本例所见区块');
  }
});

test('本例无记录时保留诚实占位，第二层仍给要领但不补造正常值', () => {
  const placeholder = '本病例资料未提供该检查的体征记录，请换用其他检查组合或记录需补充的检查。';
  const html = renderToStaticMarkup(createElement(ExamObservationCard, {
    observation: observation('blocked', 'percussion', 'finger', placeholder), onClose: noop, onReplayAudio: noop,
  }));
  assert.ok(html.includes('data-status="blocked"'));
  assert.ok(html.includes('本例未获得结果'));
  assert.ok(html.includes(placeholder), '占位文案被改写就等于替病例编了结论');
  assert.ok(html.includes(TECHNIQUE_NOTE_BADGE));
  const note = examTechniqueNote('percussion', 'finger');
  assert.equal(note?.kind, 'not-routine', '叩诊×手指本该是非常规组合');
  if (note?.kind === 'not-routine') assert.ok(html.includes('这一组合不属常规查体') && html.includes(note.note));
});

test('闭卷站保留患者所见，隐藏通用操作要领及历史结构化结果中的过程提示',()=>{
  const html=renderToStaticMarkup(createElement(ExamObservationCard,{
    observation:observation('success','stethoscope','chest-lung','【原记录】合成患者呼吸音\n操作：合成操作提示\n配合反应：合成流程提示'),
    onClose:noop,onReplayAudio:noop,showReference:false,
  }));
  assert.ok(html.includes('合成患者呼吸音'));
  for(const text of ['合成操作提示','合成流程提示','查看操作要领','exam-technique-note'])assert.equal(html.includes(text),false);
});

test('未经临床审核的第二层文案永不进入会话事件、反馈或角色消息（评分证据链只吃第一层）', async () => {
  const session = createInitialSession('exam-layer-probe', 'immersive');
  const serialized: string[] = [];
  const events: AgentEvent[] = [
    { type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } },
    { type: 'EXAM_ACTION', data: { toolId: 'stethoscope', bodyPartId: 'chest-lung' } },
    { type: 'EXAM_ACTION', data: { toolId: 'percussion', bodyPartId: 'finger' } },
  ];
  for (const [index, event] of events.entries()) {
    const result = await runAgentTurn(session, event, `layer-probe-${index}`);
    serialized.push(JSON.stringify({ events: result.session.events, feedback: result.feedback, newMessages: result.newMessages, trace: result.trace }));
  }
  assert.ok(session.events.some((item) => item.type === 'EXAM_ACTION' && item.correct === true), '一次都没成功释放体征，本断言没有覆盖成功路径');
  const joined = serialized.join('\n');
  assert.equal(joined.includes(TECHNIQUE_NOTE_BADGE), false, '未审核徽标进了会话事件，会被写进报告快照');
  for (const note of [examTechniqueNote('stethoscope', 'chest-lung'), examTechniqueNote('percussion', 'finger')]) {
    const text = note?.kind === 'routine' ? note.expectedNormal : note?.note;
    assert.ok(text && text.length > 4, '样本组合查不到第二层文案，本断言失去意义');
    assert.equal(joined.includes(text as string), false, '通用要领文案进了服务端输出，等于让未审核内容参与评分');
  }
});
