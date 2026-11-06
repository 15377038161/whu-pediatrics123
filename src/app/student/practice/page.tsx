import { Suspense } from 'react';
import { Baby, Calculator, ClipboardList, FileText, ListChecks, Sparkles } from 'lucide-react';
import { MedicalBackdrop } from '@/components/medical-backdrop';
import { PracticeFocusGrid } from '@/components/practice-focus-grid';

export default function PracticePage() {
  return (
    <MedicalBackdrop>
      <p className="eyebrow">一轮聚焦一个临床能力</p><h1 className="page-title">临床能力专项</h1><p className="page-lead">每种专项只开放对应任务与证据，可独立开始、续训和重练；提示只给方向，不替你作答。专项不是完整接诊流程的复刻，只练其中一个环节。</p>
      <section className="practice-callout"><span className="practice-spark"><Sparkles /></span><div><strong>没有指定病例时，点卡片由系统随机抽一例</strong><p>从训练报告的「去做专项补练」进来会自动带上原病例与报告里最该补的那一项，卡片会标出「报告推荐补练」；临床能力专项会把训练重点写入本轮记录，完成后仍可查看原始问答和操作证据。</p></div></section>
      {/* useSearchParams 需要 Suspense 边界（项目既有约定），否则整页退化为客户端渲染并在构建期报错。 */}
      <Suspense fallback={<div className="practice-grid" aria-busy="true"><p className="page-lead">正在读取专项配置…</p></div>}>
        <PracticeFocusGrid />
      </Suspense>
      <section className="report-section" style={{ marginTop: 20 }}>
        <h2>技能操作要点与儿科计算工具</h2>
        <p style={{ margin: '6px 0 12px', fontSize: 14, lineHeight: 1.8 }}>病史采集为第一站的结构化书面练习，按问诊要点判分并列出漏问项；技能操作正文对应第二站「体格检查与基本操作」，逐条给出适应证、禁忌症、穿刺点与分步操作；剂量与发育评估为儿科教学计算工具，按实测体重、月龄与体格值确定性计算并展示手算过程。全部不经模型生成，超出教材适用范围或未收录的输入直接拒绝，不外推。</p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="/student/history-taking"><FileText size={16} /> 病史采集提纲</a>
          <a className="btn btn-primary" href="/student/procedures"><ClipboardList size={16} /> 技能操作要点</a>
          <a className="btn btn-primary" href="/student/dosing"><Calculator size={16} /> 用药剂量计算</a>
          <a className="btn btn-primary" href="/student/growth"><Baby size={16} /> 生长发育评估</a>
          <a className="btn btn-quiet" href="/student/exam-stations"><ListChecks size={16} /> 执医三站对照</a>
        </div>
      </section>
    </MedicalBackdrop>
  );
}
