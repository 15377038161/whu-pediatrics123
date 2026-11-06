'use client';

import { AlertTriangle, Stethoscope, Volume2, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { REGION_EDGE_INSET, REGION_TRIGGER_WIDTH, partLabel, type ExamRegion } from '@/domain/exam-regions';
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
 * 大区按钮：常驻只显示 6 个，点开后由 ExamRegionPanel 在图框底部给出该区子部位。
 * 同时只允许一个大区展开（openRegion 是单值），展开时其余大区淡出，杜绝两层按钮叠在一起。
 */
export function ExamRegionMarker({ region, posture, open, busy, observation, onToggle }: { region: ExamRegion; posture: 'standing' | 'supine'; open: boolean; busy: boolean; observation: ExamObservation | null; onToggle: () => void }) {
  const parts = region.parts as readonly string[];
  const observedInRegion = observation && parts.includes(observation.bodyPartId) ? observation.status : undefined;
  const top = `${region.anchorTop[posture === 'supine' ? 1 : 0]}%`;
  const anchorStyle: CSSProperties = region.side === 'left'
    ? { top, left: `${REGION_EDGE_INSET}%`, width: REGION_TRIGGER_WIDTH }
    : { top, right: `${REGION_EDGE_INSET}%`, width: REGION_TRIGGER_WIDTH };
  return (
    <div className="exam-region" data-region={region.id} data-side={region.side} data-open={open || undefined} style={anchorStyle}>
      <button type="button" className="exam-region-trigger" disabled={busy} aria-expanded={open} data-observed={observedInRegion} onClick={onToggle}><span aria-hidden="true" />{region.label}</button>
    </div>
  );
}

/**
 * 第二级选位面板：固定在图框底部，按网格排列子部位。
 * 不再沿大弧放射——7 个部位散落在头、胸、腹会让「鼻」「口咽」「颈部」离解剖位置很远，
 * 学生需要来回找；网格面板位置稳定、每颗按钮等高，窄图框自动降为两列并可滚动。
 */
export function ExamRegionPanel({ region, busy, observation, onExamine, onClose }: { region: ExamRegion; busy: boolean; observation: ExamObservation | null; onExamine: (part: string) => void; onClose: () => void }) {
  return (
    <div className="exam-region-panel" role="group" aria-label={`${region.label}：选择要检查的部位`}>
      <div className="exam-region-panel-head">
        <strong>{region.label}</strong><span>选择部位</span>
        <button type="button" className="exam-region-panel-close" disabled={busy} onClick={onClose} aria-label="收起部位选择"><X size={15} /></button>
      </div>
      <div className="exam-region-panel-grid">
        {region.parts.map((part) => <button
          key={part}
          type="button"
          className="exam-part-item"
          disabled={busy}
          data-observed={observation?.bodyPartId === part ? observation.status : undefined}
          onClick={() => onExamine(part)}
        >{partLabel(part)}</button>)}
      </div>
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
