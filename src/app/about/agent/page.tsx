import { BrainCircuit, Database, GitBranch, LockKeyhole, SearchCheck, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { requirePageUser } from '@/lib/page-auth';

export default async function AgentAboutPage() {
  const user = await requirePageUser();
  return <AppShell user={user}><p className="eyebrow">智能体透明说明</p><h1 className="page-title">一个内核，贯穿完整临床训练</h1><p className="page-lead">页面不是四个互不关联的模块；所有操作共用病例版本、会话状态、证据链和智能体记忆。</p>
    <section className="hero-desk"><p className="eyebrow" style={{ color: '#e3bd7b' }}>UNIFIED PEDIATRIC TEACHING AGENT</p><h1>输入 → 状态理解 → 技能调用 → 临床反馈</h1><p>智能体调度角色模拟、确定性查体规则、知识检索、安全校验和 OSCE 评分，只公开调用技能与依据，不暴露内部思维过程。</p></section>
    <div className="entry-list" style={{ marginTop: 16 }}>
      {[[BrainCircuit,'动态角色调度','依据年龄、问题和情绪决定患儿、家长或双方作答。'],[GitBranch,'统一病例状态','问诊、查体、诊断与沟通共享同一个版本化状态。'],[SearchCheck,'可追溯知识','只引用明确来源；无可靠命中时返回暂无经审核依据。'],[ShieldCheck,'确定性临床规则','器材、部位、准备动作和顺序由规则校验，模型不能编造体征。'],[Database,'完整过程证据','Coze 数据库保存问答、操作、报告和同步队列。'],[LockKeyhole,'权限边界','学生仅看本人，教师只读授权群组，生产入口强制超星认证。']].map(([Icon,title,text]) => { const I = Icon as typeof BrainCircuit; return <div className="entry" key={String(title)}><span className="entry-mark"><I /></span><h3>{String(title)}</h3><p>{String(text)}</p></div>; })}
    </div>
  </AppShell>;
}
