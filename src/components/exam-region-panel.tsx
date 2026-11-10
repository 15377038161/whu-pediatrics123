'use client';

import { AlertTriangle, Check, Stethoscope, Volume2, X } from 'lucide-react';
import { TECHNIQUE_NOTE_BADGE, examTechniqueNote } from '@/domain/exam-technique-notes';

export type ExamObservation = {
  bodyPartId: string;
  title: string;
  detail: string;
  toolId: string;
  status: 'success' | 'blocked';
  sound: 'fine-crackles' | 'wheeze' | null;
};

/** Keep results in the shared record so the patient and anatomical targets stay visible. */
export function ExamOperationFeedback({observation,onClose,onReplayAudio,showReference=true}:{observation:ExamObservation|null;onClose:()=>void;onReplayAudio:()=>void;showReference?:boolean}){
  if(!observation)return null;
  if(observation.status==='blocked')return <aside className="ce-feedback-error" aria-label="查体错误提示"><ExamObservationCard observation={observation} onClose={onClose} onReplayAudio={onReplayAudio} showReference={showReference}/></aside>;
  return <div className="ce-feedback-saved" role="status"><Check size={16}/><span><strong>{observation.title}已记录</strong><small>详细所见见共享病例记录</small></span><button type="button" aria-label="关闭查体反馈" onClick={onClose}><X size={15}/></button></div>;
}

export function ExamObservationCard({ observation, onClose, onReplayAudio, showReference = true }: { observation: ExamObservation; onClose: () => void; onReplayAudio: () => void; showReference?: boolean }) {
  const note = examTechniqueNote(observation.toolId, observation.bodyPartId);
  const structured = observation.status === 'success' ? observation.detail.match(/^([\s\S]*?)\n操作：([\s\S]*?)\n配合反应：([\s\S]*)$/) : null;
  return (
    <div className="exam-observation" data-status={observation.status} role="status">
      <div className="exam-observation-head">
        <span className="exam-observation-icon">{observation.status === 'success' ? <Stethoscope /> : <AlertTriangle />}</span>
        <p><small>{observation.status === 'success' ? observation.toolId === 'hand-hygiene' ? '检查准备已完成' : observation.detail.includes('【局部教学补充')?'本例所见 · 固定局部教学设定':observation.detail.includes('【教学模拟】')?'本例所见 · 教学模拟设定':observation.detail.includes('【操作与参考说明】')?'操作与参考说明':'本例所见 · 摘自病例原始记录' : '本例未获得结果'}</small><strong>{observation.title}</strong></p>
        <button type="button" onClick={onClose} aria-label="关闭查体反馈"><X size={16} /></button>
      </div>
      <div className="exam-observation-detail">
        {structured ? <dl className="ce-findings"><dt>客观所见</dt><dd>{structured[1]}</dd>{showReference&&<><dt>检查过程</dt><dd>{structured[2]}</dd><dt>患儿反应</dt><dd>{structured[3]}</dd></>}</dl> : <p>{observation.detail}</p>}
      </div>
      {observation.sound && <button type="button" className="exam-auscultation" data-sound={observation.sound} onClick={onReplayAudio}><Volume2 size={15} /><span /><span /><span /><span /><span />{observation.sound === 'wheeze' ? '重播哮鸣音' : '重播湿啰音'}</button>}
      {showReference && note && <details className="exam-technique-note" open={observation.status==='success'&&!structured}>
        <summary>查看操作要领与正常表现参考</summary>
        <span className="exam-technique-badge">{TECHNIQUE_NOTE_BADGE}</span>
        {note.kind === 'routine'
          ? <><p><strong>操作要领</strong>{note.technique}</p><p><strong>一般正常表现</strong>{note.expectedNormal}</p></>
          : <p><strong>这一组合不属常规查体</strong>{note.note}</p>}
      </details>}
    </div>
  );
}
