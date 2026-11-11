import type { TeachingFeedback, TeachingRubricItem } from '@/domain/teaching-package';

const names: Record<string, string> = { history: '问诊', exam: '查体', tests: '辅助检查', diagnosis: '诊断与鉴别', plan: '处置与治疗', note: '病历书写', communication: '沟通' };
const necessityNames = { essential: '优先评估项目', optional: '合理可选项目', 'not-routine': '通常不推荐', 'context-dependent': '需要具体指征' };
const origins = { source: '原始记录', 'teaching-simulation': '教学模拟', reference: '参考说明' };
const displaySection = (item: TeachingFeedback['items'][number]): TeachingRubricItem['section'] => item.reportSection ?? item.section as TeachingRubricItem['section'];

export function TeachingFeedbackView({ feedback }: { feedback: TeachingFeedback }) {
  const sections = Object.entries(names).filter(([section]) => feedback.items.some(item => displaySection(item) === section));
  return <section className="workspace-panel" style={{ gridColumn: '1 / -1' }}>
    <div className="panel-head"><h2>本次教学练习逐项反馈</h2><strong>{feedback.totalScore.toFixed(1)} / {feedback.assessableMaxScore.toFixed(1)}</strong></div>
    <div className="panel-body">
      {feedback.noteProcessBreakdown && <div aria-label="病历与接诊过程评分">
        <p><strong>最终病历</strong> {feedback.noteProcessBreakdown.noteScore.toFixed(1)} / {feedback.noteProcessBreakdown.noteMax} 分（量表60分）</p>
        <p><strong>接诊过程</strong> {feedback.noteProcessBreakdown.processScore.toFixed(1)} / {feedback.noteProcessBreakdown.processMax} 分（量表40分）</p>
        <p>原始得分 {feedback.totalScore.toFixed(1)} · 可评价满分 {feedback.assessableMaxScore} · 折算成绩 {feedback.normalizedScore === null ? '不可评价' : feedback.normalizedScore?.toFixed(1)} · 量表 {feedback.rubricVersion}</p>
      </div>}
      <p>{feedback.disclaimer}</p>
      <p>基础要求 {feedback.basicScore.toFixed(1)} / {feedback.basicMaxScore ?? 80} · 提高要求 {feedback.advancedScore.toFixed(1)} / {feedback.advancedMaxScore ?? 20}</p>
      <p>本次取得的辅助检查内容：原始记录 {feedback.materialSummary.source} 项，教学模拟 {feedback.materialSummary.simulated} 项，参考说明 {feedback.materialSummary.reference} 项。</p>
      {sections.map(([section, label]) => {
        const items = feedback.items.filter(item => displaySection(item) === section);
        return <details key={section} open={items.some(item => ['partial', 'missing', 'incorrect'].includes(item.status))} style={{ margin: '12px 0', border: '1px solid #d8e2d6', borderRadius: 10, padding: 12 }}>
          <summary><strong>{label}</strong> · {items.reduce((sum, item) => sum + item.score, 0).toFixed(1)} 分</summary>
          {items.map(item => <article key={item.id} style={{ padding: '10px 0', borderBottom: '1px solid #e5e9df' }}>
            <strong>{item.label}</strong> <small>{item.level === 'basic' ? '基础' : '提高'} · {item.status === 'not_assessable' ? '暂不可评价' : `${item.score.toFixed(2)} / ${item.maxScore.toFixed(2)}`}</small>
            <p>{item.explanation}</p><details><summary>可接受的核心表达</summary><p>{item.example}</p></details>
          </article>)}
        </details>;
      })}
      <h3>检查选择复盘</h3><p>是否需要检查取决于诊断、鉴别、治疗评估及监测用途；正常结果不等于检查多余，未申请也不等于必须补做所有项目。</p>
      {feedback.tests.map((test, index) => <article key={`${test.label}-${index}`} style={{ padding: '10px 0', borderBottom: '1px solid #e5e9df' }}>
        <strong>{test.label}</strong> · {test.requested ? '已申请' : '未申请'} · {necessityNames[test.necessity]}<p>{test.rationale}</p>
        {(test.requestCount ?? 0) > 1 && <p>本项共申请{test.requestCount}次，沿用同一固定结果，不代表完成了新的复查。不重复计分；治疗监测是否需要复查，应结合病情变化和申请目的判断。</p>}
        {Boolean(test.purposes?.length) && <p>你的申请目的：{test.purposes?.join('；')}</p>}
        {test.requested && <small>所展示内容：{origins[test.origin]}</small>}
      </article>)}
    </div>
  </section>;
}
