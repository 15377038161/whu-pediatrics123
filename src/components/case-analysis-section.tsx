import type { CaseAnalysisBlock } from '@/domain/agent';

const STATUS_LABELS = { covered: '命中', partial: '部分命中', missing: '未命中' } as const;
const SECTION_LABELS = {
  primary: '第一诊断',
  secondary: '并列诊断',
  evidence: '诊断依据',
  differential: '鉴别诊断',
  management: '处理原则',
} as const;

/** 病例分析影子分：只展示试点分与逐点结果，不参与旧总分的任何计算。 */
export function CaseAnalysisSection({ block }: { block: CaseAnalysisBlock }) {
  return (
    <section className="report-section" style={{ marginTop: 14 }} aria-labelledby="case-analysis-heading">
      <p className="eyebrow">病例分析 · 试点分</p>
      <h2 id="case-analysis-heading">按得分点判分</h2>
      {block.status === 'scored' ? (
        <>
          <p><strong style={{ fontSize: 28 }}>{block.percent}</strong> / 100 <span style={{ opacity: 0.7 }}>原始 {block.rawScore}/{block.rawMaxScore}</span></p>
          <p style={{ fontSize: 13, opacity: 0.8 }}>{block.disclaimer}</p>
          {block.usedFallback && <p role="note" style={{ fontSize: 13 }}>AI 判分暂时不可用，本次按关键词匹配兜底。</p>}
          {block.missingPoints?.length ? (
            <details>
              <summary>查看漏掉的得分点（{block.missingPoints.length}）</summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>{block.missingPoints.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          ) : <p style={{ fontSize: 13 }}>本次没有漏掉的得分点。</p>}
          {block.points?.length ? (
            <details>
              <summary>查看逐点命中</summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>
                {block.points.map((point) => <li key={`${point.section}:${point.id}`}>
                  <strong>{SECTION_LABELS[point.section]}</strong> · {point.label} · {STATUS_LABELS[point.status]}（{point.score}/{point.maxScore} 分）
                  {point.evidence ? <span style={{ opacity: 0.75 }}>：{point.evidence}</span> : null}
                </li>)}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <p>本病例暂未生成可核验的病例分析标答，本次不计算试点分{block.reason ? `（${block.reason}）` : ''}。</p>
      )}
    </section>
  );
}