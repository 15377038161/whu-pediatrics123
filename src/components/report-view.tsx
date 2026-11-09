import { ArrowRight, BookOpenCheck, CheckCircle2, CircleAlert, ClipboardPen, ListChecks, RotateCcw } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { PracticeFocus, TrainingReport } from '@/domain/agent';
import { findPublicCase } from '@/domain/case-catalog';
import { RandomAdmission } from '@/components/random-admission';
import { ExpandableNote } from '@/components/expandable-note';
import { CaseAnalysisSection } from '@/components/case-analysis-section';
import { findRubricForReport, isUnscoredReport, rubricStatusForDisplay, unscoredReasonForDisplay, type RubricItem } from '@/domain/training-rubric';
import { practiceScenarios } from '@/domain/practice-scenarios';
import { ReportEvidenceMedia } from '@/components/report-evidence-media';
import { TeachingFeedbackView } from '@/components/teaching-feedback';
import {PostVisitReviewPanel} from '@/components/post-visit-review';

const dimensions: Array<{ key: keyof TrainingReport['abilities']; label: string; max: number }> = [
  { key: 'history', label: '儿科问诊', max: 25 },
  { key: 'examination', label: '体格检查', max: 25 },
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

type EvidenceItem = TrainingReport['evidence'][number];
type DimensionKey = keyof TrainingReport['abilities'];
type FocusLevel = 'must' | 'high' | 'medium' | 'suggest';

interface FocusItem {
  key: string;
  title: string;
  level: FocusLevel;
  stage: string | null;
  dimension: DimensionKey | null;
  scoreText: string | null;
  conclusion: string;
  advice: string;
  lost: number;
}

// 六维里只有四项存在对应专项；临床推理与职业素养没有专项，不带 focus 以免把学生送进不相干的训练。
const practiceFocusByDimension: Partial<Record<DimensionKey, PracticeFocus>> = {
  history: 'history',
  examination: 'exam',
  safety: 'safety',
  communication: 'communication',
};

/**
 * 「去做专项补练」深链：带上原病例与最该补的那一项，专项页据此高亮对应卡片并深链回同一例，
 * 学生不必自己找是哪个病例、练哪一项（此前该按钮指向裸 /student/practice，两个信息全丢）。
 * dimensions 按报告排名从高到低传入，取第一个存在对应专项的维度；全都没有就只带病例。
 * 纯函数：ReportView 在非 readonly 下会渲染 RandomAdmission（客户端 useRouter），
 * SSR 标记测试无法直接渲染，深链规则只能从这里单独校验。
 */
export function practiceDeepLink(caseId: string, dimensions: ReadonlyArray<DimensionKey | null>): string {
  const focus = dimensions
    .map((dimension) => (dimension ? practiceFocusByDimension[dimension] : undefined))
    .find((candidate): candidate is PracticeFocus => Boolean(candidate));
  return `/student/practice?case=${encodeURIComponent(caseId)}${focus ? `&focus=${focus}` : ''}`;
}

// 报告证据项没有环节字段，环节只能由既有维度字段映射（六维与接诊环节一一对应）。
const stageLabels: Record<DimensionKey, string> = {
  history: '问诊',
  examination: '查体',
  reasoning: '诊断',
  safety: '处置',
  communication: '沟通',
  professionalism: '职业素养',
};

// 分级由既有评价状态推导，不新增判分口径：错误做法=必改，未达成=高，部分达成=中，资料核对/无法定位=建议。
const focusLevels: Record<FocusLevel, { label: string; rank: number }> = {
  must: { label: '必改', rank: 0 },
  high: { label: '高', rank: 1 },
  medium: { label: '中', rank: 2 },
  suggest: { label: '建议', rank: 3 },
};

// 过程分报告会把采集覆盖不足追加进 improvements，前缀与 scoring.ts 写入口径一致。
const historyReminderPrefix = '病史记录待核对：';

function levelOfEvidence(item: EvidenceItem): FocusLevel {
  if (item.status === 'incorrect') return 'must';
  if (item.status === 'missing') return 'high';
  if (item.status === 'partial') return 'medium';
  if (item.status === 'not_assessable' || item.status === 'not_applicable') return 'suggest';
  return item.achieved ? 'suggest' : 'high';
}

function nextStepAdvice(label: string, stage: string | null): string {
  return stage
    ? `下次训练在「${stage}」环节补完“${label}”，完成后再回看这条证据是否转为达成。`
    : `下次训练对照“${label}”的证据说明补完该项，再回看这条证据是否转为达成。`;
}

// 分级色沿用既有变量，且分级本身有文字标记，不靠颜色区分。
function focusAccent(level: FocusLevel): string {
  if (level === 'must') return 'var(--danger, #a53f3a)';
  if (level === 'high') return 'var(--brick, #ec715f)';
  if (level === 'medium') return 'var(--gold, #e5ae3d)';
  return 'var(--moss, #78b7a4)';
}

// 明细区用 auto-fit 代替媒体查询：窄屏单列、宽屏自动两列，移动端优先且无需额外断点。
const ui: Record<string, CSSProperties> = {
  focus: { marginTop: 14, padding: 18, border: '1px solid var(--line, #d7e7e1)', borderRadius: 'var(--radius, 20px)', background: 'var(--white, #ffffff)', boxShadow: 'var(--shadow-soft, 0 9px 26px rgba(24,86,78,.07))' },
  focusHeading: { margin: '0 0 6px', fontSize: 19 },
  hint: { margin: '8px 0 0', color: 'var(--muted, #607976)', fontSize: 13, lineHeight: 1.6 },
  empty: { margin: '10px 0 0', padding: '12px 14px', borderRadius: 14, background: 'var(--mint, #dff5eb)', color: 'var(--pine-dark, #105c53)', fontSize: 14, lineHeight: 1.7 },
  list: { display: 'flex', flexDirection: 'column', gap: 12, margin: '12px 0 0', padding: 0, listStyle: 'none' },
  item: { padding: 14, border: '1px solid var(--line, #d7e7e1)', borderLeftWidth: 5, borderLeftStyle: 'solid', borderRadius: 16, background: 'linear-gradient(135deg, #ffffff, var(--paper, #f7fbf8))' },
  top: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px' },
  levelTag: { flex: 'none', padding: '2px 9px', border: '1px solid currentColor', borderRadius: 999, fontSize: 12, fontWeight: 800, lineHeight: 1.6 },
  stageTag: { flex: 'none', padding: '2px 9px', borderRadius: 999, background: 'var(--paper-deep, #eaf4ef)', color: 'var(--pine-dark, #105c53)', fontSize: 12, fontWeight: 700, lineHeight: 1.6 },
  itemTitle: { flex: '1 1 140px', minWidth: 0, margin: 0, overflowWrap: 'anywhere', fontSize: 16, fontWeight: 800, lineHeight: 1.45 },
  scoreTag: { flex: 'none', color: 'var(--muted, #607976)', fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 800 },
  line: { display: 'flex', gap: 8, margin: '8px 0 0', color: 'var(--ink-2, #426663)', fontSize: 14, lineHeight: 1.7 },
  lineKey: { flex: 'none', width: 30, color: 'var(--pine, #197568)', fontSize: 12, fontWeight: 800, lineHeight: 1.9 },
  details: { marginTop: 14, border: '1px solid var(--line, #d7e7e1)', borderRadius: 'var(--radius, 20px)', background: 'var(--white, #ffffff)', overflow: 'hidden' },
  summary: { minHeight: 'var(--tap, 44px)', padding: '14px 18px', cursor: 'pointer' },
  summaryTitle: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 16, fontWeight: 800 },
  summaryMeta: { marginLeft: 10, color: 'var(--muted, #607976)', fontSize: 12, lineHeight: 1.5 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 14, padding: '14px 14px 14px', borderTop: '1px solid var(--line, #d7e7e1)' },
  spanAll: { gridColumn: '1 / -1' },
};

export function ReportView({ report, readonly = false }: { report: TrainingReport; readonly?: boolean }) {
  const mode = report.mode === 'osce' ? 'OSCE 模拟站 · 模拟参考评分' : report.mode === 'practice' ? '临床能力专项' : report.mode === 'immersive' ? '沉浸式病例教学' : '引导训练';
  // 降级查询：历史报告可能引用目录外 caseId（如早期探针/归档病例），降级展示 ID 而非 500
  // 防透题：优先使用报告 caseTitle（服务端在完成时写入的真实病种名——完成后释放），
  // 历史报告无该字段时降级公开目录标题（教师病例为中性标题，演示病例为症状标题）
  const caseProfile = findPublicCase(report.caseId);
  const caseTitle = report.caseTitle ?? caseProfile?.title ?? `病例 ${report.caseId}`;
  const processReport = report.scoreBasis === 'process';
  const mediaEventIds = report.releasedMediaEventIds ?? [...new Set(report.evidence.flatMap(item=>item.eventIds??[]))];
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
  const retryHref = report.mode === 'practice' && report.practiceFocus
    ? `/student/training?mode=practice&focus=${encodeURIComponent(report.practiceFocus)}&case=${encodeURIComponent(report.caseId)}`
    : `/student/training?mode=guided&case=${encodeURIComponent(report.caseId)}`;
  // C-观察与报告-04：全部计分项均不可评价的报告记「未评分」——总分 0 不代表能力 0 分，
  // 分数环不显示 0 分而显示「未评分」与缺少判据的原因（历史报告按快照推导，不重算）。
  const unscored = isUnscoredReport(report);
  const unscoredReason = unscored ? unscoredReasonForDisplay(report) : null;
  // 首屏「最需要改进」只取前三条：分级与环节全部来自报告快照既有字段，不改判分、不新增请求。
  const rubricItemsByEvidenceCode = new Map<string, RubricItem>((rubric?.items ?? []).map((item) => [`RUBRIC_${item.itemId}`, item]));
  const dimensionOfEvidence = (item: EvidenceItem): DimensionKey | null => {
    if (item.code.startsWith('SOURCE_PROCESS_')) {
      const key = item.code.slice('SOURCE_PROCESS_'.length);
      return key in report.abilities ? (key as DimensionKey) : null;
    }
    return rubricItemsByEvidenceCode.get(item.code)?.dimension ?? null;
  };
  const historyReviewByLabel = new Map(
    (report.collectionReview ?? []).filter((item) => item.area === 'history').map((item) => [item.label, item]),
  );
  const buildFocusItem = (text: string, index: number): FocusItem => {
    // 过程分报告的采集覆盖提醒单独成句：它不参与计分，不能按「扣分」呈现。
    if (text.startsWith(historyReminderPrefix)) {
      const inner = text.slice(historyReminderPrefix.length);
      const bracket = inner.indexOf('（');
      const label = bracket > 0 ? inner.slice(0, bracket) : inner;
      const record = historyReviewByLabel.get(label);
      return {
        key: `history-${index}`,
        title: text,
        level: 'suggest',
        stage: stageLabels.history,
        dimension: 'history',
        scoreText: record && record.available > 0 ? `${record.collected}/${record.available}` : null,
        conclusion: `本例资料里「${label}」确有对应记录，本次病史摘要尚未覆盖；该项只核对采集覆盖，不加减分。`,
        advice: `下次围绕“${label}”补充追问，并在摘要中记录实际问到的信息。`,
        lost: 0,
      };
    }
    const evidence = report.evidence.find((item) => item.label === text);
    if (!evidence) {
      // 找不到对应证据时不猜环节与分数，保留原文并指向明细区，避免给错定位。
      return {
        key: `unmatched-${index}`,
        title: text,
        level: 'suggest',
        stage: null,
        dimension: null,
        scoreText: null,
        conclusion: '本项在报告快照中没有对应的评分证据，明细区只保留原文。',
        advice: '下次训练对照「全部明细」中的评分证据与提交原文复核该项。',
        lost: 0,
      };
    }
    const rubricItem = rubricItemsByEvidenceCode.get(evidence.code);
    const dimension = dimensionOfEvidence(evidence);
    const stage = dimension ? stageLabels[dimension] : null;
    const level = levelOfEvidence(evidence);
    const scoreText = evidence.maxScore > 0 ? `${evidence.score}/${evidence.maxScore}` : null;
    const processCheck = evidence.code.startsWith('SOURCE_PROCESS_');
    // 量表项的 detail 就是该分项为何没拿到分（未达成时与量表 feedback 同文），比模板话更具体。
    const conclusion = processCheck
      ? `本环节本轮没有完成记录${scoreText ? `（${scoreText} 分）` : ''}，过程分只记完成情况，不判断临床正确性。`
      : evidence.detail;
    return {
      key: evidence.code,
      title: text,
      level,
      stage,
      dimension,
      scoreText,
      conclusion,
      advice: evidence.status === 'incorrect' && rubricItem && rubricItem.feedback !== conclusion
        ? rubricItem.feedback
        : nextStepAdvice(text, stage),
      lost: Math.max(0, evidence.maxScore - evidence.score),
    };
  };
  // 排序规则：先按分级，再按失分幅度——首屏第一条必须是当前最该补的那一项。
  const rankedFocusItems = report.improvements
    .map(buildFocusItem)
    .sort((left, right) => focusLevels[left.level].rank - focusLevels[right.level].rank || right.lost - left.lost);
  const focusItems = rankedFocusItems.slice(0, 3);
  const hiddenFocusCount = rankedFocusItems.length - focusItems.length;
  // 「去做专项补练」深链规则见 practiceDeepLink：病例 + 排名最高且有对应专项的那一项。
  const practiceHref = practiceDeepLink(report.caseId, rankedFocusItems.map((item) => item.dimension));
  return (
    <div>
      <PostVisitReviewPanel key={report.id} reportId={report.id} readonly={readonly}/>
      {report.teachingFeedback&&<TeachingFeedbackView feedback={report.teachingFeedback}/>}
      <section className="report-hero">
        <div className="score-ring" aria-label={unscored ? '未评分' : `总分 ${report.totalScore} 分`}><strong style={report.teachingFeedback?{fontSize:15}:undefined}>{report.teachingFeedback ? '过程记录' : unscored ? '未评分' : report.totalScore}</strong></div>
        <div>
          <p className="eyebrow">{mode}{focusScenario ? ` · ${focusScenario.title}` : ''} · {readonly ? '只读报告' : '训练完成'}</p>
          <h1>{caseTitle}</h1>
          <p>{report.teachingFeedback ? '上方为本轮教学逐项反馈。下方保留实际提交与既有过程记录，两个口径分别展示。' : processReport ? '分数表示训练过程完成度。请根据已获得的记录复盘，诊断和处置的正确性由教师结合具体内容复核。' : report.mode === 'osce' ? '模拟站参考评分依据实际问答、器材操作、临床决策与沟通原文生成，不构成正式考试成绩。' : '报告依据实际问答、器材操作、临床决策与沟通原文生成。'}</p>
          <ExpandableNote label="评分口径与量表" align="start" className="note-spaced">
            <p>评分量表：{rubric ? `${rubric.name}（v${report.rubricVersion}）` : '历史报告固定六维量表（生成时未单独保存量表版本，按报告快照展示，不重算旧分）'}</p>
            <p>成绩口径：{evaluationBasisLabels[evaluationBasis]}</p>
            {report.assessableMaxScore !== undefined && !unscored ? <p>可评价满分：{report.assessableMaxScore} 分，无法评价或不适用的分项不计入。</p> : null}
          </ExpandableNote>
          {unscoredReason && <p style={{ fontSize: 13, opacity: 0.75 }} role="note">未评分说明：{unscoredReason}</p>}
        </div>
      </section>
      {report.caseAnalysis && <CaseAnalysisSection block={report.caseAnalysis} />}
      {!report.teachingFeedback&&<section style={ui.focus} aria-labelledby="report-focus-heading">
        <header>
          <p className="eyebrow">优先补练</p>
          <h2 id="report-focus-heading" style={ui.focusHeading}>{focusItems.length > 0 ? '你最需要改进的' : '本轮改进项'}</h2>
          <ExpandableNote label="排序与明细说明" align="start" className="note-spaced">
            <p>按需要先补的顺序最多列 3 条，每条给出一句结论、一句建议与定位环节。</p>
            <p>全部改进项、各维度得分与逐项证据见下方「全部明细」。</p>
          </ExpandableNote>
        </header>
        {focusItems.length > 0 ? (
          <ol style={ui.list}>
            {focusItems.map((item) => (
              <li key={item.key} style={{ ...ui.item, borderLeftColor: focusAccent(item.level) }}>
                <div style={ui.top}>
                  <span style={{ ...ui.levelTag, color: focusAccent(item.level) }}>{focusLevels[item.level].label}</span>
                  {item.stage && <span style={ui.stageTag}>定位：{item.stage}</span>}
                  <h3 style={ui.itemTitle}>{item.title}</h3>
                  {item.scoreText && <span style={ui.scoreTag}>{item.scoreText}</span>}
                </div>
                <p style={ui.line}><span style={ui.lineKey}>结论</span>{item.conclusion}</p>
                <p style={ui.line}><span style={ui.lineKey}>建议</span>{item.advice}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p style={ui.empty}>
            {unscored
              ? '本报告没有可机器评价的改进项：全部计分项缺少判据，先看下方「全部明细」里的未评分说明，再由教师结合提交原文复核。'
              : '本轮没有可机器评价的改进项：已评价的分项均已达成，可按下方推荐进入进阶训练。'}
          </p>
        )}
        {hiddenFocusCount > 0 && <p style={ui.hint}>另有 {hiddenFocusCount} 条改进项未在此展示，见下方「全部明细」。</p>}
      </section>}
      <section className="report-section" style={{ marginTop: 14 }}>
        <h2><BookOpenCheck size={18} style={{ verticalAlign: -4, marginRight: 6 }} />下一步补练</h2>
        <p>{report.recommendation}</p>
        {report.strengths.length > 0 && <p><strong>{processReport ? '本轮已完成：' : '已经掌握：'}</strong>{report.strengths.join('、')}</p>}
        {!readonly && <div className="report-actions"><RandomAdmission excludeCaseId={report.caseId} label="接诊下一位患儿" /><a className="btn btn-secondary" href={`/student/notes/${encodeURIComponent(report.sessionId)}`}><ClipboardPen size={16} /> 书写病历</a><a className="btn btn-primary" href={practiceHref}><RotateCcw size={16} /> 去做专项补练</a><a className="text-link" href={retryHref}>{report.mode === 'practice' && report.practiceFocus ? '重练本专项' : '再练一次'} <ArrowRight size={14} /></a></div>}
      </section>
      <details style={ui.details}>
        <summary style={ui.summary}>
          <span style={ui.summaryTitle}><ListChecks size={18} />全部明细</span>
          <span style={ui.summaryMeta}>诊断依据、各维度得分、评分证据与提交原文（默认收起）</span>
        </summary>
        <div style={ui.grid}>
        <section className="report-section"><h2>你的诊断与依据</h2><p><strong>初步诊断：</strong>{report.studentDecision?.diagnosis || '历史报告未保存此项'}</p>{report.studentDecision?.secondaryDiagnosis?.length ? <p><strong>并列诊断：</strong>{report.studentDecision.secondaryDiagnosis.join('；')}</p> : null}<p className="preserve-lines"><strong>诊断依据：</strong>{report.studentDecision?.diagnosisBasis || '历史记录未填写诊断依据'}</p></section>
        {report.decisionEvidenceReview&&<section className="report-section"><h2>诊断依据的记录关联</h2>{report.decisionEvidenceReview.status==='unlinked'?<p>本次未关联具体记录，暂时无法定位诊断依据。下次训练可关联已获得的记录并说明推理关系。</p>:<>{report.decisionEvidenceReview.status==='unavailable'&&<p>部分关联记录无法还原，不能据此判断临床推理的正确性。</p>}<ol>{report.decisionEvidenceReview.items.map(item=><li className="preserve-lines" key={item.eventId} data-event-id={item.eventId}>{item.summary}</li>)}</ol></>}<p>关联记录用于追溯依据，不因勾选数量加减分，也不自动判定诊断或证据解释正确。</p></section>}
        <section className="report-section">
          <h2>{processReport ? (focusScenario ? '专项过程记录' : '六环节完成度') : rubric?.scope === 'focused' ? '专项能力画像' : '六维能力画像'}</h2>
          <div className="dimension-list">
            {dimensions
              .filter(({ key }) => report.evaluatedAbilities ? report.evaluatedAbilities.includes(key) : processReport || !rubric || rubric.items.some((item) => item.dimension === key))
              .map(({ key, label, max }) => {
                const processEvidence = report.evidence.find(item => item.code === `SOURCE_PROCESS_${key}`);
                const dimensionMax = processReport && report.evaluatedAbilities
                  ? processEvidence?.maxScore ?? 0 : rubric
                  ? rubric.items.filter((item) => item.dimension === key && isAssessableRubricItem(item)).reduce((sum, item) => sum + item.maxScore, 0)
                  : max;
                const width = dimensionMax > 0 ? Math.min(100, report.abilities[key] / dimensionMax * 100) : 0;
                return (
                  <div className="dimension" key={key}>
                    <span>{processReport ? report.evidence.find((item) => item.code === `SOURCE_PROCESS_${key}`)?.label ?? label : label}</span>
                    <div className="dimension-track" aria-hidden="true"><i style={{ width: `${width}%` }} /></div>
                    <strong>{rubric || (processReport && report.evaluatedAbilities) ? (dimensionMax > 0 ? `${report.abilities[key]}/${dimensionMax}` : '无法评价') : report.abilities[key]}</strong>
                  </div>
                );
              })}
          </div>
        </section>
        <section className="report-section">
          <h2>重点改进（全部 {report.improvements.length} 条）</h2>
          {report.improvements.length > 0
            ? <p>{report.improvements.join('、')}</p>
            : <p>{unscored ? '全部计分项缺少可机器评价的判据，未生成改进项，待教师复核。' : '本轮没有可机器评价的改进项。'}</p>}
          <p style={{ fontSize: 13, opacity: 0.75 }}>此处保留完整原文；首屏按评价状态排序展示前 3 条，只做呈现排序，不新增或改写判据。</p>
        </section>
      <section className="report-section" style={ui.spanAll}>
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
      {report.teacherReviews && report.teacherReviews.length > 0 && (
        <section className="report-section" style={ui.spanAll}>
          <h2>教师复核留痕</h2>
          <p style={{ fontSize: 13, opacity: 0.75 }}>教师人工复核记录按提交顺序追加，只增不改；如出现多次调整，以最新一条的分数为准。</p>
          <ul className="review-list">
            {report.teacherReviews.map((entry, index) => (
              <li className="review-entry" key={`${entry.reviewedAt}:${index}`}>
                <p><strong>{entry.action === 'confirm' ? '确认系统评分' : entry.action === 'adjust' ? `调整总分 → ${entry.adjustedTotalScore ?? '—'} 分` : entry.action}</strong><span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>{entry.reviewedAt.slice(0, 19).replace('T', ' ')}{entry.reviewerName ? ` · 复核人 ${entry.reviewerName}` : ''}</span></p>
                <p className="preserve-lines">{entry.comment}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {report.studentSubmissions && (
        <section className="report-section" style={ui.spanAll}>
          <h2>原始提交快照</h2>
          <p style={{ fontSize: 13, opacity: 0.75 }}>报告生成时冻结的最终提交原文，不随会话状态变化；修改提交需重新训练生成新报告。</p>
          <p><strong>初步诊断：</strong>{report.studentSubmissions.decision?.diagnosis || '未提交'}</p>
          <p className="preserve-lines"><strong>病情摘要：</strong>{report.studentSubmissions.decision?.summary || '未提交'}</p>
          {report.studentSubmissions.decision?.diagnosisBasis && <p className="preserve-lines"><strong>诊断依据：</strong>{report.studentSubmissions.decision.diagnosisBasis}</p>}
          {report.studentSubmissions.decision?.differentials && <p className="preserve-lines"><strong>鉴别诊断：</strong>{report.studentSubmissions.decision.differentials}</p>}
          <p className="preserve-lines"><strong>首要治疗：</strong>{report.studentSubmissions.plan?.priority || '未提交'}</p>
          <p className="preserve-lines"><strong>治疗计划：</strong>{report.studentSubmissions.plan?.detail || '未提交'}</p>
          {report.studentSubmissions.communication && <p className="preserve-lines"><strong>家长沟通原文：</strong>{report.studentSubmissions.communication}</p>}
          {report.studentSubmissions.historySummary && <p className="preserve-lines"><strong>病史摘要：</strong>{report.studentSubmissions.historySummary}</p>}
          {report.studentSubmissions.examObservation && <p className="preserve-lines"><strong>查体观察记录：</strong>{report.studentSubmissions.examObservation.findings}{report.studentSubmissions.examObservation.interpretation && <>；<strong>观察解释：</strong>{report.studentSubmissions.examObservation.interpretation}</>}{report.studentSubmissions.examObservation.linkedEvidence && <>；<strong>关联查体结果：</strong>{report.studentSubmissions.examObservation.linkedEvidence.join('、')}</>}{report.studentSubmissions.examObservation.caseVersion !== undefined && <>（病例版本 v{report.studentSubmissions.examObservation.caseVersion}）</>}</p>}
        </section>
      )}
      {report.learningIllustration && <section className="report-section" style={{marginTop:14}}><h2>教学机制图</h2><p>{report.learningIllustration.caption}</p><figure className="case-media-item">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={report.learningIllustration.url} alt={report.learningIllustration.caption} loading="lazy"/><figcaption>教学素材 {report.learningIllustration.assetVersion} · 与本报告一起保存，非临床检查证据</figcaption></figure></section>}
      {report.collectionReview && report.collectionReview.length>0 && <section className="workspace-panel" style={ui.spanAll}><div className="panel-head"><h2>本病例的信息采集复盘</h2></div><div className="panel-body"><p>以下按本例可获得资料与实际事件核对。尚未采集不等于必须开单，已采集不等于已理解；临床必要性与解释质量另行评价，不在这里加减分，也不展示完整标准病历。</p><ul>{report.collectionReview.map((item,index)=><li key={`${item.area}:${index}`}>
        <strong>{item.label}</strong>：{item.acquisitionStatus==='requested_unavailable'?'已申请，但尚无已取得的结果证据':item.acquisitionStatus==='not_requested'?'本次未申请':item.collected===0?'本次尚无已获得记录':item.collected<item.available?'记录尚未覆盖全部对应资料':'已获得对应资料'}（{item.collected}/{item.available}）；{item.eventIds.length?`关联${item.eventIds.length}条实际操作记录`:'无已取得结果的操作证据'}。
        <p>{item.acquisitionStatus==='requested_unavailable'?'请先核对结果回报与读取状态；未取得结果时无法评价解释质量，不将其认定为漏做或解释错误。':item.area==='tests'?'请结合本例需要决定是否申请；取得结果后核对原值、单位和时点，并在诊断依据中解释其意义。':item.collected<item.available?item.area==='history'?`下次可围绕“${item.label}”补充追问，并在摘要中记录实际问到的信息。`:`下次先核对“${item.label}”的适用性、部位与体位，操作后记录实际所见。`:'可回看关联记录，核对自己的摘要或观察解释；已有操作记录不代表临床判断已正确。'}</p>
      </li>)}</ul></div></section>}
      {mediaEventIds.length>0 && <section className="report-section" style={ui.spanAll}>
        <h2>本轮已获得的图片</h2>
      {report.sourceSnapshotVersion
          ? <ReportEvidenceMedia key={`${report.id}:${report.sourceSnapshotVersion}`} sessionId={report.sessionId} version={report.sourceSnapshotVersion} eventIds={mediaEventIds}/>
          : <p>历史报告未保存材料版本，暂不自动关联图片。</p>}
      </section>}
        </div>
      </details>
    </div>
  );
}
