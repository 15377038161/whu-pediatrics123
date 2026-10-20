import { ArrowRight, CheckCircle2, Clock3, EyeOff, FileCheck2, ShieldCheck, Stethoscope } from 'lucide-react';
import { formatTimeLimit, listReadyStations } from '@/domain/osce-stations';

/** OSCE 模拟站（方案 15）：站点契约（时限/能力目标/开放动作/技术故障规则）是唯一来源，
 *  页面展示与服务端计时/门控共用同一配置；报告为「模拟参考评分」，不出现正式考试成绩。 */
export default function OscePage() {
  // 只有标准、资料和技术链都通过的 ready 站点才作为可用站点发布。
  const station = listReadyStations()[0];
  return (
    <>
      <p className="eyebrow">OSCE 模拟站</p><h1 className="page-title">{station?.title ?? 'OSCE 模拟站'}</h1><p className="page-lead">进入后计时立即开始。请像真实接诊一样，自主组织问诊、查体、判断和沟通；结束后生成模拟参考评分，不构成正式考试成绩。</p>
      <section className="hero-desk osce-hero">
        <div className="osce-station-bar" aria-label="模拟站信息"><div><span>模拟站 01</span><strong>{station?.title}</strong></div><div className="osce-station-timer"><Clock3 /><span>模拟时长</span><strong>{station ? formatTimeLimit(station.timeLimitSeconds) : '08:00'}</strong></div></div>
        <div className="osce-hero-copy"><p className="eyebrow">参考评分 · 一次作答</p><h1>准备好后，再进入模拟站</h1>
        <p>系统会保存每轮问答、器材与部位操作、诊断、处置和沟通原文；手动结束或时间到都会冻结已确认提交并生成报告。</p>
        <div className="hero-actions"><a className="btn btn-primary" href="/student/training?mode=osce">进入模拟站 <ArrowRight size={17} /></a><a className="btn btn-secondary" href="/student/practice"><Stethoscope size={16} /> 先做专项热身</a></div></div>
      </section>
      <section className="readiness-card"><h2>开始前 30 秒确认</h2><div><span><CheckCircle2 /> 网络稳定</span><span><CheckCircle2 /> 预留完整 {Math.round((station?.timeLimitSeconds ?? 480) / 60)} 分钟</span><span><CheckCircle2 /> 熟悉器材点击方式</span><span><CheckCircle2 /> 计时由服务器保存，刷新不重置</span></div></section>
      {station && (
        <section className="report-section" style={{ marginTop: 16 }}>
          <h2>能力目标与技术规则</h2>
          <ul style={{ margin: '8px 0 10px', paddingLeft: 20, lineHeight: 1.9 }}>
            {station.capabilityGoals.map((goal) => <li key={goal}>{goal}</li>)}
          </ul>
          <p style={{ fontSize: 13, opacity: 0.8 }}>
            技术故障规则：模型或语音异常时保留过程并显示技术影响，不按沉默扣分；本站计时{station.technicalInterruptionPolicy.pausesTimerOnInterruption ? '在平台异常时暂停' : '不因平台异常暂停'}，规则在开始前公布。时间到后服务端拒绝新增临床操作，已确认提交原样保留。
          </p>
        </section>
      )}
      <div className="entry-list" style={{ marginTop: 16 }}>
        {[[Clock3,'限时冻结提交','剩余时间持续显示；时间到后冻结已确认提交，服务端拒绝新增操作。'],[EyeOff,'全程无教学提示','错误操作只记录过程，不揭示正确答案。'],[FileCheck2,'参考评分可解释','报告逐项关联原始问答和操作证据，不构成正式考试成绩。'],[ShieldCheck,'异常不丢记录','模型异常时保存完整过程并标记待生成报告。']].map(([Icon,title,text]) => { const I = Icon as typeof Clock3; return <div className="entry" key={String(title)}><span className="entry-mark"><I /></span><h3>{String(title)}</h3><p>{String(text)}</p></div>; })}
      </div>
    </>
  );
}
