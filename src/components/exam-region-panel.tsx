'use client';

import { AlertTriangle, Stethoscope, Volume2, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { REGION_EDGE_INSET, REGION_TRIGGER_WIDTH, fanAngle, fanRadiusPercent, partLabel, type ExamRegion } from '@/domain/exam-regions';
import { TECHNIQUE_NOTE_BADGE, examTechniqueNote } from '@/domain/exam-technique-notes';

/**
 * 查体两级选位与双层反馈的渲染件。
 * 独立成模块（不放 training-workspace）是因为训练工作台经 note-writing 间接引入 CSS Module，
 * tsx 跑 node:test 时无法解析 `.module.css`；这两个组件的 SSR 标记测试必须能单独加载。
 */

export type ExamObservation = {
  bodyPartId: string;
  title: string;
  detail: string;
  toolId: string;
  status: 'success' | 'blocked';
  sound: 'fine-crackles' | 'wheeze' | null;
};

/**
 * 大区按钮 + 就地放射扇形（决策 2）：常驻只显示 6 个大区，点开后才在原位散射出该区子部位。
 * 24 个部位一次性平铺会互相重叠、手机上必然误触，所以把「选哪个部位」拆成两步。
 * 同时只允许一个大区展开（openRegion 是单值），扇形张开时其余大区淡出，杜绝两层按钮叠在一起。
 * 几何量与文案必须与 exam-regions 同源，不能各写一份，否则单测校验的落点等于白测。
 */
export function ExamRegionMarker({ region, posture, open, busy, observation, onToggle, onExamine }: { region: ExamRegion; posture: 'standing' | 'supine'; open: boolean; busy: boolean; observation: ExamObservation | null; onToggle: () => void; onExamine: (part: string) => void }) {
  const parts = region.parts as readonly string[];
  const observedInRegion = observation && parts.includes(observation.bodyPartId) ? observation.status : undefined;
  // 锚点用百分比 + 固定按钮宽度：与 exam-regions 的 regionAnchor 几何模型逐项对齐，
  // 扇形原点（.exam-region 的 50%/50%）因此正好落在模型算出的锚点上，不需要量真实像素。
  const top = `${region.anchorTop[posture === 'supine' ? 1 : 0]}%`;
  const anchorStyle: CSSProperties = region.side === 'left'
    ? { top, left: `${REGION_EDGE_INSET}%`, width: REGION_TRIGGER_WIDTH }
    : { top, right: `${REGION_EDGE_INSET}%`, width: REGION_TRIGGER_WIDTH };
  return (
    <div className="exam-region" data-region={region.id} data-side={region.side} data-open={open || undefined} style={anchorStyle}>
      <button type="button" className="exam-region-trigger" disabled={busy} aria-expanded={open} data-observed={observedInRegion} onClick={onToggle}><span aria-hidden="true" />{region.label}</button>
      {open && <div className="exam-region-fan" role="group" aria-label={`${region.label}：选择要检查的部位`}>
        {region.parts.map((part, index) => <button
          key={part}
          type="button"
          className="exam-fan-item"
          disabled={busy}
          data-observed={observation?.bodyPartId === part ? observation.status : undefined}
          style={{ '--fan-angle': `${fanAngle(region, index)}deg`, '--fan-r': `${fanRadiusPercent(region, index)}cqw` } as CSSProperties}
          onClick={() => onExamine(part)}
        >{partLabel(part)}</button>)}
      </div>}
    </div>
  );
}

/**
 * 双层查体反馈（决策 1/6）。
 * 第一层「本例所见」是服务端释放的病例原文，前端一字不改；资料未提供时保留诚实占位，不补正常结果。
 * 第二层「通用要领」是客户端静态查表，只讲规范操作与一般规律下的正常表现，强制带未审核徽标；
 * 它不进会话事件、报告快照与评分证据链，所以未经临床审核的文案永远不会变成成绩。
 */
export function ExamObservationCard({ observation, onClose, onReplayAudio }: { observation: ExamObservation; onClose: () => void; onReplayAudio: () => void }) {
  const note = examTechniqueNote(observation.toolId, observation.bodyPartId);
  return (
    <div className="exam-observation" data-status={observation.status} role="status">
      <div className="exam-observation-head">
        <span className="exam-observation-icon">{observation.status === 'success' ? <Stethoscope /> : <AlertTriangle />}</span>
        <p><small>{observation.status === 'success' ? '本例所见 · 摘自病例原始记录' : '本例未获得结果'}</small><strong>{observation.title}</strong></p>
        <button type="button" onClick={onClose} aria-label="关闭查体反馈"><X size={16} /></button>
      </div>
      <p className="exam-observation-detail">{observation.detail}</p>
      {observation.sound && <button type="button" className="exam-auscultation" data-sound={observation.sound} onClick={onReplayAudio}><Volume2 size={15} /><span /><span /><span /><span /><span />{observation.sound === 'wheeze' ? '重播哮鸣音' : '重播湿啰音'}</button>}
      {note && <div className="exam-technique-note">
        <span className="exam-technique-badge">{TECHNIQUE_NOTE_BADGE}</span>
        {note.kind === 'routine'
          ? <><p><strong>操作要领</strong>{note.technique}</p><p><strong>一般正常表现</strong>{note.expectedNormal}</p></>
          : <p><strong>这一组合不属常规查体</strong>{note.note}</p>}
      </div>}
    </div>
  );
}
