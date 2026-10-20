'use client';

import { teachingHints } from '@/domain/teaching-copy';
import { patientAppearance } from '@/domain/patient-appearance';

import {
  Activity, ArrowLeft, Check, ChevronRight, Clock3, Eye, Hammer, Hand, Home,
  ClipboardList, Lightbulb, LoaderCircle, MessageCircle, Send, Stethoscope, UserRound, Volume2, Waves,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, AgentMessage, AgentTurnResult, PracticeFocus, SessionMode, SessionState, Stage, TrainingReport } from '@/domain/agent';
import { getPracticeScenario } from '@/domain/practice-scenarios';
import { getPublicCase, type PublicCaseProfile } from '@/domain/case-catalog';
import { CaseResourcePanel } from '@/components/case-resource-panel';
import { reportSessionEvent } from '@/lib/engagement-tracker';

const stages: Array<{ id: Stage; label: string; short: string }> = [
  { id: 'triage', label: '接诊与分诊', short: '接诊' }, { id: 'history', label: '问诊与沟通', short: '交流' },
  { id: 'exam', label: '可视化体格检查', short: '查体' }, { id: 'tests', label: '辅助检查选择', short: '检查' },
  { id: 'assessment', label: '病情摘要与诊断', short: '诊断' }, { id: 'plan', label: '治疗及处置计划', short: '处置' },
  { id: 'communication', label: '患儿与家长沟通', short: '沟通' }, { id: 'report', label: '训练报告', short: '报告' },
];

const tools = [
  { id: 'hand-hygiene', label: '手卫生', image: '/media/clinical/tools/hand-hygiene.png' },
  { id: 'stethoscope', label: '听诊器', image: '/media/clinical/tools/stethoscope.png' },
  { id: 'thermometer', label: '体温计', image: '/media/clinical/tools/thermometer.png' },
  { id: 'oximeter', label: '血氧仪', image: '/media/clinical/tools/oximeter.png' },
  { id: 'bp-cuff', label: '血压计', image: '/media/clinical/tools/bp-cuff.png' },
  { id: 'tongue-depressor', label: '压舌板', image: '/media/clinical/tools/tongue-depressor.png' },
  { id: 'flashlight', label: '手电筒', image: '/media/clinical/tools/flashlight.png' },
];

/** 来源病例（教师病例）查体规则额外使用的器材（无实拍图，用图标兜底渲染）。 */
const sourceExamTools = [
  { id: 'inspection', label: '视诊' },
  { id: 'palpation', label: '触诊' },
  { id: 'percussion', label: '叩诊' },
  { id: 'reflex-hammer', label: '神经反射检查' },
];

const baseExamHotspots: Array<[string, string]> = [
  ['forehead', '头面'], ['mouth', '口咽'], ['chest', '胸部'], ['upper-arm', '上臂'], ['finger', '手指'], ['hands', '双手'],
];
/** 来源病例查体规则涉及的额外部位（皮肤/腹部/四肢，与 createSourceCase 的规则部位一致）。 */
const sourceExamHotspots: Array<[string, string]> = [
  ['skin', '皮肤'], ['abdomen', '腹部'], ['limbs', '四肢'],
];

const focusLabels: Record<PracticeFocus, string> = {
  history: '儿科病史采集', exam: '肺部规范查体', safety: '儿童危重症识别', communication: '家长焦虑沟通',
};

const stageHints = teachingHints;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // 统一鉴权请求层：携带 Authorization（网关重命名 x-sandbox-authorization），401 自动回登录页
  const { authedFetch } = await import('@/lib/authed-api');
  return authedFetch<T>(url, init);
}

function actorLabel(actor: string): string {
  return ({ student: '你（医生）', child: '患儿', parent: '家长', tutor: '教学智能体', system: '病例系统' } as Record<string,string>)[actor] ?? actor;
}

type ExamObservation = {
  bodyPartId: string;
  title: string;
  detail: string;
  toolId: string;
  status: 'success' | 'blocked';
  sound: 'fine-crackles' | 'wheeze' | null;
};

function PatientFigure({ patient, posture, hotspots, selectedTool, onExamine, onReplayObservation, observation, busy, interactive }: { patient: Omit<PublicCaseProfile, 'sex'> & { sex: string }; posture: 'standing' | 'supine'; hotspots: Array<[string, string]>; selectedTool: string | null; onExamine: (part: string) => void; onReplayObservation: (observation: ExamObservation) => void; observation: ExamObservation | null; busy: boolean; interactive: boolean }) {
  const appearance=patientAppearance(patient.sex,posture,patient.id);
  return (
    <div className="patient-stage" data-posture={posture} data-avatar={appearance.key}>
      <div className="patient-figure" aria-label="仿真虚拟患儿交互模型">
        {appearance.src ? <Image
          className="patient-photo"
          src={appearance.src}
          alt={appearance.alt}
          fill
          priority
          sizes="(max-width: 767px) 92vw, (max-width: 1199px) 38vw, 360px"
        /> : <div className="patient-unspecified" role="img" aria-label={appearance.alt}><UserRound size={100} /><p>病例未注明性别</p><small>暂不指定男女照片，请依据病例记录完成查体。</small></div>}
        {interactive && hotspots.map(([id,label]) => <button key={id} disabled={busy} type="button" className={`hotspot hotspot-${id === 'upper-arm' ? 'arm' : id}`} data-observed={observation?.bodyPartId === id ? observation.status : undefined} onClick={() => onExamine(id)} aria-label={`使用当前器材检查${label}`}><span aria-hidden="true" />{label}</button>)}
      </div>
      <div className="patient-caption"><span>{interactive ? <>当前器材：<strong>{[...tools, ...sourceExamTools].find((tool) => tool.id === selectedTool)?.label ?? '未选择'}</strong></> : <strong>观察模式</strong>}</span><span className="emotion-pill">部位定位 · 请依据查体记录</span></div>
      {interactive && observation && <div className="exam-observation" data-status={observation.status} data-tool={observation.toolId} role="status" aria-live="polite">
        <div className="exam-observation-head"><span className="exam-observation-icon" aria-hidden="true">{observation.toolId === 'stethoscope' ? <Stethoscope /> : <Activity />}</span><p><small>{observation.status === 'success' ? '查体结果已获得' : '本次操作未生效'}</small><strong>{observation.title}</strong></p>{observation.status === 'success' && observation.sound && <button type="button" onClick={() => onReplayObservation(observation)} aria-label="播放真实儿科听诊音" title="播放结果声音"><Volume2 /></button>}</div>
        {observation.sound && observation.status === 'success' && <div className="exam-auscultation" data-sound={observation.sound} aria-hidden="true"><Waves /><span /><span /><span /><span /><span /></div>}
        <p className="exam-observation-detail">{observation.detail}</p>
        <small className="exam-observation-note">{observation.toolId === 'stethoscope' && observation.status === 'success' ? <>真实儿科听诊录音节选 · <a href="https://github.com/SJTU-YONGFU-RESEARCH-GRP/SPRSound" target="_blank" rel="noreferrer">SPRSound / CC BY 4.0</a></> : '标准化患儿教学反馈 · 文字结果来自病例规则'}</small>
      </div>}
      <p className="patient-disclosure" title="通用示教角色，外观不代表病例年龄或实际体征">虚拟标准化患儿 · 非真实病例影像</p>
    </div>
  );
}

function ToolRack({ tools: rackTools, selectedTool, onSelect, busy, hygieneCompleted }: { tools: Array<{ id: string; label: string; image?: string }>; selectedTool: string | null; onSelect: (toolId: string) => void; busy: boolean; hygieneCompleted: boolean }) {
  return <div className="tool-rack" aria-label="体格检查器材栏">{rackTools.map(({ id,label,image }) => {
    const completed = id === 'hand-hygiene' && hygieneCompleted;
    return <button type="button" className="tool" data-selected={selectedTool === id} data-completed={completed} disabled={busy} onClick={() => onSelect(id)} aria-pressed={selectedTool === id} key={id}><span className="tool-photo-wrap">{image ? <Image className="tool-photo" src={image} alt="" fill sizes="72px" /> : <span className="tool-icon-fallback" aria-hidden="true">{id === 'inspection' ? <Eye size={22} /> : id === 'palpation' ? <Hand size={22} /> : <Hammer size={22} />}</span>}</span><span>{completed && <Check size={13} />} {completed ? '手卫生已完成' : label}</span></button>;
  })}</div>;
}

export function TrainingWorkspace({ mode, initialSessionId, initialCaseId, practiceFocus }: { mode: SessionMode; initialSessionId?: string; initialCaseId?: string; practiceFocus?: PracticeFocus }) {
  const router = useRouter();
  const started = useRef(false);
  const finishing = useRef(false);
  const historyChatRef = useRef<HTMLDivElement>(null);
  const cracklesAudioRef = useRef<HTMLAudioElement>(null);
  const wheezeAudioRef = useRef<HTMLAudioElement>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [examObservation, setExamObservation] = useState<ExamObservation | null>(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [summary, setSummary] = useState('');
  const [diagnosisBasis, setDiagnosisBasis] = useState('');
  const [posture, setPosture] = useState<'standing' | 'supine'>('standing');
  const [differentials, setDifferentials] = useState('');
  const [priority, setPriority] = useState('');
  const [planDetail, setPlanDetail] = useState('');
  const [requestedTests, setRequestedTests] = useState('');
  const [testReason, setTestReason] = useState('');
  const [historySummaryText, setHistorySummaryText] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<'task' | 'patient' | 'record'>('task');
  const [hintIndex, setHintIndex] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);

  // 查体结果音效播放（真实音频文件，非 speechSynthesis；无音效的观察结果返回 false 由调用方处理）
  const playExamObservationAudio = useCallback((observation: ExamObservation) => {
    if (observation.status === 'success' && observation.sound) {
      const audio = observation.sound === 'wheeze' ? wheezeAudioRef.current : cracklesAudioRef.current;
      if (!audio) return false;
      audio.pause();
      audio.currentTime = 0;
      void audio.play().catch(() => setFeedback('浏览器阻止了自动播放，请点击查体结果卡右上角的声音按钮。'));
      return true;
    }
    return false;
  }, []);

  // 返回修改（任务4）：进入诊断/处置阶段视图时，回填已提交内容作为草稿（进度保留，可继续修改重交）。
  // 在会话状态更新处调用（初始加载/事件响应的异步续体），不在 effect 中同步 setState（react-hooks/set-state-in-effect）。
  const draftSession = useRef<string | null>(null);
  const loadRequestId = useRef(crypto.randomUUID());
  const [loadAttempt, setLoadAttempt] = useState(0);
  const applyDraftBackfill = useCallback((next: SessionState) => {
    if (draftSession.current === next.id) return;
    draftSession.current = next.id;
    setDiagnosis(next.decision?.diagnosis ?? '');
    setSummary(next.decision?.summary ?? '');
    setDiagnosisBasis(next.decision?.diagnosisBasis ?? '');
    setDifferentials(next.decision?.differentials ?? '');
    setPriority(next.plan?.priority ?? '');
    setPlanDetail(next.plan?.detail ?? '');
    setHistorySummaryText(next.historySummary ?? '');
    setPosture(next.examPosture ?? 'standing');
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setBusy(true);
    (initialSessionId
      ? api<SessionState>(`/api/sessions/${initialSessionId}`)
      : api<SessionState>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode, caseId: initialCaseId, focus: practiceFocus, clientRequestId: loadRequestId.current }) }))
      .then((value) => { setSession(value); applyDraftBackfill(value); if (value.stage === 'exam') setMobileView('patient'); if (!initialSessionId) router.replace(`/student/training?session=${value.id}`); })
      .catch((cause) => {
        // 正式环境网关以固定 HTML 替换 403 正文（JSON 解析失败，客户端仅见 "HTTP 403"）。
        // 此处不依赖响应正文，严格匹配该消息回退友好提示；后端 403 与守卫不变，其他错误原样显示。
        if (cause instanceof Error && cause.message === 'HTTP 403') {
          setError('该病例暂不可用或无访问权限，请返回病例库选择其他病例。');
          return;
        }
        setError(cause instanceof Error ? cause.message : '训练加载失败。');
      })
      .finally(() => setBusy(false));
  }, [applyDraftBackfill, initialCaseId, initialSessionId, mode, practiceFocus, router, loadAttempt]);

  useEffect(() => {
    if (!session) return;
    // 使用统计：训练会话开始事件（服务端真实身份+时间+幂等落库）
    reportSessionEvent('session_start', session.id);
    return () => {
      // 离开训练页（含跳转报告页）上报会话结束；结束事件不驱动有效时长区间
      reportSessionEvent('session_end', session.id);
    };
  }, [session?.id]);


  useEffect(() => {
    if (session?.stage !== 'history' && session?.stage !== 'communication') return;
    const frame = window.requestAnimationFrame(() => {
      const chat = historyChatRef.current;
      if (chat) chat.scrollTop = chat.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [session]);

  const hasUnsavedDraft = Boolean(question.trim() || requestedTests.trim() || testReason.trim() ||
    (historySummaryText.trim() && historySummaryText !== (session?.historySummary ?? '')) ||
    (session && (diagnosis !== (session.decision?.diagnosis ?? '') || summary !== (session.decision?.summary ?? '') ||
    diagnosisBasis !== (session.decision?.diagnosisBasis ?? '') || differentials !== (session.decision?.differentials ?? '') ||
    priority !== (session.plan?.priority ?? '') || planDetail !== (session.plan?.detail ?? ''))));
  useEffect(() => {
    if (!hasUnsavedDraft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedDraft]);

  const finish = useCallback(async () => {
    if (!session || finishing.current) return;
    finishing.current = true;
    setBusy(true); setError(null);
    try {
      const report = await api<TrainingReport>(`/api/sessions/${session.id}/finish`, { method: 'POST', body: '{}' });
      router.replace(`/student/reports/${report.id}`);
    } catch (cause) {
      finishing.current = false;
      setError(cause instanceof Error ? cause.message : '报告暂时无法生成，操作记录已保留。');
      setBusy(false);
    }
  }, [router, session]);

  useEffect(() => {
    if (!session?.expiresAt || session.status !== 'active') return;
    const tick = () => {
      const seconds = Math.max(0, Math.floor((Date.parse(session.expiresAt!) - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) void finish();
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [finish, session?.expiresAt, session?.status]);

  async function sendEvent(event: AgentEvent): Promise<AgentTurnResult | null> {
    if (!session || busy) return null;
    setBusy(true); setError(null); setFeedback(null);
    try {
      const result = await api<AgentTurnResult>('/api/agent/turn', {
        method: 'POST', body: JSON.stringify({ sessionId: session.id, clientEventId: crypto.randomUUID(), event }),
      });
      setSession(result.session); applyDraftBackfill(result.session); setFeedback(result.feedback);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '当前操作失败，请重试。');
      return null;
    } finally { setBusy(false); }
  }

  async function navigate(stage: Stage) {
    const result = await sendEvent({ type: 'NAVIGATE_STAGE', data: { stage } });
    if (result) { setMobileView(stage === 'exam' ? 'patient' : 'task'); setHintIndex(0); setHintOpen(false); setExamObservation(null); }
  }
  async function submitConversation() {
    if (!question.trim()) return;
    const text = question; setQuestion('');
    // 单聊天框语义自动推导：沟通站（OSCE/沉浸式）或处置已提交后输入为「解释与沟通」，
    // 其余一律问诊——无需手动切换模式
    const isCommunication = session?.stage === 'communication' || Boolean(session?.plan);
    const result = await sendEvent(isCommunication ? { type: 'SEND_COMMUNICATION', data: { text } } : { type: 'ASK_QUESTION', data: { text } });
    if (!result) setQuestion(text);
  }
  async function examine(part: string, toolOverride?: string) {
    const partLabel = ({ forehead: '头面', mouth: '口咽', chest: '胸部', 'upper-arm': '上臂', finger: '手指', hands: '双手', skin: '皮肤', abdomen: '腹部', limbs: '四肢' } as Record<string,string>)[part] ?? part;
    const activeTool = toolOverride ?? selectedTool;
    if (!activeTool) {
      const detail = '请先选择检查方法或器材，再点击患儿对应部位。';
      setError(detail);
      setExamObservation({ bodyPartId: part, title: partLabel, detail, toolId: 'none', status: 'blocked', sound: null });
      return;
    }
    const toolLabel = [...tools, ...sourceExamTools].find((tool) => tool.id === activeTool)?.label ?? activeTool;
    const result = await sendEvent({ type: 'EXAM_ACTION', data: { toolId: activeTool, bodyPartId: part, posture } });
    if (!result) return;
    const latestEvent = result.session.events.at(-1);
    const success = latestEvent?.type === 'EXAM_ACTION' && latestEvent.correct === true;
    const detail = success ? (result.newMessages.at(-1)?.content ?? latestEvent.summary) : (result.feedback ?? '本次操作未获得有效查体结果。');
    const sound = success && activeTool === 'stethoscope' && !result.session.caseOptions ? (result.session.caseId === 'peds-wheeze-002' ? 'wheeze' : 'fine-crackles') : null;
    const observation: ExamObservation = { bodyPartId: part, title: activeTool === 'hand-hygiene' ? toolLabel : `${toolLabel} · ${partLabel}`, detail, toolId: activeTool, status: success ? 'success' : 'blocked', sound };
    setExamObservation(observation);
    if (success && observation.sound) playExamObservationAudio(observation);
  }

  async function selectExamTool(toolId: string) {
    setSelectedTool(toolId);
    setExamObservation(null);
    setError(null);
    if (toolId === 'hand-hygiene') {
      if (session?.unlockedEvidence.includes('EX_PREP')) {
        setExamObservation({ bodyPartId: 'hands', title: '手卫生', detail: '手卫生与检查说明已完成，可以继续选择器材开展查体。', toolId, status: 'success', sound: null });
        return;
      }
      await examine('hands', toolId);
      return;
    }
    setMobileView('patient');
  }

  // 专项训练任务化（方案 5.2）：practice 模式按配置只显示本专项允许的阶段（服务端同规则门控）
  const activeScenario = session?.mode === 'practice' ? getPracticeScenario(session.practiceFocus) : null;
  const visibleStages = activeScenario
    ? activeScenario.allowedStages.map((id) => stages.find((stage) => stage.id === id)).filter((stage): stage is { id: Stage; label: string; short: string } => Boolean(stage))
    : session?.mode === 'osce' || session?.mode === 'immersive' ? stages : stages.filter((stage) => stage.id !== 'communication');
  // 展示阶段优先级：回看态 viewStage（非 OSCE，业务阶段不变）> communication 归一到会话中心 > 业务阶段
  // （practice 沟通专项的 communication 是真实业务阶段，不归一）
  const displayStage: Stage | undefined = session?.viewStage ?? (session?.stage === 'communication' && session.mode !== 'osce' && session.mode !== 'practice' ? 'history' : session?.stage);
  const currentIndex = visibleStages.findIndex((stage) => stage.id === displayStage);
  const evidenceEvents = useMemo(() => session?.events.filter((event) => event.evidenceCodes.length > 0) ?? [], [session?.events]);
  const examEvidenceCount = evidenceEvents.filter((event) => event.stage === 'exam').length;

  if (!session) return <main className="loading-screen" id="main-content"><div><div className="pulse-mark"><Activity /></div><strong>{error ?? '正在建立统一病例会话…'}</strong>{error && <p><button className="btn btn-primary" onClick={() => { started.current = false; setError(null); setLoadAttempt(value => value + 1); }}>重新加载</button><a className="btn btn-secondary" href="/student">返回首页</a></p>}</div></main>;
  const baseProfile = getPublicCase(session.caseId);
  const caseProfile = session.caseOptions ? { ...baseProfile, title: session.caseOptions.complaint ?? session.caseOptions.sourceName, age: session.caseOptions.age, sex: session.caseOptions.sex } : baseProfile;
  const spatialExam = displayStage === 'exam';
  const examTools = [...tools, ...sourceExamTools];
  const examHotspots = [...baseExamHotspots, ...sourceExamHotspots];
  const hygieneCompleted = session.unlockedEvidence.includes('EX_PREP');
  const currentFocus = session.practiceFocus ?? practiceFocus;
  const hints = stageHints[displayStage ?? session.stage];
  const exitMode = session.mode;
  function leaveTraining() {
    if (exitMode === 'osce' && !window.confirm('离开后计时仍会继续，确定暂时退出模拟站吗？')) return;
    if (hasUnsavedDraft && !window.confirm('尚有未提交的输入，离开后这些草稿会丢失；已提交进度会保留。确定离开吗？')) return;
    router.push('/student');
  }
  const communicationModeActive = session.stage === 'communication' || Boolean(session.plan);
  const practiceCompletion = activeScenario?.completion ?? null;
  const stageCompleted = (stage: Stage) => ({
    triage: session.stage !== 'triage',
    history: session.askedIntents.length > 0 || Boolean(session.communication),
    exam: examEvidenceCount > 0,
    tests: session.orderedTests.length > 0,
    assessment: Boolean(session.decision),
    plan: Boolean(session.plan),
    communication: Boolean(session.communication),
    report: session.status === 'completed',
  })[stage];

  const conversationContent = <>
    <div className="message-list history-chat" aria-live="polite" ref={historyChatRef}>
      {session.messages.filter((item) => item.kind !== 'navigation' || item.actor !== 'system').map((item) => {
        return <div className="message" data-actor={item.actor} key={item.id}><p className="message-label"><span>{actorLabel(item.actor)} · {item.emotion}</span></p><div className="message-bubble">{item.content}</div></div>;
      })}
    </div>
    <div className="composer" data-mode={communicationModeActive ? 'communication' : 'history'}><label className="sr-only" htmlFor="question">{communicationModeActive ? '输入对患儿和家长的解释' : '输入你的问诊问题'}</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={communicationModeActive ? '直接向患儿和家长说明，例如：我理解您很担心，孩子目前呼吸和血氧需要先处理……' : '直接和患儿或家长交流，例如：小朋友别紧张，可以告诉我哪里不舒服吗？'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitConversation(); } }} /><div className="composer-actions">{session.mode !== 'osce' && !communicationModeActive && <div className="hint-anchor"><button className="icon-btn hint-trigger" type="button" aria-label="查看问诊提示" aria-expanded={hintOpen} onClick={() => setHintOpen((value) => !value)}><Lightbulb size={17} /></button>{hintOpen && <div className="hint-popover" role="status"><p>{hints[hintIndex % hints.length]}</p><button type="button" onClick={() => setHintIndex((value) => (value + 1) % hints.length)}>换一个方向</button></div>}</div>}<button className="btn btn-primary" type="button" disabled={busy || !question.trim()} onClick={submitConversation}><Send size={16} /> 发送</button></div></div>
    {practiceCompletion === 'history_summary' && (
      <form className="clinical-form practice-summary-form" onSubmit={async (event) => { event.preventDefault(); if (historySummaryText.trim().length < 10) return; await sendEvent({ type: 'SUBMIT_HISTORY_SUMMARY', data: { summary: historySummaryText.trim() } }); }}>
        <div className="form-field"><label htmlFor="history-summary">病史采集小结（专项结束条件）</label><textarea id="history-summary" required minLength={10} rows={3} value={historySummaryText} onChange={(e) => setHistorySummaryText(e.target.value)} placeholder="主诉、现病史要点、重要阴性发现…（不要求答中全部评分点）" /></div>
        <button className="btn btn-secondary" type="submit" disabled={busy || historySummaryText.trim().length < 10}>{session.historySummary ? '重新提交小结' : '提交病史小结'}</button>
      </form>
    )}
    <div className="composer-meta">{practiceCompletion === 'history_summary' ? <><span className="conversation-status" data-complete={Boolean(session.historySummary)}>{session.historySummary ? '小结已提交，可生成专项报告' : '结束采集前，请在上方提交简短病史小结'}</span><button className="stage-next" type="button" disabled={busy || !session.historySummary} onClick={finish}>生成专项报告 <ChevronRight size={15} /></button></> : practiceCompletion === 'communication_end' ? <><span className="conversation-status" data-complete={Boolean(session.communication)}>{session.communication ? '沟通已记录，可生成专项报告' : '完成一轮解释与确认后可结束会话'}</span><button className="stage-next" type="button" disabled={busy || !session.communication} onClick={finish}>结束会话，生成专项报告 <ChevronRight size={15} /></button></> : session.plan ? <><span className="conversation-status" data-complete={Boolean(session.communication)}>{session.communication ? '沟通已记录，可生成报告' : '说明风险和下一步后即可生成报告'}</span><button className="stage-next" type="button" disabled={busy || !session.communication} onClick={finish}>生成训练报告 <ChevronRight size={15} /></button></> : <button className="stage-next" type="button" onClick={() => navigate('exam')} disabled={busy}>{examEvidenceCount > 0 ? '返回查体' : '进入查体'} <ChevronRight size={15} /></button>}</div>
  </>;

  const stageContent = (() => {
    switch (displayStage) {
      case 'triage': return <>
        <div className="stage-intro"><p className="eyebrow">阶段 1</p><h2>接诊与分诊</h2><p>{session.messages.find((item) => item.actor === 'system' && item.kind === 'navigation')?.content}先观察整体状态，再进入自主问诊。</p></div>
        <div className="vitals"><div className="vital"><strong>{session.vitals.temperature ?? '未记录'}</strong><span>体温 ℃</span></div><div className="vital"><strong>{session.vitals.heartRate ?? '未记录'}</strong><span>心率 /min</span></div><div className="vital"><strong>{session.vitals.respiratoryRate ?? '未记录'}</strong><span>呼吸 /min</span></div><div className="vital"><strong>{session.vitals.spo2 === null ? '未记录' : `${session.vitals.spo2}%`}</strong><span>初筛 SpO₂</span></div></div>
        <ul className="stage-checklist"><li>确认患儿年龄、陪诊人和主诉</li><li>观察意识、精神状态与呼吸费力表现</li><li>使用学生自己的语言开始问诊</li></ul>
        <button className="btn btn-primary btn-block" onClick={() => navigate('history')} disabled={busy}>进入问诊与沟通 <ChevronRight size={17} /></button>
      </>;
      case 'history': return conversationContent;
      case 'exam': return <>
        <div className="stage-intro exam-stage-intro"><p className="eyebrow">器材逻辑校验</p><h2>选择检查方法，点击患儿对应部位</h2><p>{session.caseOptions ? '按原病例记录逐项检查：先完成手卫生，再选择器材点击部位；病例未记录的组合会明确提示「资料未提供」，不会编造结果。' : '系统会校验准备动作、器材与部位，并即时反馈真实查体结果。'}</p></div>
        <div className="exam-safety-strip" data-complete={hygieneCompleted} role="status"><span>{hygieneCompleted ? <Check /> : '1'}</span><p><strong>{hygieneCompleted ? '手卫生已完成' : '先完成手卫生'}</strong><small>{hygieneCompleted ? '可以开始接触患儿' : '点击下方“手卫生”即可自动完成'}</small></p></div>
        <div className="posture-selector" role="group" aria-label="查体姿势">{([['standing', '站立'], ['supine', '仰卧']] as const).map(([value, label]) => <button key={value} type="button" className="btn btn-secondary" aria-pressed={posture === value} disabled={busy} onClick={() => { setPosture(value); setExamObservation(null); }}>{label}</button>)}<small>腹部检查请切换为仰卧</small></div>
        <div className="exam-tool-selector">
          <div className="exam-tool-heading"><strong>选择方法或器材</strong><span>{selectedTool ? `当前：${examTools.find((tool) => tool.id === selectedTool)?.label}` : '尚未选择'}</span></div>
          <ToolRack tools={examTools} selectedTool={selectedTool} onSelect={(toolId) => { void selectExamTool(toolId); }} busy={busy} hygieneCompleted={hygieneCompleted} />
        </div>
        <div className="exam-route" aria-label="后续操作"><span>2</span><p><strong>点击患儿检查部位</strong><small>{examEvidenceCount > 0 ? `实时病例记录已新增 ${examEvidenceCount} 项证据` : '有效结果会自动写入右侧病例记录'}</small></p></div>
        {session.caseOptions && <div className="source-result-list" aria-live="polite">{evidenceEvents.filter((event) => event.stage === 'exam').map((event) => <p key={event.id}>{event.summary}</p>)}</div>}
        <div className="form-actions">{practiceCompletion === 'exam_observation' ? <button className="btn btn-primary" type="button" disabled={busy || examEvidenceCount === 0} onClick={finish}>{examEvidenceCount > 0 ? '完成查体，生成专项报告' : '完成至少一项查体操作后可结束'} <ChevronRight size={16} /></button> : <><button className="btn btn-primary exam-open-patient" onClick={() => setMobileView('patient')}><UserRound size={16} /> 打开患儿模型</button><button className="btn btn-secondary" onClick={() => navigate('tests')}>完成查体，选择辅助检查 <ChevronRight size={16} /></button></>}</div>
      </>;
      case 'tests': return <>
        <div className="stage-intro"><p className="eyebrow">临床适宜性</p><h2>申请辅助检查</h2><p>像真实接诊一样自主输入需要申请的检查名称，可一次申请多项（用逗号或换行分隔）。系统只返回本病例资料已有的结果；资料未提供的项目会明确说明，不会编造。</p></div>
        <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'ORDER_TEST', data: { requestedTests, reason: testReason.trim() || undefined } }); if (result) { setRequestedTests(''); setTestReason(''); } }}>
          <div className="form-field"><label htmlFor="requested-tests">检查申请</label><textarea id="requested-tests" required minLength={2} rows={3} value={requestedTests} onChange={(e) => setRequestedTests(e.target.value)} placeholder="例如：血常规、C反应蛋白、胸片" /></div>
          <div className="form-field"><label htmlFor="test-reason">申请理由（可选）</label><input id="test-reason" value={testReason} onChange={(e) => setTestReason(e.target.value)} placeholder="这项检查要回答什么临床问题？" /></div>
          <button className="btn btn-primary btn-block" disabled={busy || !requestedTests.trim()}>提交检查申请</button>
        </form>
        <div className="source-result-list" aria-live="polite">{evidenceEvents.filter((event) => event.stage === 'tests').length === 0 && <p>尚无检查记录：提交申请后，结果会在此逐项显示。</p>}{evidenceEvents.filter((event) => event.stage === 'tests').map((event) => <p key={event.id}>{event.summary}</p>)}</div>
        <div className="form-actions"><button className="btn btn-secondary" type="button" onClick={() => navigate('assessment')}>形成病情摘要与诊断 <ChevronRight size={16} /></button></div>
      </>;
      case 'assessment': return <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'SUBMIT_DECISION', data: { diagnosis, summary, diagnosisBasis, differentials } }); if (result) await navigate('plan'); }}>
        <div className="stage-intro"><p className="eyebrow">证据整合</p><h2>病情摘要与初步诊断</h2><p>只使用你在本次会话中实际获得的信息，体现儿科年龄特点和危险信号判断。</p></div>
        <div className="form-field"><label htmlFor="summary">病情摘要</label><textarea id="summary" required minLength={10} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="年龄、主诉、重要阳性与阴性信息、危险信号…" /></div>
        <div className="form-field"><label htmlFor="diagnosis">初步诊断</label><input id="diagnosis" required value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="输入诊断与病情严重程度" /></div>
        <div className="form-field"><label htmlFor="diagnosis-basis">诊断依据（必填）</label><textarea id="diagnosis-basis" required minLength={10} value={diagnosisBasis} onChange={(e) => setDiagnosisBasis(e.target.value)} placeholder="支撑该诊断的病史、体征与检查证据：哪些阳性发现支持诊断？关键阴性发现排除了什么？" /></div>
        <div className="form-field"><label htmlFor="differentials">鉴别诊断</label><textarea id="differentials" value={differentials} onChange={(e) => setDifferentials(e.target.value)} placeholder="列出需要鉴别的疾病及理由" /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>提交诊断并继续</button>
      </form>;
      case 'plan': return <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'SUBMIT_PLAN', data: { priority, detail: planDetail } }); if (result) { if (session.mode === 'osce') await navigate('communication'); else if (session.mode === 'practice') await finish(); else await navigate('history'); } }}>
        <div className="stage-intro"><p className="eyebrow">患者安全优先</p><h2>治疗及处置计划</h2><p>明确首要处置，再说明监测、进一步评估和后续安排。</p></div>
        <div className="form-field"><label htmlFor="priority">首要处置</label><input id="priority" required value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="此刻最先做什么？" /></div>
        <div className="form-field"><label htmlFor="plan-detail">完整计划</label><textarea id="plan-detail" required minLength={5} value={planDetail} onChange={(e) => setPlanDetail(e.target.value)} placeholder="生命体征稳定、检查、治疗、复评或转诊计划…" /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>{session.caseOptions ? '保存处置计划并继续' : '安全校验并继续'}</button>
      </form>;
      case 'communication': return conversationContent;
      case 'report': return <div className="loading-screen"><div><div className="pulse-mark"><Activity /></div><strong>正在生成可解释报告…</strong></div></div>;
    }
  })();

  return (
    <main className="training-shell" id="main-content">
      <audio ref={cracklesAudioRef} src="/media/clinical/audio/pediatric-fine-crackles-right.mp3" preload="auto" />
      <audio ref={wheezeAudioRef} src="/media/clinical/audio/pediatric-wheeze.mp3" preload="auto" />
      <header className="training-head">
    <div className="training-toolbar"><button className="icon-btn" type="button" onClick={leaveTraining} aria-label="暂时退出训练"><ArrowLeft size={18} /></button><div className="training-title"><strong>{caseProfile.title}</strong><span>{session.mode === 'osce' ? 'OSCE 模拟站' : session.mode === 'practice' ? `专项训练 · ${currentFocus ? focusLabels[currentFocus] : '能力补练'}` : session.mode === 'immersive' ? '沉浸式病例教学 · 场景引导' : '智能体引导模式'}</span></div>{session.mode === 'osce' ? <div className="timer"><Clock3 size={14} /> {String(Math.floor((remaining ?? 0) / 60)).padStart(2,'0')}:{String((remaining ?? 0) % 60).padStart(2,'0')}</div> : <button className="icon-btn" type="button" onClick={leaveTraining} aria-label="回到首页"><Home size={17} /></button>}</div>
        <div className="stage-scroll" aria-label="训练阶段">{visibleStages.map((stage,index) => <button key={stage.id} className="stage-chip" data-current={displayStage === stage.id} data-done={stageCompleted(stage.id)} disabled={busy || stage.id === 'report' || (session.mode === 'osce' && index < currentIndex) || (practiceCompletion === 'safety_decision_plan' && stage.id === 'plan' && !session.decision)} onClick={() => { void navigate(stage.id); }} aria-label={stage.label}>{stage.short}</button>)}</div>
      </header>
      <div className="case-band"><span>{session.mode === 'osce' ? '无提示、不可重试' : session.mode === 'immersive' ? '场景教学 · 可暂停、回看与获得方向性提示' : '操作自动保存 · 提供方向性反馈'}</span><span>病例 v{session.caseVersion}</span><span>证据 {session.unlockedEvidence.length} 项</span></div>
      {session.caseOptions && <div className="case-source-banner"><strong>学习案例：{session.caseOptions.sourceName}</strong><span>{session.caseOptions.hasSource ? '问诊、查体与检查按原病例资料展开；完成后对照诊疗经过复盘。' : '尚无独立病例正文，可开展问诊与诊疗思路记录。'}</span></div>}
      {error && <div className="alert" role="alert" style={{ margin: '14px 14px 0' }}>{error}</div>}
      <div className="training-grid">
        <section className="workspace-panel training-primary" data-stage={displayStage} data-mobile-hidden={mobileView !== 'task'} data-mobile-drawer={spatialExam && mobileView === 'task'}><div className="panel-head"><h2>{visibleStages[currentIndex]?.label}</h2><div className="panel-actions">{displayStage !== 'triage' && displayStage !== 'history' && displayStage !== 'communication' && displayStage !== 'report' && session.mode !== 'osce' && !activeScenario && <button className="conversation-return" type="button" onClick={() => { void navigate('history'); }}><MessageCircle size={14} /> 继续交流</button>}{busy && <LoaderCircle className="patient-breath" size={18} />}</div></div><div className="panel-body">{currentFocus && <div className="focus-banner"><span>本轮专项</span><strong>{focusLabels[currentFocus]}</strong></div>}{stageContent}{feedback && <div className="feedback">{feedback}</div>}</div></section>
        <section className="workspace-panel training-patient" data-mobile-hidden={spatialExam ? false : mobileView !== 'patient'}><div className="panel-head"><h2>{session.caseOptions ? '教学部位示意' : '患儿交互模型'}</h2><span className="emotion-pill">{caseProfile.age} · {caseProfile.sex}</span></div><PatientFigure posture={posture} patient={caseProfile} hotspots={examHotspots} selectedTool={selectedTool} onExamine={examine} onReplayObservation={(observation) => { if (!playExamObservationAudio(observation)) setFeedback('当前浏览器不支持结果声音播放，请直接阅读查体结果。'); }} observation={examObservation} busy={busy} interactive={spatialExam} />{!spatialExam && <div className="case-band">{session.caseOptions ? '教学示意模型；真实体征请查看本病例查体记录' : '进入查体阶段后解锁器材和体表热区'}</div>}</section>
        <details className="workspace-panel training-record" data-mobile-hidden={mobileView !== 'record'} data-mobile-drawer={spatialExam && mobileView === 'record'} open><summary className="panel-head"><h2>实时病例记录</h2><span>{evidenceEvents.length} 项本轮证据</span></summary><div className="panel-body"><p className="record-kicker">接诊已知</p><div className="vitals"><div className="vital"><strong>{session.vitals.temperature ?? '未记录'}</strong><span>体温 ℃</span></div><div className="vital"><strong>{session.vitals.heartRate ?? '未记录'}</strong><span>心率</span></div><div className="vital"><strong>{session.vitals.respiratoryRate ?? '未记录'}</strong><span>呼吸</span></div><div className="vital"><strong>{session.vitals.spo2 === null ? '未记录' : `${session.vitals.spo2}%`}</strong><span>SpO₂</span></div></div><div className="record-section-head"><h3>本轮新增</h3><span>随有效操作实时更新</span></div>{evidenceEvents.length === 0 ? <div className="empty-note">尚未获得新的问诊或查体证据。</div> : <div className="evidence-log" aria-live="polite">{evidenceEvents.slice(-8).reverse().map((event) => <div className="evidence-item" key={event.id}><strong>{event.summary}</strong><span>{stages.find((stage) => stage.id === event.stage)?.short ?? '训练'}阶段 · 已记录 {event.evidenceCodes.length} 项证据</span></div>)}</div>}</div></details>
      </div>
      {session.caseOptions && session.mode !== 'osce' && <div className="training-resources"><CaseResourcePanel caseId={session.caseId} title="本病例图片、音频与资料" /></div>}
      {spatialExam && mobileView !== 'patient' && <button className="mobile-drawer-backdrop" type="button" aria-label="关闭抽屉并返回患儿模型" onClick={() => setMobileView('patient')} />}
      <nav className="mobile-workspace-nav" aria-label="临床工作台抽屉切换">
        <button data-active={mobileView === 'task'} onClick={() => setMobileView('task')}><ClipboardList /> {spatialExam ? '检查方法' : '当前任务'}</button>
        <button data-active={mobileView === 'patient'} disabled={!spatialExam} onClick={() => setMobileView('patient')}><UserRound /> 患儿模型</button>
        <button data-active={mobileView === 'record'} onClick={() => setMobileView('record')}><Stethoscope /> {spatialExam ? `证据 ${evidenceEvents.length}` : '病例记录'}</button>
      </nav>
    </main>
  );
}
