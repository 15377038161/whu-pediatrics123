'use client';
import { ArrowRight, Clock3, HeartHandshake, ListChecks, ShieldAlert, Shuffle, Stethoscope } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { practiceScenarios } from '@/domain/practice-scenarios';
import type { PracticeFocus } from '@/domain/agent';
import { RandomSessionRetry, useRandomSession } from '@/components/random-session-entry';

const practices = [
  { id: 'history', scenario: practiceScenarios.history, icon: ListChecks, method: '自由追问患儿或家长，提交病史小结，可补充后再交。', feedback: '按病史要点与提问组织反馈，保留问答和小结。', minutes: 10, tone: 'mint' },
  { id: 'exam', scenario: practiceScenarios.exam, icon: Stethoscope, method: '选择体位、视触叩听与器材，自主定位并按顺序操作。', feedback: '反馈准备、顺序与证据关联；观察原文供教师复核。', minutes: 9, tone: 'sky' },
  { id: 'safety', scenario: practiceScenarios.safety, icon: ShieldAlert, method: '阅读已提供病史和初筛体征，提交危险判断与处置优先级。', feedback: '按危险信号、判断依据和处置优先级反馈。', minutes: 10, tone: 'sun' },
  { id: 'communication', scenario: practiceScenarios.communication, icon: HeartHandshake, method: '围绕患儿情境与家长模拟沟通，解释风险、回应顾虑并确认理解。', feedback: '保留沟通原文与目标覆盖情况，供教师复核，不做机器评分。', minutes: 9, tone: 'coral' },
] as const;

type PracticeEntry = (typeof practices)[number];

function PracticeCard({ practice, caseId, active }: { practice: PracticeEntry; caseId: string; active: boolean }) {
  const { id, scenario, icon: Icon, method, feedback, minutes, tone } = practice;
  // 带 ?case= 时深链回原病例（从报告「去做专项补练」进来的路径）；不带时由服务端随机抽一例。
  const href = caseId ? `/student/training?mode=practice&focus=${id}&case=${encodeURIComponent(caseId)}` : '';
  const { busy, error, repeat, start } = useRandomSession({ mode: 'practice', focus: id as PracticeFocus });
  const body = (
    <>
      <span className="practice-icon"><Icon /></span>
      <div>
        <span className="practice-duration"><Clock3 size={13} /> 约 {minutes} 分钟{active ? ' · 报告推荐补练' : ''}</span>
        <h2>{scenario.title}</h2>
        <p>{scenario.goal}</p>
        <div className="practice-card-details">
          <p><strong>训练</strong>{method}</p>
          <p><strong>反馈</strong>{feedback}</p>
          <p><strong>病例</strong>{caseId ? '沿用报告里那一例，只练这一个能力环节。' : '由系统随机抽取一例，抽中前不预告病种。'}</p>
        </div>
        <span className="entry-meta">{href ? '开始专项' : busy ? '正在安排…' : '随机抽一例开始'} {href ? <ArrowRight size={14} /> : <Shuffle size={14} />}</span>
      </div>
    </>
  );
  return (
    <div className="practice-card-slot" data-active={active || undefined}>
      {href
        ? <a className="practice-card" data-tone={tone} href={href}>{body}</a>
        : <button type="button" className="practice-card practice-card-button" data-tone={tone} disabled={busy} onClick={() => void start()}>{body}</button>}
      {error && <p className="practice-card-error" role="alert">{error}</p>}
      <RandomSessionRetry repeat={repeat} busy={busy} onStart={start} />
    </div>
  );
}

export function PracticeFocusGrid() {
  const searchParams = useSearchParams();
  const caseId = searchParams.get('case')?.trim() ?? '';
  const activeFocus = searchParams.get('focus')?.trim() ?? '';
  return (
    <div className="practice-grid">
      {practices.map((practice) => <PracticeCard key={practice.id} practice={practice} caseId={caseId} active={practice.id === activeFocus} />)}
    </div>
  );
}
