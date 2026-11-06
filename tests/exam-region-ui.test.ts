import './fixtures/legacy-engine-catalog';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentEvent } from '@/domain/agent';
import { ExamObservationCard, ExamRegionMarker, type ExamObservation } from '@/components/exam-region-panel';
import { EXAM_REGIONS, REGION_EDGE_INSET, REGION_TRIGGER_WIDTH, fanAngle, fanRadiusPercent, partLabel } from '@/domain/exam-regions';
import { TECHNIQUE_NOTE_BADGE, examTechniqueNote } from '@/domain/exam-technique-notes';
import { createInitialSession, runAgentTurn } from '@/lib/agent-engine';

const noop = () => undefined;

function renderMarker(regionIndex: number, options: { open?: boolean; posture?: 'standing' | 'supine'; busy?: boolean; observation?: ExamObservation | null } = {}): string {
  return renderToStaticMarkup(createElement(ExamRegionMarker, {
    region: EXAM_REGIONS[regionIndex],
    posture: options.posture ?? 'standing',
    open: options.open ?? false,
    busy: options.busy ?? false,
    observation: options.observation ?? null,
    onToggle: noop,
    onExamine: noop,
  }));
}

test('6 个大区常驻渲染，锚点与朝向逐项等于 exam-regions 的几何模型', () => {
  const html = EXAM_REGIONS.map((_, index) => renderMarker(index)).join('');
  for (const region of EXAM_REGIONS) {
    assert.ok(html.includes(`data-region="${region.id}"`), region.id);
    assert.ok(html.includes(`>${region.label}</button>`), `${region.id} 的大区按钮文案不是目录里的名字`);
    const side = region.side === 'left' ? `left:${REGION_EDGE_INSET}%` : `right:${REGION_EDGE_INSET}%`;
    assert.ok(html.includes(side), `${region.id} 没贴到患儿图边缘，扇形会朝图外张开`);
    assert.ok(html.includes(`width:${REGION_TRIGGER_WIDTH}px`), `${region.id} 触发器宽度与几何模型不一致`);
    assert.ok(html.includes(`top:${region.anchorTop[0]}%`), `${region.id} 站姿锚点与几何模型不一致`);
  }
  // 收起态不渲染任何子部位：两层按钮同时出现就会互相压住（正是改造前的毛病）。
  assert.equal(html.includes('exam-fan-item'), false, '未展开就渲染扇形按钮，24 个部位会一次性平铺');
  assert.ok(html.includes('aria-expanded="false"'), '大区按钮没有展开态，读屏学生听不出还有第二层');
});

test('仰卧位换用仰卧锚点，展开后每颗子部位的角度与半径都来自 domain', () => {
  const region = EXAM_REGIONS[0];
  const supine = renderMarker(0, { posture: 'supine' });
  assert.ok(supine.includes(`top:${region.anchorTop[1]}%`), '仰卧位沿用站姿锚点，按钮会离开实际解剖位置');
  const open = renderMarker(0, { open: true, posture: 'supine' });
  assert.ok(open.includes(`top:${region.anchorTop[1]}%`));
  assert.ok(open.includes(`aria-label="${region.label}：选择要检查的部位"`));
  region.parts.forEach((part, index) => {
    assert.ok(open.includes(`>${partLabel(part)}</button>`), `${part} 的扇形按钮文案不是部位目录里的名字`);
    assert.ok(open.includes(`--fan-angle:${fanAngle(region, index)}deg`), `${part} 的角度与几何模型不一致`);
    // 半径写成容器查询单位而不是 px：按图框宽度同比缩放，窄图框下不会横穿中线压到对侧大区。
    assert.ok(open.includes(`--fan-r:${fanRadiusPercent(region, index)}cqw`), `${part} 的半径与几何模型不一致，单测校验的落点等于白测`);
  });
  assert.equal(open.match(/exam-fan-item/g)?.length, region.parts.length, '扇形按钮数与该区子部位数不符');
});

test('请求进行中扇形与触发器一起禁用，学生不会在等待时点出第二次查体', () => {
  const busy = renderMarker(0, { open: true, busy: true });
  assert.equal(busy.match(/disabled=""/g)?.length, 1 + EXAM_REGIONS[0].parts.length);
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
