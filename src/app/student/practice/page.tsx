import { ArrowRight, Clock3, HeartHandshake, ListChecks, ShieldAlert, Sparkles, Stethoscope } from 'lucide-react';
import { MedicalBackdrop } from '@/components/medical-backdrop';
import { practiceScenarios } from '@/domain/practice-scenarios';

const practices = [
  { id: 'history', scenario: practiceScenarios.history, icon: ListChecks, method: '自由追问患儿或家长，提交病史小结，可补充后再交。', feedback: '按病史要点与提问组织反馈，保留问答和小结。', minutes: 10, tone: 'mint' },
  { id: 'exam', scenario: practiceScenarios.exam, icon: Stethoscope, method: '选择体位、视触叩听与器材，自主定位并按顺序操作。', feedback: '反馈准备、顺序与证据关联；观察原文供教师复核。', minutes: 9, tone: 'sky' },
  { id: 'safety', scenario: practiceScenarios.safety, icon: ShieldAlert, method: '阅读已提供病史和初筛体征，提交危险判断与处置优先级。', feedback: '按危险信号、判断依据和处置优先级反馈。', minutes: 10, tone: 'sun' },
  { id: 'communication', scenario: practiceScenarios.communication, icon: HeartHandshake, method: '围绕患儿情境与家长模拟沟通，解释风险、回应顾虑并确认理解。', feedback: '保留沟通原文与目标覆盖情况，供教师复核，不做机器评分。', minutes: 9, tone: 'coral' },
] as const;

export default function PracticePage() {
  return (
    <MedicalBackdrop>
      <p className="eyebrow">一轮聚焦一个临床能力</p><h1 className="page-title">临床能力专项</h1><p className="page-lead">每种专项只开放对应任务与证据，可独立开始、续训和重练；提示只给方向，不替你作答。</p>
      <section className="practice-callout"><span className="practice-spark"><Sparkles /></span><div><strong>推荐从报告中的第一项“待补练”开始</strong><p>临床能力专项会把训练重点写入本轮记录，完成后仍可查看原始问答和操作证据。</p></div></section>
      <div className="practice-grid">
        {practices.map(({ id, scenario, icon: Icon, method, feedback, minutes, tone }) => <a className="practice-card" data-tone={tone} href={`/student/training?mode=practice&focus=${id}`} key={id}><span className="practice-icon"><Icon /></span><div><span className="practice-duration"><Clock3 size={13} /> 约 {minutes} 分钟</span><h2>{scenario.title}</h2><p>{scenario.goal}</p><div className="practice-card-details"><p><strong>练习</strong>{method}</p><p><strong>反馈</strong>{feedback}</p></div><span className="entry-meta">开始专项 <ArrowRight size={14} /></span></div></a>)}
      </div>
    </MedicalBackdrop>
  );
}
