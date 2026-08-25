import { ArrowRight, HeartHandshake, ListChecks, ShieldAlert, Stethoscope } from 'lucide-react';

const practices = [
  { icon: ListChecks, title: '儿科病史采集', text: '识别低龄患儿与家长的有效信息来源，完成危险信号追问。' },
  { icon: Stethoscope, title: '肺部规范查体', text: '练习准备动作、器材与部位匹配，形成可验证操作证据。' },
  { icon: ShieldAlert, title: '感染与危重识别', text: '整合血氧、呼吸频率和局灶体征，确定处置优先级。' },
  { icon: HeartHandshake, title: '家长焦虑沟通', text: '在共情基础上解释风险、检查目的和下一步安排。' },
];

export default function PracticePage() {
  return (
    <>
      <p className="eyebrow">专项训练</p><h1 className="page-title">从一个薄弱点开始补练</h1><p className="page-lead">四个任务复用同一病例记忆和评分证据，不另建零散小系统。</p>
      <div className="entry-list" style={{ marginTop: 22 }}>
        {practices.map(({ icon: Icon, title, text }) => <a className="entry" href="/student/training?mode=practice" key={title}><span className="entry-mark"><Icon /></span><h3>{title}</h3><p>{text}</p><span className="entry-meta">开始训练 <ArrowRight size={14} /></span></a>)}
      </div>
    </>
  );
}
