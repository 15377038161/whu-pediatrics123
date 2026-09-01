'use client';

import {
  Activity, ArrowLeft, Check, ChevronRight, Clock3, Home,
  ClipboardList, Lightbulb, LoaderCircle, Mic, Send, Stethoscope, UserRound, Volume2, VolumeX, Waves,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, AgentMessage, AgentTurnResult, ApiResult, PracticeFocus, SessionMode, SessionState, Stage, TrainingReport } from '@/domain/agent';
import { getPublicCase, type PublicCaseProfile } from '@/domain/case-catalog';

const stages: Array<{ id: Stage; label: string; short: string }> = [
  { id: 'triage', label: '接诊与分诊', short: '接诊' }, { id: 'history', label: '学生自主问诊', short: '问诊' },
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

const tests = [
  { id: 'cbc-crp', label: '血常规与 CRP', indication: '评估感染与炎症程度' },
  { id: 'chest-image', label: '胸部影像', indication: '低氧且存在局灶肺部体征' },
  { id: 'pathogen', label: '呼吸道病原学', indication: '结合流行病学和病程选择' },
  { id: 'brain-mri', label: '头颅 MRI', indication: '当前是否存在神经系统指征？' },
];

const focusLabels: Record<PracticeFocus, string> = {
  history: '儿科病史采集', exam: '肺部规范查体', safety: '感染与危重识别', communication: '家长焦虑沟通',
};

const stageHints: Record<Stage, string[]> = {
  triage: ['先判断意识、呼吸和循环是否稳定，再决定问诊顺序。', '注意低龄儿童的呼吸频率与血氧，不能只看体温。'],
  history: ['先用开放式问题了解主诉，再逐项追问起病、危险信号和一般状态。', '患儿说不清时可请家长补充，但仍要给孩子表达机会。', '问到呼吸问题时，别忘了静息气促、青紫和胸壁起伏。'],
  exam: ['先完成手卫生和解释，再按“观察—测量—重点查体”推进。', '低氧风险下，血氧监测和肺部听诊是高价值操作。'],
  tests: ['每项检查都应回答一个临床问题，避免为了“全面”而开单。', '把低氧和局灶肺部体征与影像学指征联系起来。'],
  assessment: ['摘要建议按“年龄—病程—阳性证据—危险信号—关键阴性”组织。', '诊断要同时表达疾病判断和严重程度。'],
  plan: ['先稳定生命体征，再完善评估；低氧时优先监测与氧疗。', '处置计划要写清复评节点、升级治疗或转诊条件。'],
  communication: ['先回应焦虑，再用通俗语言解释风险，最后给出明确下一步。', '同时对患儿说明接下来会做什么，避免只和家长说话。'],
  report: ['报告会把每个得分项回链到本次问答和操作证据。'],
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const result = await response.json() as ApiResult<T>;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function actorLabel(actor: string): string {
  return ({ student: '你（医生）', child: '患儿', parent: '家长', tutor: '教学智能体', system: '病例系统' } as Record<string,string>)[actor] ?? actor;
}

function isSpokenActor(actor: AgentMessage['actor']): actor is 'child' | 'parent' {
  return actor === 'child' || actor === 'parent';
}

function communicationContext(session: SessionState) {
  const openingParent = session.messages.find((item) => item.actor === 'parent');
  const recentClinicalResults = session.messages.filter((item) => item.actor === 'system' && item.kind === 'navigation').slice(-3);
  return openingParent ? [openingParent, ...recentClinicalResults] : recentClinicalResults;
}

type ExamObservation = {
  bodyPartId: string;
  title: string;
  detail: string;
  toolId: string;
  status: 'success' | 'blocked';
  sound: 'fine-crackles' | 'wheeze' | null;
};

function PatientFigure({ patient, selectedTool, onExamine, onReplayObservation, observation, busy, interactive }: { patient: PublicCaseProfile; selectedTool: string | null; onExamine: (part: string) => void; onReplayObservation: (observation: ExamObservation) => void; observation: ExamObservation | null; busy: boolean; interactive: boolean }) {
  const hotspots = [
    ['forehead','头面'], ['mouth','口咽'], ['chest','胸部'], ['upper-arm','上臂'], ['finger','手指'], ['hands','双手'],
  ];
  return (
    <div className="patient-stage">
      <div className="patient-figure" aria-label="仿真虚拟患儿交互模型">
        <Image
          className="patient-photo"
          src={patient.patientImage}
          alt={patient.patientAlt}
          fill
          priority
          sizes="(max-width: 767px) 92vw, (max-width: 1199px) 38vw, 360px"
        />
        {interactive && hotspots.map(([id,label]) => <button key={id} disabled={busy} type="button" className={`hotspot hotspot-${id === 'upper-arm' ? 'arm' : id}`} data-observed={observation?.bodyPartId === id ? observation.status : undefined} onClick={() => onExamine(id)} aria-label={`使用当前器材检查${label}`}><span aria-hidden="true" />{label}</button>)}
      </div>
      <div className="patient-caption"><span>{interactive ? <>当前器材：<strong>{tools.find((tool) => tool.id === selectedTool)?.label ?? '未选择'}</strong></> : <strong>观察模式</strong>}</span><span className="emotion-pill">紧张 · 呼吸较快</span></div>
      {interactive && observation && <div className="exam-observation" data-status={observation.status} data-tool={observation.toolId} role="status" aria-live="polite">
        <div className="exam-observation-head"><span className="exam-observation-icon" aria-hidden="true">{observation.toolId === 'stethoscope' ? <Stethoscope /> : <Activity />}</span><p><small>{observation.status === 'success' ? '查体结果已获得' : '本次操作未生效'}</small><strong>{observation.title}</strong></p><button type="button" onClick={() => onReplayObservation(observation)} aria-label={observation.toolId === 'stethoscope' && observation.status === 'success' ? '播放真实儿科听诊音' : '语音重播查体结果'} title="播放结果声音"><Volume2 /></button></div>
        {observation.sound && observation.status === 'success' && <div className="exam-auscultation" data-sound={observation.sound} aria-hidden="true"><Waves /><span /><span /><span /><span /><span /></div>}
        <p className="exam-observation-detail">{observation.detail}</p>
        <small className="exam-observation-note">{observation.toolId === 'stethoscope' && observation.status === 'success' ? <>真实儿科听诊录音节选 · <a href="https://github.com/SJTU-YONGFU-RESEARCH-GRP/SPRSound" target="_blank" rel="noreferrer">SPRSound / CC BY 4.0</a></> : '标准化患儿教学反馈 · 文字结果来自病例规则'}</small>
      </div>}
      <p className="patient-disclosure">虚拟标准化患儿 · 非真实病例影像</p>
    </div>
  );
}

function ToolRack({ selectedTool, onSelect, busy, hygieneCompleted }: { selectedTool: string | null; onSelect: (toolId: string) => void; busy: boolean; hygieneCompleted: boolean }) {
  return <div className="tool-rack" aria-label="体格检查器材栏">{tools.map(({ id,label,image }) => {
    const completed = id === 'hand-hygiene' && hygieneCompleted;
    return <button type="button" className="tool" data-selected={selectedTool === id} data-completed={completed} disabled={busy} onClick={() => onSelect(id)} aria-pressed={selectedTool === id} key={id}><span className="tool-photo-wrap"><Image className="tool-photo" src={image} alt="" fill sizes="72px" /></span><span>{completed && <Check size={13} />} {completed ? '手卫生已完成' : label}</span></button>;
  })}</div>;
}

export function TrainingWorkspace({ mode, initialSessionId, initialCaseId, practiceFocus }: { mode: SessionMode; initialSessionId?: string; initialCaseId?: string; practiceFocus?: PracticeFocus }) {
  const router = useRouter();
  const started = useRef(false);
  const finishing = useRef(false);
  const spokenMessageIds = useRef(new Set<string>());
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
  const [differentials, setDifferentials] = useState('');
  const [priority, setPriority] = useState('');
  const [planDetail, setPlanDetail] = useState('');
  const [communication, setCommunication] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<'task' | 'patient' | 'record'>('task');
  const [hintIndex, setHintIndex] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const queueRoleSpeech = useCallback((content: string, actor: 'child' | 'parent') => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = 'zh-CN';
    utterance.rate = actor === 'child' ? 0.94 : 1;
    utterance.pitch = actor === 'child' ? 1.2 : 1.04;
    const chineseVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('zh'));
    if (chineseVoice) utterance.voice = chineseVoice;
    window.speechSynthesis.speak(utterance);
    return true;
  }, []);

  const replayRoleSpeech = useCallback((content: string, actor: 'child' | 'parent') => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    if (!queueRoleSpeech(content, actor)) setFeedback('当前浏览器不支持语音播报，请直接阅读对话文字。');
  }, [queueRoleSpeech]);

  const speakExamObservation = useCallback((content: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.92;
    utterance.pitch = 1;
    const chineseVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('zh'));
    if (chineseVoice) utterance.voice = chineseVoice;
    window.speechSynthesis.speak(utterance);
    return true;
  }, []);

  const playExamObservationAudio = useCallback((observation: ExamObservation) => {
    if (observation.status === 'success' && observation.sound) {
      const audio = observation.sound === 'wheeze' ? wheezeAudioRef.current : cracklesAudioRef.current;
      if (!audio) return false;
      audio.pause();
      audio.currentTime = 0;
      void audio.play().catch(() => setFeedback('浏览器阻止了自动播放，请点击查体结果卡右上角的声音按钮。'));
      return true;
    }
    return speakExamObservation(observation.detail);
  }, [speakExamObservation]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setBusy(true);
    (initialSessionId
      ? api<SessionState>(`/api/sessions/${initialSessionId}`)
      : api<SessionState>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode, caseId: initialCaseId, focus: practiceFocus }) }))
      .then((value) => { setSession(value); if (!initialSessionId) router.replace(`/student/training?session=${value.id}`); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '训练加载失败。'))
      .finally(() => setBusy(false));
  }, [initialCaseId, initialSessionId, mode, practiceFocus, router]);

  useEffect(() => {
    if (!session) return;
    const pending = session.messages.filter((item) => isSpokenActor(item.actor) && !spokenMessageIds.current.has(item.id));
    session.messages.forEach((item) => spokenMessageIds.current.add(item.id));
    if (!voiceEnabled || pending.length === 0 || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    pending.forEach((item) => {
      if (isSpokenActor(item.actor)) queueRoleSpeech(item.content, item.actor);
    });
  }, [queueRoleSpeech, session, voiceEnabled]);

  useEffect(() => {
    if (session?.stage !== 'history') return;
    const frame = window.requestAnimationFrame(() => {
      const chat = historyChatRef.current;
      if (chat) chat.scrollTop = chat.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [session]);

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
      setSession(result.session); setFeedback(result.feedback);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '当前操作失败，请重试。');
      return null;
    } finally { setBusy(false); }
  }

  async function navigate(stage: Stage) {
    const result = await sendEvent({ type: 'NAVIGATE_STAGE', data: { stage } });
    if (result) { setMobileView('task'); setHintIndex(0); setHintOpen(false); setExamObservation(null); }
  }
  async function submitQuestion() {
    if (!question.trim()) return;
    const text = question; setQuestion('');
    const result = await sendEvent({ type: 'ASK_QUESTION', data: { text } });
    if (!result) setQuestion(text);
  }
  async function examine(part: string, toolOverride?: string) {
    const partLabel = ({ forehead: '头面', mouth: '口咽', chest: '胸部', 'upper-arm': '上臂', finger: '手指', hands: '双手' } as Record<string,string>)[part] ?? part;
    const activeTool = toolOverride ?? selectedTool;
    if (!activeTool) {
      const detail = '请先在左侧选择检查器材，再点击患儿对应部位。';
      setError(detail);
      setExamObservation({ bodyPartId: part, title: partLabel, detail, toolId: 'none', status: 'blocked', sound: null });
      return;
    }
    const toolLabel = tools.find((tool) => tool.id === activeTool)?.label ?? activeTool;
    const result = await sendEvent({ type: 'EXAM_ACTION', data: { toolId: activeTool, bodyPartId: part } });
    if (!result) return;
    const latestEvent = result.session.events.at(-1);
    const success = latestEvent?.type === 'EXAM_ACTION' && latestEvent.correct === true;
    const detail = success ? (result.newMessages.at(-1)?.content ?? latestEvent.summary) : (result.feedback ?? '本次操作未获得有效查体结果。');
    const sound = success && activeTool === 'stethoscope' ? (result.session.caseId === 'peds-wheeze-002' ? 'wheeze' : 'fine-crackles') : null;
    const observation: ExamObservation = { bodyPartId: part, title: activeTool === 'hand-hygiene' ? toolLabel : `${toolLabel} · ${partLabel}`, detail, toolId: activeTool, status: success ? 'success' : 'blocked', sound };
    setExamObservation(observation);
    if (success && voiceEnabled) playExamObservationAudio(observation);
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
    }
  }

  const currentIndex = stages.findIndex((stage) => stage.id === session?.stage);
  const evidenceEvents = useMemo(() => session?.events.filter((event) => event.evidenceCodes.length > 0) ?? [], [session?.events]);
  const examEvidenceCount = evidenceEvents.filter((event) => event.stage === 'exam').length;

  if (!session) return <main className="loading-screen" id="main-content"><div><div className="pulse-mark"><Activity /></div><strong>{error ?? '正在建立统一病例会话…'}</strong>{error && <p><a className="btn btn-secondary" href="/student">返回首页</a></p>}</div></main>;
  const caseProfile = getPublicCase(session.caseId);
  const hygieneCompleted = session.unlockedEvidence.includes('EX_PREP');
  const currentFocus = session.practiceFocus ?? practiceFocus;
  const hints = stageHints[session.stage];
  const exitMode = session.mode;
  function leaveTraining() {
    const confirmed = window.confirm(exitMode === 'osce'
      ? '离开后计时仍会继续，确定暂时退出考站吗？'
      : '本次操作已自动保存，确定暂时退出训练吗？');
    if (confirmed) router.push('/student');
  }
  function toggleVoice() {
    if (voiceEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setVoiceEnabled((value) => !value);
  }
  const caseTests = session.caseId === 'peds-wheeze-002'
    ? tests.map((test) => test.id === 'chest-image' ? { ...test, indication: '低氧或首次明显喘息时评估' } : test)
    : tests;

  const stageContent = (() => {
    switch (session.stage) {
      case 'triage': return <>
        <div className="stage-intro"><p className="eyebrow">阶段 1</p><h2>接诊与分诊</h2><p>{session.messages.find((item) => item.actor === 'system' && item.kind === 'navigation')?.content}先观察整体状态，再进入自主问诊。</p></div>
        <div className="vitals"><div className="vital"><strong>{session.vitals.temperature}</strong><span>体温 ℃</span></div><div className="vital"><strong>{session.vitals.heartRate}</strong><span>心率 /min</span></div><div className="vital"><strong>{session.vitals.respiratoryRate}</strong><span>呼吸 /min</span></div><div className="vital"><strong>{session.vitals.spo2}%</strong><span>初筛 SpO₂</span></div></div>
        <ul className="stage-checklist"><li>确认患儿年龄、陪诊人和主诉</li><li>观察意识、精神状态与呼吸费力表现</li><li>使用学生自己的语言开始问诊</li></ul>
        <button className="btn btn-primary btn-block" onClick={() => navigate('history')} disabled={busy}>进入自主问诊 <ChevronRight size={17} /></button>
      </>;
      case 'history': return <>
        <div className="message-list history-chat" aria-live="polite" ref={historyChatRef}>
          {session.messages.filter((item) => item.kind !== 'navigation' || item.actor !== 'system').map((item) => {
            const spokenActor = isSpokenActor(item.actor) ? item.actor : null;
            return <div className="message" data-actor={item.actor} key={item.id}><p className="message-label"><span>{actorLabel(item.actor)} · {item.emotion}</span>{spokenActor && <button className="speak-message" type="button" aria-label={`重播${actorLabel(item.actor)}发言`} onClick={() => replayRoleSpeech(item.content, spokenActor)}><Volume2 size={13} /></button>}</p><div className="message-bubble">{item.content}</div></div>;
          })}
        </div>
        <div className="composer"><label className="sr-only" htmlFor="question">输入你的问诊问题</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="直接和患儿或家长交流，例如：小朋友别紧张，可以告诉我哪里不舒服吗？" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitQuestion(); } }} /><div className="composer-actions">{session.mode !== 'osce' && <div className="hint-anchor"><button className="icon-btn hint-trigger" type="button" aria-label="查看问诊提示" aria-expanded={hintOpen} onClick={() => setHintOpen((value) => !value)}><Lightbulb size={17} /></button>{hintOpen && <div className="hint-popover" role="status"><p>{hints[hintIndex % hints.length]}</p><button type="button" onClick={() => setHintIndex((value) => (value + 1) % hints.length)}>换一个方向</button></div>}</div>}<button className="icon-btn" type="button" title="语音识别将在获得浏览器权限后启用" aria-label="语音输入，当前回退为文字输入" onClick={() => setFeedback('语音权限或识别不可用时，系统会自动保留文字输入。')}><Mic size={17} /></button><button className="btn btn-primary" type="button" disabled={busy || !question.trim()} onClick={submitQuestion}><Send size={16} /> 发送</button></div></div>
        <div className="composer-meta"><button className="stage-next" type="button" onClick={() => navigate('exam')} disabled={busy}>进入查体 <ChevronRight size={15} /></button></div>
      </>;
      case 'exam': return <>
        <div className="stage-intro exam-stage-intro"><p className="eyebrow">器材逻辑校验</p><h2>选择器材，点击患儿对应部位</h2><p>系统会校验准备动作、器材与部位，并即时反馈真实查体结果。</p></div>
        <div className="exam-safety-strip" data-complete={hygieneCompleted} role="status"><span>{hygieneCompleted ? <Check /> : '1'}</span><p><strong>{hygieneCompleted ? '手卫生已完成' : '先完成手卫生'}</strong><small>{hygieneCompleted ? '可以开始接触患儿' : '点击下方“手卫生”即可自动完成'}</small></p></div>
        <div className="exam-tool-selector">
          <div className="exam-tool-heading"><strong>选择检查器材</strong><span>{selectedTool ? `当前：${tools.find((tool) => tool.id === selectedTool)?.label}` : '尚未选择'}</span></div>
          <ToolRack selectedTool={selectedTool} onSelect={(toolId) => { void selectExamTool(toolId); }} busy={busy} hygieneCompleted={hygieneCompleted} />
        </div>
        <div className="exam-route" aria-label="后续操作"><span>2</span><p><strong>点击患儿检查部位</strong><small>{examEvidenceCount > 0 ? `实时病例记录已新增 ${examEvidenceCount} 项证据` : '有效结果会自动写入右侧病例记录'}</small></p></div>
        <div className="form-actions"><button className="btn btn-primary exam-open-patient" onClick={() => setMobileView('patient')}><UserRound size={16} /> 打开患儿模型</button><button className="btn btn-secondary" onClick={() => navigate('tests')}>完成查体，选择辅助检查 <ChevronRight size={16} /></button></div>
      </>;
      case 'tests': return <>
        <div className="stage-intro"><p className="eyebrow">临床适宜性</p><h2>选择辅助检查</h2><p>根据已经获得的病史和体征选择检查。低价值检查会被记录，但不会提供额外有效证据。</p></div>
        <div className="choice-list">{caseTests.map((test) => <button key={test.id} className="choice" data-ordered={session.orderedTests.includes(test.id)} disabled={busy || session.orderedTests.includes(test.id)} onClick={() => sendEvent({ type: 'ORDER_TEST', data: { testId: test.id } })}><strong>{session.orderedTests.includes(test.id) && <Check size={15} />} {test.label}</strong><span>{test.indication}</span></button>)}</div>
        <div className="form-actions"><button className="btn btn-secondary" onClick={() => navigate('assessment')}>形成病情摘要与诊断 <ChevronRight size={16} /></button></div>
      </>;
      case 'assessment': return <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'SUBMIT_DECISION', data: { diagnosis, summary, differentials } }); if (result) await navigate('plan'); }}>
        <div className="stage-intro"><p className="eyebrow">证据整合</p><h2>病情摘要与初步诊断</h2><p>只使用你在本次会话中实际获得的信息，体现儿科年龄特点和危险信号判断。</p></div>
        <div className="form-field"><label htmlFor="summary">病情摘要</label><textarea id="summary" required minLength={10} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="年龄、主诉、重要阳性与阴性信息、危险信号…" /></div>
        <div className="form-field"><label htmlFor="diagnosis">初步诊断</label><input id="diagnosis" required value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="输入诊断与病情严重程度" /></div>
        <div className="form-field"><label htmlFor="differentials">鉴别诊断</label><textarea id="differentials" value={differentials} onChange={(e) => setDifferentials(e.target.value)} placeholder="列出需要鉴别的疾病及理由" /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>提交诊断并继续</button>
      </form>;
      case 'plan': return <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'SUBMIT_PLAN', data: { priority, detail: planDetail } }); if (result) await navigate('communication'); }}>
        <div className="stage-intro"><p className="eyebrow">患者安全优先</p><h2>治疗及处置计划</h2><p>明确首要处置，再说明监测、进一步评估和后续安排。</p></div>
        <div className="form-field"><label htmlFor="priority">首要处置</label><input id="priority" required value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="此刻最先做什么？" /></div>
        <div className="form-field"><label htmlFor="plan-detail">完整计划</label><textarea id="plan-detail" required minLength={5} value={planDetail} onChange={(e) => setPlanDetail(e.target.value)} placeholder="生命体征稳定、检查、治疗、复评或转诊计划…" /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>安全校验并继续</button>
      </form>;
      case 'communication': return <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); await sendEvent({ type: 'SEND_COMMUNICATION', data: { text: communication } }); }}>
        <div className="stage-intro"><p className="eyebrow">患儿与家长沟通</p><h2>回应家长的焦虑</h2><p>请用真实诊室中的语言表达共情、解释当前风险，并给出清楚的下一步。</p></div>
        <div className="message-list" style={{ minHeight: 150 }}>{communicationContext(session).map((item) => <div className="message" data-actor={item.actor} key={item.id}><p className="message-label">{actorLabel(item.actor)}</p><div className="message-bubble">{item.content}</div></div>)}</div>
        <div className="form-field"><label htmlFor="communication">对患儿和家长说</label><textarea id="communication" required value={communication} onChange={(e) => setCommunication(e.target.value)} placeholder="我理解您现在很担心…" /></div>
        <button className="btn btn-secondary" disabled={busy}>发送沟通内容</button>
        <button className="btn btn-primary btn-block" type="button" disabled={busy || !session.communication} onClick={finish}>完成训练并生成报告</button>
      </form>;
      case 'report': return <div className="loading-screen"><div><div className="pulse-mark"><Activity /></div><strong>正在生成可解释报告…</strong></div></div>;
    }
  })();

  return (
    <main className="training-shell" id="main-content">
      <audio ref={cracklesAudioRef} src="/media/clinical/audio/pediatric-fine-crackles-right.mp3" preload="auto" />
      <audio ref={wheezeAudioRef} src="/media/clinical/audio/pediatric-wheeze.mp3" preload="auto" />
      <header className="training-head">
        <div className="training-toolbar"><button className="icon-btn" type="button" onClick={leaveTraining} aria-label="暂时退出训练"><ArrowLeft size={18} /></button><div className="training-title"><strong>{caseProfile.title}</strong><span>{session.mode === 'osce' ? 'OSCE 考核模式' : session.mode === 'practice' ? `专项训练 · ${currentFocus ? focusLabels[currentFocus] : '能力补练'}` : '智能体引导模式'}</span></div>{session.mode === 'osce' ? <div className="timer"><Clock3 size={14} /> {String(Math.floor((remaining ?? 0) / 60)).padStart(2,'0')}:{String((remaining ?? 0) % 60).padStart(2,'0')}</div> : <button className="icon-btn" type="button" onClick={leaveTraining} aria-label="回到首页"><Home size={17} /></button>}</div>
        <div className="stage-scroll" aria-label="训练阶段">{stages.map((stage,index) => <button key={stage.id} className="stage-chip" data-current={session.stage === stage.id} data-done={index < currentIndex} disabled={busy || stage.id === 'report' || (session.mode === 'osce' && index < currentIndex)} onClick={() => navigate(stage.id)} aria-label={stage.label}>{stage.short}</button>)}</div>
      </header>
      <div className="case-band"><span>{session.mode === 'osce' ? '无提示、不可重试' : '操作自动保存 · 提供方向性反馈'}</span><span>病例 v{session.caseVersion}</span><span>证据 {session.unlockedEvidence.length} 项</span></div>
      {error && <div className="alert" role="alert" style={{ margin: '14px 14px 0' }}>{error}</div>}
      <div className="training-grid">
        <section className="workspace-panel training-primary" data-stage={session.stage} data-mobile-hidden={mobileView !== 'task'}><div className="panel-head"><h2>{stages[currentIndex]?.label}</h2><div className="panel-actions">{session.stage === 'history' && <button className="voice-toggle" type="button" aria-label={voiceEnabled ? '关闭自动语音播报' : '开启自动语音播报'} aria-pressed={voiceEnabled} onClick={toggleVoice}>{voiceEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}<span>{voiceEnabled ? '自动播报' : '已静音'}</span></button>}{busy && <LoaderCircle className="patient-breath" size={18} />}</div></div><div className="panel-body">{currentFocus && <div className="focus-banner"><span>本轮专项</span><strong>{focusLabels[currentFocus]}</strong></div>}{stageContent}{feedback && <div className="feedback">{feedback}</div>}</div></section>
        <section className="workspace-panel training-patient" data-mobile-hidden={mobileView !== 'patient'}><div className="panel-head"><h2>患儿交互模型</h2><span className="emotion-pill">{caseProfile.age} · {caseProfile.sex}童</span></div><PatientFigure patient={caseProfile} selectedTool={selectedTool} onExamine={examine} onReplayObservation={(observation) => { if (!playExamObservationAudio(observation)) setFeedback('当前浏览器不支持结果声音播放，请直接阅读查体结果。'); }} observation={examObservation} busy={busy} interactive={session.stage === 'exam'} />{session.stage !== 'exam' && <div className="case-band">进入查体阶段后解锁器材和体表热区</div>}</section>
        <details className="workspace-panel training-record" data-mobile-hidden={mobileView !== 'record'} open><summary className="panel-head"><h2>实时病例记录</h2><span>{evidenceEvents.length} 项本轮证据</span></summary><div className="panel-body"><p className="record-kicker">接诊已知</p><div className="vitals"><div className="vital"><strong>{session.vitals.temperature}</strong><span>体温 ℃</span></div><div className="vital"><strong>{session.vitals.heartRate}</strong><span>心率</span></div><div className="vital"><strong>{session.vitals.respiratoryRate}</strong><span>呼吸</span></div><div className="vital"><strong>{session.vitals.spo2}%</strong><span>SpO₂</span></div></div><div className="record-section-head"><h3>本轮新增</h3><span>随有效操作实时更新</span></div>{evidenceEvents.length === 0 ? <div className="empty-note">尚未获得新的问诊或查体证据。</div> : <div className="evidence-log" aria-live="polite">{evidenceEvents.slice(-8).reverse().map((event) => <div className="evidence-item" key={event.id}><strong>{event.summary}</strong><span>{stages.find((stage) => stage.id === event.stage)?.short ?? '训练'}阶段 · 已记录 {event.evidenceCodes.length} 项证据</span></div>)}</div>}</div></details>
      </div>
      <nav className="mobile-workspace-nav" aria-label="临床工作台抽屉切换">
        <button data-active={mobileView === 'task'} onClick={() => setMobileView('task')}><ClipboardList /> 当前任务</button>
        <button data-active={mobileView === 'patient'} disabled={session.stage !== 'exam'} onClick={() => setMobileView('patient')}><UserRound /> 患儿模型</button>
        <button data-active={mobileView === 'record'} onClick={() => setMobileView('record')}><Stethoscope /> 病例记录</button>
      </nav>
    </main>
  );
}
