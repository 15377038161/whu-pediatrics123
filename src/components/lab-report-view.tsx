import type {LabReport} from '@/domain/lab-report';
export function LabReportView({report}:{report:LabReport}){
  if(!report.rows.length)return null;
  return <section className="released-lab-report" aria-label={`${report.name}数值报告`}><header><strong>{report.name}</strong><small>{report.origin==='source'?'原始报告数值摘录':report.origin==='teaching-simulation'?'教学模拟数值':'参考信息'}</small></header><p>标本：{report.specimen}</p><div className="lab-report-scroll"><table><thead><tr><th>指标</th><th>原始结果</th><th>单位</th><th>原报告时点</th></tr></thead><tbody>{report.rows.map((r,i)=><tr key={i}><th scope="row">{r.item}</th><td>{r.value}</td><td>{r.unit}</td><td>{r.reportedAt}</td></tr>)}</tbody></table></div><p>参考与解释：{report.reference}</p><small>仅重新排版原文已给出的数值；未注明的单位或标本不擅自补写。完整原文可在本项记录中核对。</small></section>;
}
