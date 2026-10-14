import { teachingCopy } from '@/domain/teaching-copy';
import { ArrowRight, Clock3, HeartHandshake, ListChecks, ShieldAlert, Sparkles, Stethoscope } from 'lucide-react';

const practices = [
  { id: 'history', icon: ListChecks, title: '儿科病史采集', text: teachingCopy.historyPractice, minutes: 10, tone: 'mint' },
  { id: 'exam', icon: Stethoscope, title: '肺部规范查体', text: teachingCopy.examPractice, minutes: 9, tone: 'sky' },
  { id: 'safety', icon: ShieldAlert, title: '儿童危重症识别', text: teachingCopy.safetyPractice, minutes: 10, tone: 'sun' },
  { id: 'communication', icon: HeartHandshake, title: '家长焦虑沟通', text: teachingCopy.communicationPractice, minutes: 9, tone: 'coral' },
];

export default function PracticePage() {
  return (
    <>
      <p className="eyebrow">能力补给站</p><h1 className="page-title">一轮聚焦一个临床能力</h1><p className="page-lead">在完整接诊流程中强化一个训练重点，保留真实自由输入、患儿与家长应答和证据记录；提示只给方向，不替你作答。</p>
      <section className="practice-callout"><span className="practice-spark"><Sparkles /></span><div><strong>推荐从报告中的第一项“待补练”开始</strong><p>专项入口会把训练重点写入本轮记录，完成后仍可查看原始问答和操作证据。</p></div></section>
      <div className="practice-grid">
        {practices.map(({ id, icon: Icon, title, text, minutes, tone }) => <a className="practice-card" data-tone={tone} href={`/student/training?mode=practice&focus=${id}`} key={title}><span className="practice-icon"><Icon /></span><div><span className="practice-duration"><Clock3 size={13} /> 约 {minutes} 分钟</span><h2>{title}</h2><p>{text}</p><span className="entry-meta">开始专项 <ArrowRight size={14} /></span></div></a>)}
      </div>
    </>
  );
}
