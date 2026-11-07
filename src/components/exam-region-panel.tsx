'use client';

import { AlertTriangle, Stethoscope, Volume2, X } from 'lucide-react';
import { TECHNIQUE_NOTE_BADGE, examTechniqueNote } from '@/domain/exam-technique-notes';

export type ExamObservation = {
  bodyPartId: string;
  title: string;
  detail: string;
  toolId: string;
  status: 'success' | 'blocked';
  sound: 'fine-crackles' | 'wheeze' | null;
};

export function ExamObservationCard({ observation, onClose, onReplayAudio }: { observation: ExamObservation; onClose: () => void; onReplayAudio: () => void }) {
  const note = examTechniqueNote(observation.toolId, observation.bodyPartId);
  return (
    <div className="exam-observation" data-status={observation.status} role="status">
      <div className="exam-observation-head">
        <span className="exam-observation-icon">{observation.status === 'success' ? <Stethoscope /> : <AlertTriangle />}</span>
        <p><small>{observation.status === 'success' ? observation.detail.includes('【教学模拟】')?'本例所见 · 教学模拟设定':observation.detail.includes('【操作与参考说明】')?'操作与参考说明':'本例所见 · 摘自病例原始记录' : '本例未获得结果'}</small><strong>{observation.title}</strong></p>
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
