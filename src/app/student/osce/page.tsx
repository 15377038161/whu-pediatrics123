import { ArrowRight, CheckCircle2, Clock3, EyeOff, FileCheck2, ShieldCheck, Stethoscope } from 'lucide-react';

export default function OscePage() {
  return (
    <>
      <p className="eyebrow">OSCE 标准化考站</p><h1 className="page-title">儿童发热伴气促考站</h1><p className="page-lead">进入后计时立即开始。请像真实接诊一样，自主组织问诊、查体、判断和沟通。</p>
      <section className="hero-desk osce-hero">
        <div className="osce-station-bar" aria-label="考站信息"><div><span>OSCE 01</span><strong>儿童呼吸系统考站</strong></div><div className="osce-station-timer"><Clock3 /><span>考核时长</span><strong>08:00</strong></div></div>
        <div className="osce-hero-copy"><p className="eyebrow">100 分 · 一次作答</p><h1>准备好后，再推开考站的门</h1>
        <p>系统会保存每轮问答、器材与部位操作、诊断、处置和沟通原文，时间结束自动提交。</p>
        <div className="hero-actions"><a className="btn btn-primary" href="/student/training?mode=osce">开始考核 <ArrowRight size={17} /></a><a className="btn btn-secondary" href="/student/practice"><Stethoscope size={16} /> 先做专项热身</a></div></div>
      </section>
      <section className="readiness-card"><h2>开始前 30 秒确认</h2><div><span><CheckCircle2 /> 网络稳定</span><span><CheckCircle2 /> 预留完整 8 分钟</span><span><CheckCircle2 /> 熟悉器材点击方式</span></div></section>
      <div className="entry-list" style={{ marginTop: 16 }}>
        {[[Clock3,'限时自动提交','剩余时间持续显示；时间到后冻结现有证据。'],[EyeOff,'全程无教学提示','错误操作只记录扣分，不揭示正确答案。'],[FileCheck2,'可解释评分','报告逐项关联原始问答和操作证据。'],[ShieldCheck,'异常不丢记录','模型异常时保存完整过程并标记待生成报告。']].map(([Icon,title,text]) => { const I = Icon as typeof Clock3; return <div className="entry" key={String(title)}><span className="entry-mark"><I /></span><h3>{String(title)}</h3><p>{String(text)}</p></div>; })}
      </div>
    </>
  );
}
