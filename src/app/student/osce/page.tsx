import { ArrowRight, Clock3, EyeOff, FileCheck2, ShieldCheck } from 'lucide-react';

export default function OscePage() {
  return (
    <>
      <p className="eyebrow">OSCE 标准化考站</p><h1 className="page-title">儿童发热伴气促考站</h1><p className="page-lead">考核复用旗舰病例与统一智能体，仅切换考核约束和评分策略。</p>
      <section className="hero-desk">
        <p className="eyebrow" style={{ color: '#e3bd7b' }}>8 分钟 · 100 分</p><h1>准备好后一次性开始</h1>
        <p>系统会保存每轮问答、器材与部位操作、诊断、处置和沟通原文，时间结束自动提交。</p>
        <div className="hero-actions"><a className="btn btn-primary" href="/student/training?mode=osce">开始考核 <ArrowRight size={17} /></a></div>
      </section>
      <div className="entry-list" style={{ marginTop: 16 }}>
        {[[Clock3,'限时自动提交','剩余时间持续显示；时间到后冻结现有证据。'],[EyeOff,'全程无教学提示','错误操作只记录扣分，不揭示正确答案。'],[FileCheck2,'可解释评分','报告逐项关联原始问答和操作证据。'],[ShieldCheck,'异常不丢记录','模型异常时保存完整过程并标记待生成报告。']].map(([Icon,title,text]) => { const I = Icon as typeof Clock3; return <div className="entry" key={String(title)}><span className="entry-mark"><I /></span><h3>{String(title)}</h3><p>{String(text)}</p></div>; })}
      </div>
    </>
  );
}
