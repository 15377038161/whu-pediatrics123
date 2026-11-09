'use client';

import { CaseRecordDrawer } from '@/components/case-record-drawer';
import { DirectionHint } from '@/components/direction-hint';
import { ExpandableNote } from '@/components/expandable-note';
import { partLabel } from '@/domain/exam-regions';
import { ClinicalExam } from '@/components/clinical-exam';
import { EXAM_INSTRUMENTS } from '@/domain/exam-anatomy';
import type { ExamObservation } from '@/components/exam-region-panel';
import { NoteWriting, type NoteWritingHandle } from '@/components/note-writing';
import { isExamResultEvidence } from '@/domain/exam-evidence';
import {isRepeatedExamAction} from '@/domain/exam-action-identity';
import {diagnosticEvidenceEvents} from '@/domain/clinical-evidence';
import { allowedPostures, patientAppearance } from '@/domain/patient-appearance';
import { SharedCaseRecord } from '@/components/shared-case-record';

import {
  Activity, ArrowLeft, ChevronRight, Clock3, Home,
  ClipboardList, LoaderCircle, MessageCircle, Send, Volume2, VolumeX,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, ExamPosition, ExamLocation, AgentTurnResult, PracticeFocus, SessionMode, SessionState, Stage, TrainingReport } from '@/domain/agent';
import { getPracticeScenario } from '@/domain/practice-scenarios';
import { findPublicCase, type PublicCaseProfile } from '@/domain/case-catalog';
import { CommunicationCall } from '@/components/communication-call';
import { RoleAudioPlayer, type RoleAudioPlayerHandle } from '@/components/role-audio-player';
import { VoiceHoldButton } from '@/components/voice-hold-button';
import { ConversationThread, type PendingConversation } from '@/components/conversation-thread';
import { reportSessionEvent } from '@/lib/engagement-tracker';
import { fetchSpeechCapabilities } from '@/lib/speech';
import { resolveSpeechTurnMeta, type SpeechCapabilities, type SpeechTurnMeta, type VoiceRecordingResult } from '@/domain/speech-contract';

const stages: Array<{ id: Stage; label: string; short: string }> = [
  { id: 'triage', label: '接诊与分诊', short: '接诊' }, { id: 'history', label: '问诊与沟通', short: '交流' },
  { id: 'exam', label: '可视化体格检查', short: '查体' }, { id: 'tests', label: '辅助检查选择', short: '检查' },
  { id: 'assessment', label: '病情摘要与诊断', short: '诊断' }, { id: 'plan', label: '治疗计划', short: '治疗' },
  { id: 'communication', label: '患儿与家长沟通', short: '沟通' }, { id: 'report', label: '训练报告', short: '报告' },
];

const tools = EXAM_INSTRUMENTS;

const focusLabels: Record<PracticeFocus, string> = {
  history: '儿科病史采集', exam: '体格检查专项', safety: '儿童危重症识别', communication: '家长焦虑沟通',
};


async function api<T>(url:string,init?:RequestInit):Promise<T>{
  const {authedFetch}=await import('@/lib/authed-api');return authedFetch<T>(url,init);
}

function PatientFigure({ patient, posture, position, positions, onPositionChange, onExamine, observation, onCloseObservation, onReplayAudio, busy, hygieneCompleted, showReference, completedActions, growthMeasurements }: { patient: Omit<PublicCaseProfile, 'sex'> & { sex: string }; posture: 'standing' | 'supine'; position:ExamPosition; positions:ExamPosition[]; onPositionChange:(position:ExamPosition)=>void; onExamine: (part: string,tool:string,location?:ExamLocation) => void; observation: ExamObservation | null; onCloseObservation: () => void; onReplayAudio: () => void; busy: boolean; hygieneCompleted:boolean; showReference:boolean;completedActions:import('@/domain/exam-action-identity').RecordedExamAction[];growthMeasurements:boolean }) {
  const appearance=patientAppearance(patient.sex,posture,patient.id,patient.age);
  return <ClinicalExam image={appearance.src} alt={appearance.alt} assetKey={appearance.key} posture={posture} position={position} positions={positions} onPositionChange={onPositionChange} busy={busy} hygieneCompleted={hygieneCompleted} observation={observation} onExamine={onExamine} onCloseObservation={onCloseObservation} onReplayAudio={onReplayAudio} showReference={showReference} completedActions={completedActions} growthMeasurements={growthMeasurements}/>;
}


export function TrainingWorkspace({ mode, initialSessionId, initialCaseId, practiceFocus, initialPanel }: { mode: SessionMode; initialSessionId?: string; initialCaseId?: string; practiceFocus?: PracticeFocus; initialPanel?: 'note' }) {
  const router = useRouter();
  const started = useRef(false);
  const noteRef=useRef<NoteWritingHandle>(null);
  const [noteOpen,setNoteOpen]=useState(initialPanel==='note');
  const [recordOpen,setRecordOpen]=useState(false);
  const finishing = useRef(false);
  const cracklesAudioRef = useRef<HTMLAudioElement>(null);
  const wheezeAudioRef = useRef<HTMLAudioElement>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [pendingConversation, setPendingConversation] = useState<PendingConversation | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<{ rawText: string; fileId: string | null; durationMs: number } | null>(null);
  const turnInFlight = useRef(false);
  const [examObservation, setExamObservation] = useState<ExamObservation | null>(null);
  const [diagnosis, setDiagnosis] = useState('');
  const [secondaryDiagnosis, setSecondaryDiagnosis] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [diagnosisBasis, setDiagnosisBasis] = useState('');
  const [decisionEvidenceIds,setDecisionEvidenceIds]=useState<string[]>([]);
  const [posture, setPosture] = useState<ExamPosition>('standing');
  const [differentials, setDifferentials] = useState('');
  const [priority, setPriority] = useState('');
  const [planDetail, setPlanDetail] = useState('');
  const [requestedTests, setRequestedTests] = useState('');
  const [testReason, setTestReason] = useState('');
  const [historySummaryText, setHistorySummaryText] = useState('');
  // 查体专项观察/解释提交草稿（C-观察与报告-04 / C-关联与验收-05）：提交/修订走
  // SUBMIT_EXAM_OBSERVATION，须勾选关联本会话已实际获得结果的查体项（选项由服务端返回的
  // 会话查体事件派生，服务端另按归属/绑定版本/原事件/解锁结果核验）；客户端不自报得分或解锁事实。
  const [examFindingsText, setExamFindingsText] = useState('');
  const [examInterpretationText, setExamInterpretationText] = useState('');
  const [examLinkedEvidence, setExamLinkedEvidence] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  // 语音链：能力探测（失败按不可用处理）；文字与按住说话共用受控草稿；角色播报可静音。
  const [speechCapabilities, setSpeechCapabilities] = useState<SpeechCapabilities | null>(null);
  const [speechProbing,setSpeechProbing]=useState(true);
  const [roleAudioMuted, setRoleAudioMuted] = useState(false);
  const audioPlayerRef = useRef<RoleAudioPlayerHandle>(null);
  // 流式呈现：会话加载时的既有条目记为历史（直接全文）；之后新增的角色回复逐字呈现，
  // 呈现完成记入 doneIds 并恢复该条播报入口。集合在渲染期派生，不用 effect 同步。
  const [seenForSession, setSeenForSession] = useState<string | null>(null);
  const [seenIds, setSeenIds] = useState<ReadonlySet<string> | null>(null);
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const clearStreamId = useCallback((id: string) => {
    setDoneIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const recordPanelRef = useRef<HTMLElement>(null);

  // 查体结果音效播放（真实音频文件，非 speechSynthesis；无音效的观察结果返回 false 由调用方处理）
  const playExamObservationAudio = useCallback((observation: ExamObservation) => {
    if (observation.status === 'success' && observation.sound) {
      const audio = observation.sound === 'wheeze' ? wheezeAudioRef.current : cracklesAudioRef.current;
      if (!audio) return false;
      audio.pause();
      audio.currentTime = 0;
      void audio.play().catch(() => setFeedback('浏览器阻止了自动播放，请在共享病例记录中点击听诊音重播按钮。'));
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
    setSecondaryDiagnosis(next.decision?.secondaryDiagnosis ?? []);
    setSummary(next.decision?.summary ?? '');
    setDiagnosisBasis(next.decision?.diagnosisBasis ?? '');
    setDecisionEvidenceIds(next.decision?.linkedEventIds ?? []);
    setDifferentials(next.decision?.differentials ?? '');
    setPriority(next.plan?.priority ?? '');
    setPlanDetail(next.plan?.detail ?? '');
    setHistorySummaryText(next.historySummary ?? '');
    setExamFindingsText(next.examObservation?.findings ?? '');
    setExamInterpretationText(next.examObservation?.interpretation ?? '');
    setPosture(next.examPosition ?? next.examPosture ?? 'standing');
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setBusy(true);
    (initialSessionId
      ? api<SessionState>(`/api/sessions/${initialSessionId}`)
      : api<SessionState>('/api/sessions', { method: 'POST', body: JSON.stringify({ mode, caseId: initialCaseId, focus: practiceFocus, clientRequestId: loadRequestId.current }) }))
      .then((value) => { setSession(value); setSeenForSession(value.id); setSeenIds(new Set(value.messages.map((item) => item.id))); setDoneIds(new Set()); applyDraftBackfill(value); if (!initialSessionId) router.replace(`/student/training?session=${value.id}`); })
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

  const engagementSessionId=session?.id;
  useEffect(() => {
    if (!engagementSessionId) return;
    // 使用统计：训练会话开始事件（服务端真实身份+时间+幂等落库）
    reportSessionEvent('session_start', engagementSessionId);
    return () => {
      // 离开训练页（含跳转报告页）上报会话结束；结束事件不驱动有效时长区间
      reportSessionEvent('session_end', engagementSessionId);
    };
  }, [engagementSessionId]);


  // 阶段 D：语音能力真实探测（每会话一次）；探测失败按不可用处理，语音入口隐藏、文字流程不受影响
  const speechProbeSessionId = session?.id ?? null;
  useEffect(() => {
    if (!speechProbeSessionId) return;
    let cancelled = false;
    void fetchSpeechCapabilities().then((capabilities) => {
      if (!cancelled) {setSpeechCapabilities(capabilities);setSpeechProbing(false);}
    });
    return () => { cancelled = true; };
  }, [speechProbeSessionId]);


  // 逐字呈现集合：仅本会话加载后新增、尚未呈现完成、非学生的非空回复。
  // 新消息与逐字呈现期间的吸底统一由 ConversationThread 处理。
  const streamingIds = useMemo(() => {
    const set = new Set<string>();
    if (!session || !seenIds || seenForSession !== session.id) return set;
    for (const item of session.messages) {
      if (!seenIds.has(item.id) && !doneIds.has(item.id) && item.actor !== 'student' && item.content.trim().length > 0) set.add(item.id);
    }
    return set;
  }, [session, seenIds, seenForSession, doneIds]);

  const hasUnsavedDraft = Boolean(question.trim() || requestedTests.trim() || testReason.trim() ||
    (historySummaryText.trim() && historySummaryText !== (session?.historySummary ?? '')) ||
    (examFindingsText.trim() && (examFindingsText !== (session?.examObservation?.findings ?? '') || examInterpretationText !== (session?.examObservation?.interpretation ?? ''))) ||
    (examLinkedEvidence.length > 0 && examLinkedEvidence.join(',') !== (session?.examObservation?.linkedEvidence ?? []).join(',')) ||
    (session && (diagnosis !== (session.decision?.diagnosis ?? '') || secondaryDiagnosis.join('|') !== (session.decision?.secondaryDiagnosis ?? []).join('|') || summary !== (session.decision?.summary ?? '') ||
    diagnosisBasis !== (session.decision?.diagnosisBasis ?? '') || decisionEvidenceIds.join(',')!==(session.decision?.linkedEventIds??[]).join(',') || differentials !== (session.decision?.differentials ?? '') ||
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
      await noteRef.current?.flush();
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
    if (!session || busy || turnInFlight.current) return null;
    turnInFlight.current = true;
    setBusy(true); setError(null); setFeedback(null);
    try {
      const result = await api<AgentTurnResult>('/api/agent/turn', {
        method: 'POST', body: JSON.stringify({ sessionId: session.id, clientEventId: crypto.randomUUID(), event }),
      });
      if (event.type === 'ASK_QUESTION' || event.type === 'SEND_COMMUNICATION') setPendingConversation(null);
      setSession(result.session); applyDraftBackfill(result.session); setFeedback(event.type === 'ASK_QUESTION' || event.type === 'SEND_COMMUNICATION' ? null : result.feedback);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '当前操作失败，请重试。');
      return null;
    } finally { turnInFlight.current = false; setBusy(false); }
  }

  async function navigate(stage: Stage) {
    if(noteOpen){try{await noteRef.current?.flush();}catch{setError('病历草稿尚未保存，请先重试保存。');return;}}
    const result = await sendEvent({ type: 'NAVIGATE_STAGE', data: { stage } });
    if (result) { setNoteOpen(false);router.replace(`/student/training?session=${session!.id}`);setExamObservation(null); }
  }
  async function submitConversation() {
    if (!session || busy || turnInFlight.current || !question.trim()) return;
    const text = question;
    const draft = voiceDraft;
    const speech = draft ? resolveSpeechTurnMeta(draft.rawText, text, draft.fileId ? { fileId: draft.fileId, durationMs: draft.durationMs } : undefined) : null;
    setQuestion('');
    if (await sendConversationText(text, speech)) setVoiceDraft(null);
    else setQuestion(current => current || text);
  }

  function acceptVoiceResult(result: VoiceRecordingResult) {
    setQuestion(result.text);
    setVoiceDraft({ rawText: result.text, fileId: result.audioFileId, durationMs: result.audioDurationMs });
    setPendingConversation(null);
  }

  // 临时气泡只属于输入界面；成功后由服务端消息原子替换，失败保留原草稿。
  // 文字和已确认的语音共用此入口，不把待发送内容写入临床会话或交给播报器。
  async function sendConversationText(text: string, speech: SpeechTurnMeta | null): Promise<boolean> {
    if (!text.trim() || !session || busy || turnInFlight.current) return false;
    setPendingConversation({ text, voice: Boolean(speech), status: 'sending' });
    const isCommunication = session.stage === 'communication' || Boolean(session.plan);
    const result = await sendEvent(
      isCommunication
        ? { type: 'SEND_COMMUNICATION', data: { text, speech: speech ?? undefined } }
        : { type: 'ASK_QUESTION', data: { text, speech: speech ?? undefined } },
    );
    if (!result) setPendingConversation({ text, voice: Boolean(speech), status: 'failed' });
    return Boolean(result);
  }
  async function examine(part: string, activeTool: string, location?:ExamLocation) {
    if(!session)return;
    const data:Extract<AgentEvent,{type:'EXAM_ACTION'}>['data']={toolId:activeTool,bodyPartId:part,posture:effectivePosture,position:effectivePosition,location};
    if(isRepeatedExamAction(session,data))return;
    const partName = partLabel(part);
    const toolLabel = tools.find((tool) => tool.id === activeTool)?.label ?? activeTool;
    const result = await sendEvent({ type: 'EXAM_ACTION', data });
    if (!result || result.repeated) return;
    const latestEvent = result.session.events.at(-1);
    const success = latestEvent?.type === 'EXAM_ACTION' && latestEvent.correct === true;
    const detail = success ? (result.newMessages.at(-1)?.content ?? latestEvent.summary) : (result.feedback ?? latestEvent?.summary ?? '本次操作未获得有效查体结果。');
    const sound = success && activeTool === 'stethoscope' && !result.session.caseOptions ? (result.session.caseId === 'peds-wheeze-002' ? 'wheeze' : 'fine-crackles') : null;
    const observation: ExamObservation = { bodyPartId: part, title: activeTool === 'hand-hygiene' ? toolLabel : `${toolLabel} · ${partName}`, detail, toolId: activeTool, status: success ? 'success' : 'blocked', sound };
    setExamObservation(observation);
    if (success) {
      if (observation.sound) playExamObservationAudio(observation);
    }
  }

  // 专项训练任务化（方案 5.2）：practice 模式按配置只显示本专项允许的阶段（服务端同规则门控）
  const activeScenario = session?.mode === 'practice' ? getPracticeScenario(session.practiceFocus) : null;
  const visibleStages = activeScenario
    ? activeScenario.allowedStages.map((id) => stages.find((stage) => stage.id === id)).filter((stage): stage is { id: Stage; label: string; short: string } => Boolean(stage))
    : session?.mode === 'osce' || session?.mode === 'immersive' ? stages : stages.filter((stage) => stage.id !== 'communication');
  // 展示阶段优先级：回看态 viewStage（非 OSCE，业务阶段不变）> communication 归一到会话中心 > 业务阶段
  // （practice 沟通专项的 communication 是真实业务阶段，不归一）
  const displayStage: Stage | undefined = session?.viewStage ?? (session?.stage === 'communication' && session.mode !== 'osce' && session.mode !== 'practice' ? 'history' : session?.stage);
  useEffect(()=>{if(window.matchMedia('(max-width:1023px)').matches)document.querySelector<HTMLElement>('.stage-scroll [data-current="true"]')?.scrollIntoView({block:'nearest',inline:'center'});},[displayStage,noteOpen]);
  const currentIndex = visibleStages.findIndex((stage) => stage.id === displayStage);
  const evidenceEvents = useMemo(() => session?.events.filter((event) => event.evidenceCodes.length > 0) ?? [], [session?.events]);
  const decisionEvidenceItems=useMemo(()=>session?diagnosticEvidenceEvents(session):[],[session]);
  const examEvidenceCount = evidenceEvents.filter((event) => event.stage === 'exam').length;
  // 已实际获得结果的查体项（观察关联选项，C-关联与验收-05）：由服务端返回的会话查体事件派生——
  // EXAM_ACTION 成功事件携带的结果项证据码（准备项 EX_PREP/系统提供项 EX_PROVIDED 不计入）；
  // 客户端仅据此渲染勾选项，关联事实由服务端按本会话原查体事件与解锁结果重新核验，客户端不自报。
  const obtainedExamResultItems = [...new Map((session?.events ?? [])
    .filter((event) => event.type === 'EXAM_ACTION' && event.correct !== false)
    .flatMap((event) => event.evidenceCodes
      .filter(isExamResultEvidence)
      .map((code) => [code, event.summary] as const)),
  )].map(([code, summary]) => ({ code, summary }));

  if (!session) return <main className="loading-screen" id="main-content"><div><div className="pulse-mark"><Activity /></div><strong>{error ?? '正在建立统一病例会话…'}</strong>{error && <p><button className="btn btn-primary" onClick={() => { started.current = false; setError(null); setLoadAttempt(value => value + 1); }}>重新加载</button><a className="btn btn-secondary" href="/student">返回首页</a></p>}</div></main>;
  const baseProfile = findPublicCase(session.caseId);
  if(!baseProfile)return <main id="main-content" className="workspace-panel"><h1>历史接诊记录</h1><p>该病例已停用，当前记录只读；已保存的接诊内容和报告保留。</p><Link className="btn btn-secondary" href="/student">返回病例库</Link><Link className="btn btn-secondary" href="/student/reports">查看历史报告</Link><ol>{session.events.map(event=><li className="preserve-lines" key={event.id}>{event.summary}</li>)}</ol></main>;
  const caseProfile = session.caseOptions ? { ...baseProfile, title: session.caseOptions.complaint ?? session.caseOptions.sourceName, age: session.caseOptions.age, sex: session.caseOptions.sex } : baseProfile;
  // 新生儿/婴儿（≤1 岁）病例只有仰卧体位（C01）：体位选项与查体事件按病例年龄收窄，
  // 不出现「1 天新生儿站立体位」这类与病例事实矛盾的交互。
  const basicPostures=allowedPostures(caseProfile.age);
  const postureOptions:ExamPosition[]=session.teachingPackageVersion?(basicPostures.length===1?['supine','lateral']:['standing','supine','sitting','lateral','prone']):basicPostures;
  const effectivePosition=postureOptions.includes(posture)?posture:postureOptions[0];
  const effectivePosture=effectivePosition==='standing'?'standing':'supine';
  const spatialExam = !noteOpen && displayStage === 'exam';
  const drawerStage = noteOpen || displayStage === 'assessment' || displayStage === 'plan';
  function openCaseRecord(){
    if(drawerStage || window.matchMedia('(max-width:1023px)').matches)setRecordOpen(true);
  }
  const showPatient = spatialExam;
  function openNote(){setRecordOpen(false);setNoteOpen(true);router.replace(`/student/training?session=${session!.id}&panel=note`);}
  const nextAction = displayStage==='exam'?{label:'辅助检查',stage:'tests' as Stage}:displayStage==='tests'?{label:'整理诊断',stage:'assessment' as Stage}:displayStage==='history'&&!session.plan?{label:examEvidenceCount>0?'返回查体':'进入查体',stage:'exam' as Stage}:null;
  function replayObservationAudio() {
    if (examObservation && !playExamObservationAudio(examObservation)) setFeedback('当前浏览器不支持结果声音播放，请直接阅读查体结果。');
  }
  const hygieneCompleted = session.unlockedEvidence.includes('EX_PREP');
  const currentFocus = session.practiceFocus ?? practiceFocus;
  const exitMode = session.mode;
  async function leaveTraining() {
    try{await noteRef.current?.flush();}catch{setError('病历草稿保存失败，请重试后再离开。');return;}
    if (exitMode === 'osce' && !window.confirm('离开后计时仍会继续，确定暂时退出模拟站吗？')) return;
    if (hasUnsavedDraft && !window.confirm('尚有未提交的输入，离开后这些草稿会丢失；已提交进度会保留。确定离开吗？')) return;
    router.push('/student');
  }
  const communicationModeActive = session.stage === 'communication' || Boolean(session.plan);
  // 语音能力探测仅用于 UI 提示（播报开关/重连按钮），语音按钮始终可点击
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
    <div className="conversation-card">
      <ConversationThread
        sessionId={session.id}
        messages={session.messages.filter((item) => item.kind !== 'navigation' || item.actor !== 'system')}
        pending={pendingConversation}
        streamingIds={streamingIds}
        onStreamDone={clearStreamId}
        ttsEnabled={!roleAudioMuted && speechCapabilities?.tts === 'turn-based'}
        onReplay={(id) => audioPlayerRef.current?.replay(id)}
        onRetry={() => void submitConversation()}
      />
      <RoleAudioPlayer ref={audioPlayerRef} sessionId={session.id} messages={session.messages} enabled={!roleAudioMuted && speechCapabilities?.tts === 'turn-based'} />
      <div className="composer-card" data-mode={communicationModeActive ? 'communication' : 'history'}>
        <div className="composer-header">
          <button className="composer-toggle" type="button" disabled={speechCapabilities?.tts !== 'turn-based'} aria-pressed={!roleAudioMuted && speechCapabilities?.tts === 'turn-based'} onClick={() => setRoleAudioMuted((value) => !value)} title="AI 回复语音播报开关">
            {roleAudioMuted ? <VolumeX size={14} /> : <Volume2 size={14} />} {speechCapabilities?.tts !== 'turn-based' ? '播报暂不可用' : roleAudioMuted ? 'AI 播报已关闭' : 'AI 播报已开启'}
          </button>
          {(speechCapabilities?.asr !== 'turn-based' || speechCapabilities?.tts !== 'turn-based') && <button className="composer-toggle" type="button" disabled={speechProbing} onClick={async () => { setSpeechProbing(true); try { const caps = await fetchSpeechCapabilities(); setSpeechCapabilities(caps); setFeedback(caps.asr === 'turn-based' && caps.tts === 'turn-based' ? '语音服务已恢复。' : '语音服务尚未恢复，可稍后重试，文字输入不受影响。'); } finally { setSpeechProbing(false); } }}>{speechProbing ? '正在检测语音…' : '重连语音'}</button>}
        </div>
        <div className="composer-input-row">
          <div className="composer"><label className="sr-only" htmlFor="question">{communicationModeActive ? '输入对患儿和家长的解释' : '输入你的问诊问题'}</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={communicationModeActive ? '说明病情、风险与下一步安排…' : '向患儿或家长提问…'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submitConversation(); } }} /></div>
        </div>
        <div className="composer-actions">
          <VoiceHoldButton sessionId={session.id} disabled={busy} onResult={acceptVoiceResult} />
          <button className="btn btn-primary composer-send" type="button" disabled={busy || !question.trim()} onClick={submitConversation}><Send size={15} /> 发送</button>
        </div>
      </div>
    </div>
    {practiceCompletion === 'history_summary' && (
      <form className="clinical-form practice-summary-form" onSubmit={async (event) => { event.preventDefault(); if (historySummaryText.trim().length < 10) return; await sendEvent({ type: 'SUBMIT_HISTORY_SUMMARY', data: { summary: historySummaryText.trim() } }); }}>
        <div className="form-field"><label htmlFor="history-summary">病史采集小结（专项结束条件）</label><textarea id="history-summary" required minLength={10} rows={3} value={historySummaryText} onChange={(e) => setHistorySummaryText(e.target.value)} placeholder="主诉、现病史要点、重要阴性发现…（不要求答中全部评分点）" /></div>
        <button className="btn btn-secondary" type="submit" disabled={busy || historySummaryText.trim().length < 10}>{session.historySummary ? '重新提交小结' : '提交病史小结'}</button>
      </form>
    )}
    <div className="composer-meta">{practiceCompletion === 'history_summary' ? <><span className="conversation-status" data-complete={Boolean(session.historySummary)}>{session.historySummary ? '小结已提交，可生成专项报告' : '提交病史小结后可生成报告'}</span><button className="stage-next" type="button" disabled={busy || !session.historySummary} onClick={finish}>生成专项报告 <ChevronRight size={15} /></button></> : practiceCompletion === 'communication_end' ? <><span className="conversation-status" data-complete={Boolean(session.communication)}>{session.communication ? '沟通已记录，可生成专项报告' : '完成沟通后可生成报告'}</span><button className="stage-next" type="button" disabled={busy || !session.communication} onClick={finish}>结束会话，生成专项报告 <ChevronRight size={15} /></button></> : session.plan ? <><span className="conversation-status" data-complete={Boolean(session.communication)}>{session.communication ? '沟通已记录，可生成报告' : '说明风险与下一步后可生成报告'}</span></> : null}</div>
  </>;

  const stageContent = (() => {
    switch (displayStage) {
      case 'triage': return <>
        <div className="stage-intro"><p className="eyebrow">阶段 1</p><h2>接诊与分诊</h2><p>{session.messages.find((item) => item.actor === 'system' && item.kind === 'navigation')?.content}先观察整体状态，再进入自主问诊。</p></div>
        <ul className="stage-checklist"><li>确认患儿年龄、陪诊人和主诉</li><li>观察意识、精神状态与呼吸费力表现</li><li>使用学生自己的语言开始问诊</li></ul>
        <button className="btn btn-primary btn-block" onClick={() => navigate('history')} disabled={busy}>进入问诊与沟通 <ChevronRight size={17} /></button>
      </>;
      case 'history': return conversationContent;
      case 'exam': return <>
        {practiceCompletion === 'exam_observation' && (
          <form className="clinical-form practice-summary-form" onSubmit={async (event) => { event.preventDefault(); if (examFindingsText.trim().length < 10 || examLinkedEvidence.length === 0) return; await sendEvent({ type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: examFindingsText.trim(), interpretation: examInterpretationText.trim() || undefined, linkedEvidence: examLinkedEvidence } }); }}>
            <div className="form-field">
              <div className="field-label-row">
                <label>关联的查体结果（必选，本次观察所依据）</label>
                <ExpandableNote label="选项从哪来？" align="start">
                  <p>选项来自本会话已实际获得结果的查体项，手卫生等准备操作不计入。</p>
                  <p>提交时服务端按本会话的原查体事件与解锁结果核验关联，没做过的查体勾不上。</p>
                </ExpandableNote>
              </div>
              {obtainedExamResultItems.map((item) => <label key={item.code} className="checkbox-row"><input type="checkbox" checked={examLinkedEvidence.includes(item.code)} onChange={(e) => { setExamLinkedEvidence(e.target.checked ? [...new Set([...examLinkedEvidence, item.code])] : examLinkedEvidence.filter((code) => code !== item.code)); }} disabled={busy} /> <span>{item.summary}</span></label>)}
            </div>
            <div className="form-field"><label htmlFor="exam-findings">查体观察记录（专项结束条件）</label><textarea id="exam-findings" required minLength={10} rows={3} value={examFindingsText} onChange={(e) => setExamFindingsText(e.target.value)} placeholder="你实际观察到的查体所见：阳性体征、重要阴性发现…（不要求答中评分点，可修订重交）" /></div>
            <div className="form-field"><label htmlFor="exam-interpretation">观察解释（可选）</label><textarea id="exam-interpretation" rows={2} value={examInterpretationText} onChange={(e) => setExamInterpretationText(e.target.value)} placeholder="这些所见提示什么？与病史如何联系？（原文保留在报告快照待教师复核，不做机器计分）" /></div>
            <button className="btn btn-secondary" type="submit" disabled={busy || examEvidenceCount === 0 || examFindingsText.trim().length < 10 || examLinkedEvidence.length === 0}>{session.examObservation ? '修订重交观察与解释' : '提交查体观察与解释'}</button>
            {examEvidenceCount === 0 && <p className="form-hint" role="note">完成至少一项有效查体操作并勾选关联项后才能提交观察。</p>}
          </form>
        )}
        {practiceCompletion === 'exam_observation' && <div className="form-actions"><button className="btn btn-primary" type="button" disabled={busy || !session.examObservation} onClick={finish}>{session.examObservation ? '完成查体，生成专项报告' : '提交观察与解释后可结束'} <ChevronRight size={16} /></button></div>}
      </>;
      case 'tests': return <>
        <div className="stage-intro tests-intro"><p className="eyebrow">临床检查单</p><h2>需要哪些检查？</h2><p>写下检查名称与希望解决的问题，多项可用逗号或换行分隔。</p></div>
        <form className="clinical-form test-order-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'ORDER_TEST', data: { requestedTests, reason: testReason.trim() || undefined } }); if (result) { setRequestedTests(''); setTestReason(''); openCaseRecord(); } }}>
          <div className="form-field"><label htmlFor="requested-tests">检查申请</label><textarea id="requested-tests" required minLength={2} rows={3} value={requestedTests} onChange={(e) => setRequestedTests(e.target.value)} placeholder="例如：血常规、C反应蛋白、胸片" /></div>
          <div className="form-field"><label htmlFor="test-reason">申请理由（可选）</label><input id="test-reason" value={testReason} onChange={(e) => setTestReason(e.target.value)} placeholder="这项检查要回答什么临床问题？" /></div>
          <button className="btn btn-primary btn-block" disabled={busy || !requestedTests.trim()}>提交检查申请 <ChevronRight size={15}/></button>
        </form>
      </>;
      case 'assessment': return <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'SUBMIT_DECISION', data: { diagnosis, secondaryDiagnosis: secondaryDiagnosis.map((item) => item.trim()).filter(Boolean), summary, diagnosisBasis, differentials,linkedEventIds:decisionEvidenceIds } }); if (result) await navigate('plan'); }}>
        <div className="stage-intro"><p className="eyebrow">证据整合</p><h2>病情摘要与初步诊断</h2><p>只使用你在本次会话中实际获得的信息，体现儿科年龄特点和危险信号判断。</p></div>
        <div className="form-field"><label htmlFor="summary">病情摘要</label><textarea id="summary" required minLength={10} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="年龄、主诉、重要阳性与阴性信息、危险信号…" /></div>
        <div className="form-field"><label htmlFor="diagnosis">初步诊断</label><input id="diagnosis" required value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="输入诊断与病情严重程度" /></div>
        <div className="form-field">
          <label htmlFor="secondary-diagnosis-1">并列诊断（可选，最多 2 条）</label>
          <input
            id="secondary-diagnosis-1"
            value={secondaryDiagnosis[0] ?? ''}
            onChange={(e) => {
              const next = [e.target.value, secondaryDiagnosis[1] ?? ''];
              setSecondaryDiagnosis(next);
            }}
            placeholder="并列诊断 1；没有就留空"
          />
          <input
            aria-label="并列诊断 2"
            value={secondaryDiagnosis[1] ?? ''}
            onChange={(e) => {
              const next = [secondaryDiagnosis[0] ?? '', e.target.value];
              setSecondaryDiagnosis(next);
            }}
            placeholder="并列诊断 2；没有就留空"
          />
          <small>每条写一个诊断；病例分析会按第一诊断和并列诊断分别计分。</small>
        </div>
        <div className="form-field"><label htmlFor="diagnosis-basis">诊断依据（必填）</label><textarea id="diagnosis-basis" required minLength={10} value={diagnosisBasis} onChange={(e) => setDiagnosisBasis(e.target.value)} placeholder="支撑该诊断的病史、体征与检查证据：哪些阳性发现支持诊断？关键阴性发现排除了什么？" /></div>
        <fieldset className="form-field"><legend>关联诊断依据的记录（可选）</legend><ExpandableNote label="怎么关联？" align="start"><p>选择你实际使用的记录，并在诊断依据中说明它支持或排除了什么，无需全选。</p></ExpandableNote>{decisionEvidenceItems.length?<details><summary>选择本轮已获得的记录</summary>{decisionEvidenceItems.map(item=><label className="checkbox-row" key={item.id}><input type="checkbox" checked={decisionEvidenceIds.includes(item.id)} disabled={busy} onChange={event=>setDecisionEvidenceIds(event.target.checked?[...decisionEvidenceIds,item.id]:decisionEvidenceIds.filter(id=>id!==item.id))}/><span>{item.summary}</span></label>)}</details>:<small>本轮尚无可关联的问诊、查体或检查记录；仍可在诊断依据中说明接诊时已知的信息。</small>}</fieldset>
        <div className="form-field"><div className="field-label-row"><label htmlFor="differentials">鉴别诊断</label><button className="btn btn-quiet" type="button" disabled={busy || !differentials} onClick={() => setDifferentials('')}>清空鉴别诊断</button></div><textarea id="differentials" value={differentials} onChange={(e) => setDifferentials(e.target.value)} placeholder="列出需要鉴别的疾病及理由" /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>提交诊断并继续</button>
      </form>;
      case 'plan': return <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'SUBMIT_PLAN', data: { priority, detail: planDetail } }); if (result) { if (session.mode === 'osce') await navigate('communication'); else if (session.mode === 'practice') await finish(); else await navigate('history'); } }}>
        <div className="stage-intro"><p className="eyebrow">患者安全优先</p><h2>治疗计划</h2><p>首要处置写当前最先做的一件事；后续计划补充药物、监测、复评和随访，无需重复诊断依据。接受要点简答。</p></div>
        <div className="form-field"><label htmlFor="priority">首要处置</label><input id="priority" required value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="此刻最先做什么？" /></div>
        <div className="form-field"><label htmlFor="plan-detail">后续治疗与监测</label><textarea id="plan-detail" required minLength={5} value={planDetail} onChange={(e) => setPlanDetail(e.target.value)} placeholder="补充后续治疗、必要安全条件、监测与复评；不必重复上面的首要处置。" /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>{session.caseOptions ? '保存治疗计划并继续' : '安全校验并继续'}</button>
      </form>;
      case 'communication': return activeScenario?.focus === 'communication'
        // 阶段 D：家长焦虑沟通专项使用模拟通话界面（AI 模拟标识、通话时长、静音、停止播报、结束确认）；
        // 语音不可用时组件内提供文字输入，训练进度不受影响。
        ? <CommunicationCall session={session} ttsReady={speechCapabilities?.tts === 'turn-based'} busy={busy} pending={pendingConversation} streamingIds={streamingIds} onStreamDone={clearStreamId} onSend={sendConversationText} onFinish={finish} canFinish={Boolean(session.communication)} />
        : conversationContent;
      case 'report': return <div className="loading-screen"><div><div className="pulse-mark"><Activity /></div><strong>正在生成可解释报告…</strong></div></div>;
    }
  })();

  return (
    <main className="training-shell" data-note={noteOpen} data-exam={spatialExam} id="main-content">
      <audio ref={cracklesAudioRef} src="/media/clinical/audio/pediatric-fine-crackles-right.mp3" preload="auto" />
      <audio ref={wheezeAudioRef} src="/media/clinical/audio/pediatric-wheeze.mp3" preload="auto" />
      <header className="training-head">
        <div className="training-toolbar">
          <button className="icon-btn" type="button" onClick={leaveTraining} aria-label="暂时退出训练"><ArrowLeft size={18} /></button>
          <div className="training-title"><strong>{caseProfile.title}</strong></div>
          <ExpandableNote variant="icon" label="教学说明">
            <p>本平台用于教学训练，虚拟患儿与病例资料不用于真实临床诊疗。</p>
            <p>查体所见与辅助检查结果只取自本病例绑定的原始资料；资料没有提供的项目不由 AI 生成，界面会如实说明「本病例资料未提供该项结果」。</p>
          </ExpandableNote>
          {session.mode === 'osce' ? <div className="timer"><Clock3 size={14} /> {String(Math.floor((remaining ?? 0) / 60)).padStart(2,'0')}:{String((remaining ?? 0) % 60).padStart(2,'0')}</div> : <button className="icon-btn" type="button" onClick={leaveTraining} aria-label="回到首页"><Home size={17} /></button>}
        </div>
        <div className="workspace-stage-row">
          <div className="stage-scroll" aria-label="训练阶段">
            {visibleStages.filter(stage=>stage.id!=='report').map((stage,index) => <button key={stage.id} className="stage-chip" data-current={!noteOpen && displayStage === stage.id} data-done={stageCompleted(stage.id)} disabled={busy || stage.id === 'report' || (session.mode === 'osce' && index < currentIndex) || (practiceCompletion === 'safety_decision_plan' && stage.id === 'plan' && !session.decision)} onClick={() => { void navigate(stage.id); }} aria-label={stage.label}>{stage.short}</button>)}
            <button type="button" className="stage-chip" data-current={noteOpen} disabled={busy} onClick={openNote} aria-label="病历书写">病历</button>
            <button type="button" className="stage-chip" disabled aria-label="训练报告">报告</button>
            {!noteOpen&&nextAction&&!activeScenario&&<button className="btn btn-primary stage-action" type="button" disabled={busy} onClick={()=>void navigate(nextAction.stage)}>{nextAction.label}<ChevronRight size={15}/></button>}
            {!noteOpen&&session.plan&&session.communication&&<button className="btn btn-primary stage-action" type="button" disabled={busy} onClick={openNote}>书写病历<ChevronRight size={15}/></button>}
          </div>
          <button className="btn btn-secondary record-drawer-trigger" type="button" onClick={()=>setRecordOpen(true)}><ClipboardList size={15}/>病例记录</button>
          {!noteOpen && <DirectionHint key={`${session.id}:${session.stage}`} sessionId={session.id} stage={session.stage} mode={session.mode} />}
        </div>
      </header>
      {error && <div className="alert" role="alert" style={{ margin: '14px 14px 0' }}>{error}</div>}
      {noteOpen?<div className="training-note-workspace"><NoteWriting ref={noteRef} sessionId={session.id} embedded context={session} onComplete={finish}/></div>:<div className="training-grid" data-patient={showPatient} data-exam={spatialExam} data-record-inline={!drawerStage && !recordOpen}>
        {(!spatialExam || practiceCompletion === 'exam_observation') && <section tabIndex={-1} className="workspace-panel training-primary" data-stage={displayStage} data-mobile-hidden={false}>
          <div className="panel-head"><h2>{visibleStages[currentIndex]?.label}</h2><div className="panel-actions">{displayStage !== 'triage' && displayStage !== 'history' && displayStage !== 'communication' && displayStage !== 'report' && session.mode !== 'osce' && !activeScenario && <button className="conversation-return" type="button" onClick={() => { void navigate('history'); }}><MessageCircle size={14} /> 继续交流</button>}{busy && <LoaderCircle className="patient-breath" size={18} />}</div></div>
          <div className="panel-body">{currentFocus && <div className="focus-banner"><span>本轮重点</span><strong>{focusLabels[currentFocus]}</strong></div>}{stageContent}{feedback && <div className="feedback">{feedback}</div>}</div>
        </section>}
        {showPatient&&<section className="workspace-panel training-patient" data-mobile-hidden={false}><div className="panel-head"><h2>自主体格检查</h2><span className="emotion-pill">{caseProfile.age} · {caseProfile.sex}</span></div><button type="button" className="ce-mobile-record-trigger" onClick={()=>setRecordOpen(true)}><ClipboardList size={16}/>共享病例记录<span>查看已获得信息</span></button><PatientFigure growthMeasurements={Boolean(session.caseOptions?.growthMeasurements)} posture={effectivePosture} position={effectivePosition} patient={caseProfile} positions={postureOptions} onPositionChange={setPosture} onExamine={examine} observation={examObservation} onCloseObservation={() => setExamObservation(null)} onReplayAudio={replayObservationAudio} busy={busy} hygieneCompleted={hygieneCompleted} showReference={session.mode!=='osce'} completedActions={session.events.filter(event=>event.type==='EXAM_ACTION'&&event.correct===true&&event.examAction).map(event=>event.examAction!)} /></section>}
        {!drawerStage && !recordOpen && <section ref={recordPanelRef} tabIndex={-1} className="workspace-panel training-record" aria-label="共享病例记录" data-mobile-hidden={true}>
          <SharedCaseRecord session={session} onOpenNote={openNote} onExpand={()=>setRecordOpen(true)} audioObservation={examObservation?.status === 'success' && examObservation.sound ? { title: examObservation.title, sound: examObservation.sound } : null} onReplayAudio={replayObservationAudio} />
        </section>}
      </div>}
      <CaseRecordDrawer session={session} open={recordOpen} onClose={()=>setRecordOpen(false)} onOpenNote={openNote} />

    </main>
  );
}
