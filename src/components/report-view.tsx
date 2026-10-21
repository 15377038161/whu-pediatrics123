import { ArrowRight, BookOpenCheck, CheckCircle2, CircleAlert, RotateCcw } from 'lucide-react';
import type { TrainingReport } from '@/domain/agent';
import { findPublicCase } from '@/domain/case-catalog';
import { RandomAdmission } from '@/components/random-admission';
import { findRubricForReport, isUnscoredReport, rubricStatusForDisplay, unscoredReasonForDisplay, type RubricItem } from '@/domain/training-rubric';
import { practiceScenarios } from '@/domain/practice-scenarios';

const dimensions: Array<{ key: keyof TrainingReport['abilities']; label: string; max: number }> = [
  { key: 'history', label: '儿科问诊', max: 25 },
  { key: 'examination', label: '规范查体', max: 25 },
  { key: 'reasoning', label: '临床推理', max: 20 },
  { key: 'safety', label: '感染与安全', max: 15 },
  { key: 'communication', label: '医患沟通', max: 10 },
  { key: 'professionalism', label: '职业素养', max: 5 },
];

const evaluationBasisLabels: Record<NonNullable<TrainingReport['evaluationBasis']>, string> = {
  clinical_rubric: '临床量表评分',
  process_completion: '过程完成度',
  quiz_accuracy: '测验正确率',
  unscored: '不计分',
};

export function ReportView({ report, readonly = false }: { report: TrainingReport; readonly?: boolean }) {
  const mode = report.mode === 'osce' ? 'OSCE 模拟站 · 模拟参考评分' : report.mode === 'practice' ? '专项训练' : '引导训练';
  // 降级查询：历史报告可能引用目录外 caseId（如早期探针/归档病例），降级展示 ID 而非 500
  // 防透题：优先使用报告 caseTitle（服务端在完成时写入的真实病种名——完成后释放），
  // 历史报告无该字段时降级公开目录标题（教师病例为中性标题，演示病例为症状标题）
  const caseProfile = findPublicCase(report.caseId);
  const caseTitle = report.caseTitle ?? caseProfile?.title ?? `病例 ${report.caseId}`;
  const processReport = report.scoreBasis === 'process';
  // 量表元数据（方案 4.6）：报告快照带 rubricId/version/evaluationBasis；历史报告无 rubricId 时降级展示固定六维。
  const rubric = findRubricForReport(report);
  // 适用满分口径（方案 4.4）：总满分=适用计分项满分之和；无法评价/不适用项不计入维度满分。
  const evidenceStatusByCode = new Map(report.evidence.map((item) => [item.code, item.status]));
  const isAssessableRubricItem = (item: RubricItem): boolean => {
    const status = evidenceStatusByCode.get(`RUBRIC_${item.itemId}`);
    return status !== 'not_applicable' && status !== 'not_assessable';
  };
  const evaluationBasis = report.evaluationBasis ?? (processReport ? 'process_completion' : 'clinical_rubric');
  const focusScenario = report.practiceFocus ? practiceScenarios[report.practiceFocus] : null;
  // C-观察与报告-04：全部计分项均不可评价的报告记「未评分」——总分 0 不代表能力 0 分，
  // 分数环不显示 0 分而显示「未评分」与缺少判据的原因（历史报告按快照推导，不重算）。
  const unscored = isUnscoredReport(report);
  const unscoredReason = unscored ? unscoredReasonForDisplay(report) : null;
  return (
    <div>
      <section className="report-hero">
        <div className="score-ring" aria-label={unscored ? '未评分' : `总分 ${report.totalScore} 分`}><strong>{unscored ? '未评分' : report.totalScore}</strong></div>
        <div>
          <p className="eyebrow">{mode}{focusScenario ? ` · ${focusScenario.title}` : ''} · {readonly ? '只读报告' : '训练完成'}</p>
          <h1>{caseTitle}</h1>
          <p>{processReport ? '分数表示训练过程完成度。原病例诊断与诊疗经过用于对照，诊断和处置的正确性由教师复核。' : report.mode === 'osce' ? '模拟站参考评分依据实际问答、器材操作、临床决策与沟通原文生成，不构成正式考试成绩。' : '报告依据实际问答、器材操作、临床决策与沟通原文生成。'}</p>
          <p style={{ fontSize: 13, opacity: 0.75 }}>评分量表：{rubric ? `${rubric.name}（v${report.rubricVersion}）` : `版本 v${report.rubricVersion ?? '未记录'} 的历史量表定义未存档，按报告快照展示`} · 成绩口径：{evaluationBasisLabels[evaluationBasis]}{report.assessableMaxScore !== undefined && !unscored ? ` · 可评价满分：${report.assessableMaxScore} 分（无法评价/不适用项不计入）` : ''}</p>
          {unscoredReason && <p style={{ fontSize: 13, opacity: 0.75 }} role="note">未评分说明：{unscoredReason}</p>}
        </div>
      </section>
      <div className="report-grid">
        <section className="report-section"><h2>你的诊断与依据</h2><p><strong>初步诊断：</strong>{report.studentDecision?.diagnosis || '历史报告未保存此项'}</p><p className="preserve-lines"><strong>诊断依据：</strong>{report.studentDecision?.diagnosisBasis || '历史记录未填写诊断依据'}</p></section>
        <section className="report-section">
          <h2>{processReport ? '六环节完成度' : rubric?.scope === 'focused' ? '专项能力画像' : '六维能力画像'}</h2>
          <div className="dimension-list">
            {dimensions
              .filter(({ key }) => processReport || !rubric || rubric.items.some((item) => item.dimension === key))
              .map(({ key, label, max }) => {
                const dimensionMax = rubric
                  ? rubric.items.filter((item) => item.dimension === key && isAssessableRubricItem(item)).reduce((sum, item) => sum + item.maxScore, 0)
                  : max;
                const width = dimensionMax > 0 ? Math.min(100, report.abilities[key] / dimensionMax * 100) : 0;
                return (
                  <div className="dimension" key={key}>
                    <span>{processReport ? report.evidence.find((item) => item.code === `SOURCE_PROCESS_${key}`)?.label ?? label : label}</span>
                    <div className="dimension-track" aria-hidden="true"><i style={{ width: `${width}%` }} /></div>
                    <strong>{rubric ? (dimensionMax > 0 ? `${report.abilities[key]}/${dimensionMax}` : '无法评价') : report.abilities[key]}</strong>
                  </div>
                );
              })}
          </div>
        </section>
        <section className="report-section">
          <h2><BookOpenCheck size={18} style={{ verticalAlign: -4, marginRight: 6 }} />下一步补练</h2>
          <p>{report.recommendation}</p>
          {report.strengths.length > 0 && <p><strong>已经掌握：</strong>{report.strengths.join('、')}</p>}
          {report.improvements.length > 0 && <p><strong>重点改进：</strong>{report.improvements.join('、')}</p>}
          {!readonly && <div className="report-actions"><RandomAdmission excludeCaseId={report.caseId} label="接诊下一位患儿" /><a className="btn btn-primary" href="/student/practice"><RotateCcw size={16} /> 去做专项补练</a><a className="text-link" href={`/student/training?mode=guided&case=${encodeURIComponent(report.caseId)}`}>再练一次 <ArrowRight size={14} /></a></div>}
        </section>
      </div>
      <section className="report-section" style={{ marginTop: 14 }}>
        <h2>{processReport ? '过程证据与原病例对照' : '评分证据'}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="evidence-table">
            <thead><tr><th>评分项</th><th>状态</th><th>得分</th><th>原始证据说明</th></tr></thead>
            <tbody>
              {report.evidence.map((item) => (
                <tr key={item.code}>
                  <td><strong>{item.label}</strong></td>
                  <td className="evidence-status" data-ok={item.status ? item.status === 'achieved' : item.achieved}>{item.status ? rubricStatusForDisplay(item.status) : item.achieved ? <><CheckCircle2 size={14} /> 达成</> : <><CircleAlert size={14} /> 待补练</>}</td>
                  <td>{item.maxScore === 0 ? '原文对照' : `${item.score}/${item.maxScore}`}</td>
                  <td>{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {report.studentSubmissions && (
        <section className="report-section" style={{ marginTop: 14 }}>
          <h2>原始提交快照</h2>
          <p style={{ fontSize: 13, opacity: 0.75 }}>报告生成时冻结的最终提交原文，不随会话状态变化；修改提交需重新训练生成新报告。</p>
          <p><strong>初步诊断：</strong>{report.studentSubmissions.decision?.diagnosis || '未提交'}</p>
          <p className="preserve-lines"><strong>病情摘要：</strong>{report.studentSubmissions.decision?.summary || '未提交'}</p>
          {report.studentSubmissions.decision?.diagnosisBasis && <p className="preserve-lines"><strong>诊断依据：</strong>{report.studentSubmissions.decision.diagnosisBasis}</p>}
          {report.studentSubmissions.decision?.differentials && <p className="preserve-lines"><strong>鉴别诊断：</strong>{report.studentSubmissions.decision.differentials}</p>}
          <p className="preserve-lines"><strong>处置优先级：</strong>{report.studentSubmissions.plan?.priority || '未提交'}</p>
          <p className="preserve-lines"><strong>处置计划：</strong>{report.studentSubmissions.plan?.detail || '未提交'}</p>
          {report.studentSubmissions.communication && <p className="preserve-lines"><strong>家长沟通原文：</strong>{report.studentSubmissions.communication}</p>}
          {report.studentSubmissions.historySummary && <p className="preserve-lines"><strong>病史摘要：</strong>{report.studentSubmissions.historySummary}</p>}
          {report.studentSubmissions.examObservation && <p className="preserve-lines"><strong>查体观察记录：</strong>{report.studentSubmissions.examObservation.findings}{report.studentSubmissions.examObservation.interpretation && <>；<strong>观察解释：</strong>{report.studentSubmissions.examObservation.interpretation}</>}</p>}
        </section>
      )}
    </div>
  );
}
