import { BookOpenCheck, CheckCircle2, CircleAlert } from 'lucide-react';
import type { TrainingReport } from '@/domain/agent';
import { getPublicCase } from '@/domain/case-catalog';

const dimensions: Array<{ key: keyof TrainingReport['abilities']; label: string; max: number }> = [
  { key: 'history', label: '儿科问诊', max: 25 },
  { key: 'examination', label: '规范查体', max: 25 },
  { key: 'reasoning', label: '临床推理', max: 20 },
  { key: 'safety', label: '感染与安全', max: 15 },
  { key: 'communication', label: '医患沟通', max: 10 },
  { key: 'professionalism', label: '职业素养', max: 5 },
];

export function ReportView({ report, readonly = false }: { report: TrainingReport; readonly?: boolean }) {
  const mode = report.mode === 'osce' ? 'OSCE考核' : report.mode === 'practice' ? '专项训练' : '引导训练';
  const caseProfile = getPublicCase(report.caseId);
  return (
    <div>
      <section className="report-hero">
        <div className="score-ring" aria-label={`总分 ${report.totalScore} 分`}><strong>{report.totalScore}</strong></div>
        <div>
          <p className="eyebrow" style={{ color: '#e3bd7b' }}>{mode} · {readonly ? '只读报告' : '训练完成'}</p>
          <h1>{caseProfile.title}</h1>
          <p>报告依据实际问答、器材操作、临床决策与沟通原文生成。</p>
        </div>
      </section>
      <div className="report-grid">
        <section className="report-section">
          <h2>六维能力画像</h2>
          <div className="dimension-list">
            {dimensions.map(({ key, label, max }) => (
              <div className="dimension" key={key}>
                <span>{label}</span>
                <div className="dimension-track" aria-hidden="true"><i style={{ width: `${report.abilities[key] / max * 100}%` }} /></div>
                <strong>{report.abilities[key]}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="report-section">
          <h2><BookOpenCheck size={18} style={{ verticalAlign: -4, marginRight: 6 }} />下一步补练</h2>
          <p>{report.recommendation}</p>
          {report.strengths.length > 0 && <p><strong>已经掌握：</strong>{report.strengths.join('、')}</p>}
          {report.improvements.length > 0 && <p><strong>重点改进：</strong>{report.improvements.join('、')}</p>}
        </section>
      </div>
      <section className="report-section" style={{ marginTop: 14 }}>
        <h2>评分证据</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="evidence-table">
            <thead><tr><th>评分项</th><th>状态</th><th>得分</th><th>原始证据说明</th></tr></thead>
            <tbody>
              {report.evidence.map((item) => (
                <tr key={item.code}>
                  <td><strong>{item.label}</strong></td>
                  <td className="evidence-status" data-ok={item.achieved}>{item.achieved ? <><CheckCircle2 size={14} /> 达成</> : <><CircleAlert size={14} /> 待补练</>}</td>
                  <td>{item.score}/{item.maxScore}</td>
                  <td>{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
