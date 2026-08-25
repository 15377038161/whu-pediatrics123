import { ArrowRight, FileText } from 'lucide-react';
import { AgentRepository } from '@/lib/repository';
import { requirePageUser } from '@/lib/page-auth';

export default async function ReportsPage() {
  const user = await requirePageUser('student');
  const reports = await new AgentRepository(user).listOwnReports();
  return (
    <>
      <p className="eyebrow">个人学情档案</p><h1 className="page-title">训练报告</h1><p className="page-lead">每份报告都可以回到评分证据，不以模型印象替代真实操作。</p>
      {reports.length === 0 ? <div className="empty-state"><FileText /><h2>还没有训练报告</h2><p>完成一轮模拟病例或 OSCE 后，报告会出现在这里。</p><a className="btn btn-primary" href="/student/training?mode=guided">开始首轮训练</a></div> : (
        <div className="choice-list" style={{ marginTop: 22 }}>{reports.map((report) => <a className="choice" key={report.id} href={`/student/reports/${report.id}`}><strong>{report.mode === 'osce' ? 'OSCE考核' : '模拟病例'} · {report.totalScore} 分</strong><span>{new Date(report.createdAt).toLocaleString('zh-CN')} · 查看证据与补练建议 <ArrowRight size={13} /></span></a>)}</div>
      )}
    </>
  );
}
