'use client';

import { teachingHints } from '@/domain/teaching-copy';
import { isExamResultEvidence } from '@/domain/exam-evidence';
import {diagnosticEvidenceEvents} from '@/domain/clinical-evidence';
import { allowedPostures, patientAppearance } from '@/domain/patient-appearance';
import { resolveCommunicationProfile, speechCapabilityLabel } from '@/domain/communication-profile';
import { ageBandLabel, bindingGapNote, patientAssetByKey, sexPresentationLabel } from '@/domain/patient-assets';
import { CaseMediaGallery } from '@/components/case-media-gallery';

import {
  Activity, ArrowLeft, Check, ChevronRight, Clock3, Eye, Hammer, Hand, Home,
  ClipboardList, Lightbulb, LoaderCircle, MessageCircle, Mic, Send, Stethoscope, UserRound, Volume2, VolumeX, Waves,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentEvent, AgentTurnResult, PracticeFocus, SessionMode, SessionState, Stage, TrainingReport } from '@/domain/agent';
import { getPracticeScenario } from '@/domain/practice-scenarios';
import { findPublicCase, type PublicCaseProfile } from '@/domain/case-catalog';
import { CaseResourcePanel } from '@/components/case-resource-panel';
import { CommunicationCall } from '@/components/communication-call';
import { RoleAudioPlayer, type RoleAudioPlayerHandle } from '@/components/role-audio-player';
import { VoiceInput } from '@/components/voice-input';
import { reportSessionEvent } from '@/lib/engagement-tracker';
import { fetchSpeechCapabilities } from '@/lib/speech';
import type { SpeechCapabilities, SpeechTurnMeta } from '@/domain/speech-contract';

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
/** 来源病例查体规则涉及的额外部位（皮肤/颈部/腹部/四肢，与 createSourceCase 的规则部位一致）。 */
const sourceExamHotspots: Array<[string, string]> = [
  ['neck', '颈部'], ['skin', '皮肤'], ['abdomen', '腹部'], ['limbs', '四肢'],
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
  const appearance=patientAppearance(patient.sex,posture,patient.id,patient.age);
  // 人物背景（方案 9.1/9.2 与 17.2 V09 人物匹配）：角色能力经 communicationProfile 派生，
  // 素材信息经资产清单；未知不猜、未审核不伪装（derivation 如实展示）。
  const profile = resolveCommunicationProfile(patient.id, patient.age);
  const asset = patientAssetByKey(appearance.key);
  const assetGap = bindingGapNote(profile.ageBand);
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
        /> : <div className="patient-unspecified" role="img" aria-label={appearance.alt}><UserRound size={100} /><p>{appearance.key === 'age-unspecified' ? '病例年龄未明确' : '病例未注明性别'}</p><small>暂不指定人物形象，请依据病例记录完成查体。</small></div>}
        {interactive && hotspots.map(([id,label]) => <button key={id} disabled={busy} type="button" className={`hotspot hotspot-${id === 'upper-arm' ? 'arm' : id}`} data-observed={observation?.bodyPartId === id ? observation.status : undefined} onClick={() => onExamine(id)} aria-label={`使用当前器材检查${label}`}><span aria-hidden="true" />{label}</button>)}
      </div>
      <div className="patient-caption"><span>{interactive ? <>当前器材：<strong>{[...tools, ...sourceExamTools].find((tool) => tool.id === selectedTool)?.label ?? '未选择'}</strong></> : <strong>观察模式</strong>}</span><span className="emotion-pill">部位定位 · 请依据查体记录</span></div>
      {interactive && observation && <div className="exam-observation" data-status={observation.status} data-tool={observation.toolId} role="status" aria-live="polite">
        <div className="exam-observation-head"><span className="exam-observation-icon" aria-hidden="true">{observation.toolId === 'stethoscope' ? <Stethoscope /> : <Activity />}</span><p><small>{observation.status === 'success' ? '查体结果已获得' : '本次操作未生效'}</small><strong>{observation.title}</strong></p>{observation.status === 'success' && observation.sound && <button type="button" onClick={() => onReplayObservation(observation)} aria-label="播放真实儿科听诊音" title="播放结果声音"><Volume2 /></button>}</div>
        {observation.sound && observation.status === 'success' && <div className="exam-auscultation" data-sound={observation.sound} aria-hidden="true"><Waves /><span /><span /><span /><span /><span /></div>}
        <p className="exam-observation-detail">{observation.detail}</p>
        <small className="exam-observation-note">{observation.sound && observation.toolId === 'stethoscope' && observation.status === 'success' ? <>真实儿科听诊录音节选 · <a href="https://github.com/SJTU-YONGFU-RESEARCH-GRP/SPRSound" target="_blank" rel="noreferrer">SPRSound / CC BY 4.0</a></> : '标准化患儿教学反馈 · 文字结果来自病例规则'}</small>
      </div>}
      <details className="patient-background">
        <summary>人物背景</summary>
        <dl>
          <div><dt>年龄</dt><dd>{ageBandLabel(profile.ageBand)}（病例原文：{patient.age || '未记录'}）</dd></div>
          <div><dt>性别</dt><dd>{sexPresentationLabel(patient.sex)}</dd></div>
          <div><dt>语言表达</dt><dd>{speechCapabilityLabel(profile)}</dd></div>
          <div><dt>病史陈述</dt><dd>{profile.primaryHistorian === 'child' ? '患儿本人可答主观感受' : '照护者代述'}</dd></div>
          <div><dt>照护者</dt><dd>{profile.caregiverGender === 'unknown' ? `${profile.caregiverRelation}（性别未定，不默认妈妈/爸爸）` : `${profile.caregiverRelation}（${profile.caregiverGender === 'female' ? '女性' : '男性'}）`}</dd></div>
          <div><dt>示教素材</dt><dd>{asset ? `${asset.note}${assetGap ? `；${assetGap}` : ''}` : '未指定素材（性别未注明，不猜）'}</dd></div>
          <div><dt>审核状态</dt><dd>{profile.derivation === 'case_override' ? '已逐例审核覆盖' : '年龄默认档（未逐例医学审核）'}</dd></div>
        </dl>
      </details>
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
  const [decisionEvidenceIds,setDecisionEvidenceIds]=useState<string[]>([]);
  const [posture, setPosture] = useState<'standing' | 'supine'>('standing');
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
  const [mobileView, setMobileView] = useState<'task' | 'patient' | 'record'>('task');
  const [hintIndex, setHintIndex] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  // 阶段 D 语音链：能力探测（服务端真实探测，失败按不可用隐藏入口）；文字/语音输入切换；角色播报静音。
  const [speechCapabilities, setSpeechCapabilities] = useState<SpeechCapabilities | null>(null);
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [roleAudioMuted, setRoleAudioMuted] = useState(false);
  const audioPlayerRef = useRef<RoleAudioPlayerHandle>(null);

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
    setDecisionEvidenceIds(next.decision?.linkedEventIds ?? []);
    setDifferentials(next.decision?.differentials ?? '');
    setPriority(next.plan?.priority ?? '');
    setPlanDetail(next.plan?.detail ?? '');
    setHistorySummaryText(next.historySummary ?? '');
    setExamFindingsText(next.examObservation?.findings ?? '');
    setExamInterpretationText(next.examObservation?.interpretation ?? '');
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


  // 阶段 D：语音能力真实探测（每会话一次）；探测失败按不可用处理，语音入口隐藏、文字流程不受影响
  const speechProbeSessionId = session?.id ?? null;
  useEffect(() => {
    if (!speechProbeSessionId) return;
    let cancelled = false;
    void fetchSpeechCapabilities().then((capabilities) => {
      if (!cancelled) setSpeechCapabilities(capabilities);
    });
    return () => { cancelled = true; };
  }, [speechProbeSessionId]);


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
    (examFindingsText.trim() && (examFindingsText !== (session?.examObservation?.findings ?? '') || examInterpretationText !== (session?.examObservation?.interpretation ?? ''))) ||
    (examLinkedEvidence.length > 0 && examLinkedEvidence.join(',') !== (session?.examObservation?.linkedEvidence ?? []).join(',')) ||
    (session && (diagnosis !== (session.decision?.diagnosis ?? '') || summary !== (session.decision?.summary ?? '') ||
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
  // 语音轮发送（阶段 D）：语义推导与单聊天框一致；携带语音轮元数据（ASR 原文与是否编辑）。
  // 返回是否成功：失败时语音组件保留确认草稿可重试/回退文字，训练进度不受影响。
  async function sendConversationText(text: string, speech: SpeechTurnMeta | null): Promise<boolean> {
    if (!text.trim() || !session) return false;
    const isCommunication = session.stage === 'communication' || Boolean(session.plan);
    const result = await sendEvent(
      isCommunication
        ? { type: 'SEND_COMMUNICATION', data: { text, speech: speech ?? undefined } }
        : { type: 'ASK_QUESTION', data: { text, speech: speech ?? undefined } },
    );
    return Boolean(result);
  }
  async function examine(part: string, toolOverride?: string) {
    const partLabel = ({ forehead: '头面', mouth: '口咽', chest: '胸部', 'upper-arm': '上臂', finger: '手指', hands: '双手', neck: '颈部', skin: '皮肤', abdomen: '腹部', limbs: '四肢' } as Record<string,string>)[part] ?? part;
    const activeTool = toolOverride ?? selectedTool;
    if (!activeTool) {
      const detail = '请先选择检查方法或器材，再点击患儿对应部位。';
      setError(detail);
      setExamObservation({ bodyPartId: part, title: partLabel, detail, toolId: 'none', status: 'blocked', sound: null });
      return;
    }
    const toolLabel = [...tools, ...sourceExamTools].find((tool) => tool.id === activeTool)?.label ?? activeTool;
    const result = await sendEvent({ type: 'EXAM_ACTION', data: { toolId: activeTool, bodyPartId: part, posture: effectivePosture } });
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
  const postureOptions = allowedPostures(caseProfile.age);
  const effectivePosture = postureOptions.includes(posture) ? posture : postureOptions[0];
  const spatialExam = displayStage === 'exam';
  const examTools = [...tools, ...sourceExamTools].filter(tool => !session.caseOptions || session.caseOptions.exams.some(exam => exam.toolId === tool.id));
  const examHotspots = [...baseExamHotspots, ...sourceExamHotspots].filter(([id]) => !session.caseOptions || session.caseOptions.exams.some(exam => exam.bodyPartId === id && exam.toolId === selectedTool));
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
  // 语音能力就绪（服务端真实探测 asr/tts 均 turn-based）；否则语音入口隐藏、文字流程不受影响
  const speechReady = speechCapabilities?.asr === 'turn-based' && speechCapabilities?.tts === 'turn-based';
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
        return <div className="message" data-actor={item.actor} key={item.id}><p className="message-label"><span>{actorLabel(item.actor)} · {item.emotion}{item.inputMode === 'voice' ? ' · 语音输入' : ''}</span></p><div className="message-bubble">{item.content}</div></div>;
      })}
    </div>
    {speechReady && (
      <>
        <RoleAudioPlayer ref={audioPlayerRef} sessionId={session.id} messages={session.messages} enabled={!roleAudioMuted} />
        <div className="voice-toolbar" role="group" aria-label="语音控制">
          <button className="btn btn-secondary" type="button" aria-pressed={inputMode === 'voice'} onClick={() => setInputMode((value) => (value === 'voice' ? 'text' : 'voice'))}>
            {inputMode === 'voice' ? <MessageCircle size={15} /> : <Mic size={15} />} {inputMode === 'voice' ? '改用文字输入' : '语音输入'}
          </button>
          <button className="btn btn-secondary" type="button" aria-pressed={!roleAudioMuted} onClick={() => setRoleAudioMuted((value) => !value)} title="角色语音播报开关">
            {roleAudioMuted ? <VolumeX size={15} /> : <Volume2 size={15} />} {roleAudioMuted ? '角色播报已静音' : '角色语音播报中'}
          </button>
        </div>
      </>
    )}
    {inputMode === 'voice' && speechReady ? (
      <VoiceInput communicationMode={communicationModeActive} disabled={busy} onSend={sendConversationText} />
    ) : (
    <div className="composer" data-mode={communicationModeActive ? 'communication' : 'history'}><label className="sr-only" htmlFor="question">{communicationModeActive ? '输入对患儿和家长的解释' : '输入你的问诊问题'}</label><textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={communicationModeActive ? '直接向患儿和家长说明，例如：我理解您很担心，孩子目前呼吸和血氧需要先处理……' : '直接和患儿或家长交流，例如：小朋友别紧张，可以告诉我哪里不舒服吗？'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitConversation(); } }} /><div className="composer-actions">{session.mode !== 'osce' && !communicationModeActive && <div className="hint-anchor"><button className="icon-btn hint-trigger" type="button" aria-label="查看问诊提示" aria-expanded={hintOpen} onClick={() => setHintOpen((value) => !value)}><Lightbulb size={17} /></button>{hintOpen && <div className="hint-popover" role="status"><p>{hints[hintIndex % hints.length]}</p><button type="button" onClick={() => setHintIndex((value) => (value + 1) % hints.length)}>换一个方向</button></div>}</div>}<button className="btn btn-primary" type="button" disabled={busy || !question.trim()} onClick={submitConversation}><Send size={16} /> 发送</button></div></div>
    )}
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
        <div className="stage-intro exam-stage-intro"><p className="eyebrow">器材逻辑校验</p><h2>选择检查方法，点击患儿对应部位</h2><p>{session.caseOptions ? '本例仅显示已配置结果的器材和对应部位。先完成手卫生，再选择器材；结果会写入本轮记录。教学模拟内容已单独标识。' : '系统会校验准备动作、器材与部位，并即时反馈真实查体结果。'}</p></div>
        <div className="exam-safety-strip" data-complete={hygieneCompleted} role="status"><span>{hygieneCompleted ? <Check /> : '1'}</span><p><strong>{hygieneCompleted ? '手卫生已完成' : '先完成手卫生'}</strong><small>{hygieneCompleted ? '可以开始接触患儿' : '点击下方“手卫生”即可自动完成'}</small></p></div>
        <div className="posture-selector" role="group" aria-label="查体姿势">{postureOptions.map((value) => { const label = value === 'standing' ? '站立' : '仰卧'; return <button key={value} type="button" className="btn btn-secondary" aria-pressed={effectivePosture === value} disabled={busy} onClick={() => { setPosture(value); setExamObservation(null); }}>{label}</button>; })}<small>{postureOptions.includes('supine') && postureOptions.includes('standing') ? '腹部检查请切换为仰卧' : '新生儿/婴儿仅支持仰卧位查体'}</small></div>
        <div className="exam-tool-selector">
          <div className="exam-tool-heading"><strong>选择方法或器材</strong><span>{selectedTool ? `当前：${examTools.find((tool) => tool.id === selectedTool)?.label ?? '请先选择本例器材'}` : '尚未选择'}</span></div>
          <ToolRack tools={examTools} selectedTool={selectedTool} onSelect={(toolId) => { void selectExamTool(toolId); }} busy={busy} hygieneCompleted={hygieneCompleted} />
        </div>
        <div className="exam-route" aria-label="后续操作"><span>2</span><p><strong>点击患儿检查部位</strong><small>{examEvidenceCount > 0 ? `实时病例记录已新增 ${examEvidenceCount} 项证据` : '有效结果会自动写入右侧病例记录'}</small></p></div>
        {session.caseOptions && <div className="source-result-list" aria-live="polite">{evidenceEvents.filter((event) => event.stage === 'exam').map((event) => <div key={event.id} className="source-result-item"><p>{event.summary}</p>{event.media && event.media.length > 0 ? <CaseMediaGallery sessionId={session.id} media={event.media} /> : null}</div>)}</div>}
        {practiceCompletion === 'exam_observation' && (
          <form className="clinical-form practice-summary-form" onSubmit={async (event) => { event.preventDefault(); if (examFindingsText.trim().length < 10 || examLinkedEvidence.length === 0) return; await sendEvent({ type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: examFindingsText.trim(), interpretation: examInterpretationText.trim() || undefined, linkedEvidence: examLinkedEvidence } }); }}>
            <div className="form-field"><label>关联的查体结果（必选，本次观察所依据）</label>{obtainedExamResultItems.map((item) => <label key={item.code} className="checkbox-row"><input type="checkbox" checked={examLinkedEvidence.includes(item.code)} onChange={(e) => { setExamLinkedEvidence(e.target.checked ? [...new Set([...examLinkedEvidence, item.code])] : examLinkedEvidence.filter((code) => code !== item.code)); }} disabled={busy} /> <span>{item.summary}</span></label>)}<small>选项来自本会话已实际获得结果的查体项（手卫生等准备操作不计入）；服务端按本会话原查体事件与解锁结果核验关联。</small></div>
            <div className="form-field"><label htmlFor="exam-findings">查体观察记录（专项结束条件）</label><textarea id="exam-findings" required minLength={10} rows={3} value={examFindingsText} onChange={(e) => setExamFindingsText(e.target.value)} placeholder="你实际观察到的查体所见：阳性体征、重要阴性发现…（不要求答中评分点，可修订重交）" /></div>
            <div className="form-field"><label htmlFor="exam-interpretation">观察解释（可选）</label><textarea id="exam-interpretation" rows={2} value={examInterpretationText} onChange={(e) => setExamInterpretationText(e.target.value)} placeholder="这些所见提示什么？与病史如何联系？（原文保留在报告快照待教师复核，不做机器计分）" /></div>
            <button className="btn btn-secondary" type="submit" disabled={busy || examEvidenceCount === 0 || examFindingsText.trim().length < 10 || examLinkedEvidence.length === 0}>{session.examObservation ? '修订重交观察与解释' : '提交查体观察与解释'}</button>
            {examEvidenceCount === 0 && <p className="form-hint" role="note">完成至少一项有效查体操作并勾选关联项后才能提交观察（服务端按本会话原查体事件与解锁结果核验）。</p>}
          </form>
        )}
        <div className="form-actions">{practiceCompletion === 'exam_observation' ? <button className="btn btn-primary" type="button" disabled={busy || !session.examObservation} onClick={finish}>{session.examObservation ? '完成查体，生成专项报告' : '提交观察与解释后可结束'} <ChevronRight size={16} /></button> : <><button className="btn btn-primary exam-open-patient" onClick={() => setMobileView('patient')}><UserRound size={16} /> 打开患儿模型</button><button className="btn btn-secondary" onClick={() => navigate('tests')}>完成查体，选择辅助检查 <ChevronRight size={16} /></button></>}</div>
      </>;
      case 'tests': return <>
        <div className="stage-intro"><p className="eyebrow">临床适宜性</p><h2>申请辅助检查</h2><p>像真实接诊一样自主输入需要申请的检查名称，可一次申请多项（用逗号或换行分隔）。系统只返回本病例资料已有的结果；资料未提供的项目会明确说明，不会编造。</p></div>
        <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'ORDER_TEST', data: { requestedTests, reason: testReason.trim() || undefined } }); if (result) { setRequestedTests(''); setTestReason(''); } }}>
          <div className="form-field"><label htmlFor="requested-tests">检查申请</label><textarea id="requested-tests" required minLength={2} rows={3} value={requestedTests} onChange={(e) => setRequestedTests(e.target.value)} placeholder="例如：血常规、C反应蛋白、胸片" /></div>
          <div className="form-field"><label htmlFor="test-reason">申请理由（可选）</label><input id="test-reason" value={testReason} onChange={(e) => setTestReason(e.target.value)} placeholder="这项检查要回答什么临床问题？" /></div>
          <button className="btn btn-primary btn-block" disabled={busy || !requestedTests.trim()}>提交检查申请</button>
        </form>
        <div className="source-result-list" aria-live="polite">{evidenceEvents.filter((event) => event.stage === 'tests').length === 0 && <p>尚无检查记录：提交申请后，结果会在此逐项显示。</p>}{evidenceEvents.filter((event) => event.stage === 'tests').map((event) => <div key={event.id} className="source-result-item"><p>{event.summary}</p>{event.media && event.media.length > 0 ? <CaseMediaGallery sessionId={session.id} media={event.media} /> : null}</div>)}</div>
        <div className="form-actions"><button className="btn btn-secondary" type="button" onClick={() => navigate('assessment')}>形成病情摘要与诊断 <ChevronRight size={16} /></button></div>
      </>;
      case 'assessment': return <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'SUBMIT_DECISION', data: { diagnosis, summary, diagnosisBasis, differentials,linkedEventIds:decisionEvidenceIds } }); if (result) await navigate('plan'); }}>
        <div className="stage-intro"><p className="eyebrow">证据整合</p><h2>病情摘要与初步诊断</h2><p>只使用你在本次会话中实际获得的信息，体现儿科年龄特点和危险信号判断。</p></div>
        <div className="form-field"><label htmlFor="summary">病情摘要</label><textarea id="summary" required minLength={10} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="年龄、主诉、重要阳性与阴性信息、危险信号…" /></div>
        <div className="form-field"><label htmlFor="diagnosis">初步诊断</label><input id="diagnosis" required value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="输入诊断与病情严重程度" /></div>
        <div className="form-field"><label htmlFor="diagnosis-basis">诊断依据（必填）</label><textarea id="diagnosis-basis" required minLength={10} value={diagnosisBasis} onChange={(e) => setDiagnosisBasis(e.target.value)} placeholder="支撑该诊断的病史、体征与检查证据：哪些阳性发现支持诊断？关键阴性发现排除了什么？" /></div>
        <fieldset className="form-field"><legend>关联诊断依据的记录（可选）</legend><p>选择你实际使用的记录，并在诊断依据中说明它支持或排除了什么，无需全选。</p>{decisionEvidenceItems.length?<details><summary>选择本轮已获得的记录</summary>{decisionEvidenceItems.map(item=><label className="checkbox-row" key={item.id}><input type="checkbox" checked={decisionEvidenceIds.includes(item.id)} disabled={busy} onChange={event=>setDecisionEvidenceIds(event.target.checked?[...decisionEvidenceIds,item.id]:decisionEvidenceIds.filter(id=>id!==item.id))}/><span>{item.summary}</span></label>)}</details>:<small>本轮尚无可关联的问诊、查体或检查记录；仍可在诊断依据中说明接诊时已知的信息。</small>}</fieldset>
        <div className="form-field"><label htmlFor="differentials">鉴别诊断</label><textarea id="differentials" value={differentials} onChange={(e) => setDifferentials(e.target.value)} placeholder="列出需要鉴别的疾病及理由" /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>提交诊断并继续</button>
      </form>;
      case 'plan': return <form className="clinical-form" onSubmit={async (event) => { event.preventDefault(); const result = await sendEvent({ type: 'SUBMIT_PLAN', data: { priority, detail: planDetail } }); if (result) { if (session.mode === 'osce') await navigate('communication'); else if (session.mode === 'practice') await finish(); else await navigate('history'); } }}>
        <div className="stage-intro"><p className="eyebrow">患者安全优先</p><h2>治疗及处置计划</h2><p>明确首要处置，再说明监测、进一步评估和后续安排。</p></div>
        <div className="form-field"><label htmlFor="priority">首要处置</label><input id="priority" required value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="此刻最先做什么？" /></div>
        <div className="form-field"><label htmlFor="plan-detail">完整计划</label><textarea id="plan-detail" required minLength={5} value={planDetail} onChange={(e) => setPlanDetail(e.target.value)} placeholder="生命体征稳定、检查、治疗、复评或转诊计划…" /></div>
        <button className="btn btn-primary btn-block" disabled={busy}>{session.caseOptions ? '保存处置计划并继续' : '安全校验并继续'}</button>
      </form>;
      case 'communication': return activeScenario?.focus === 'communication'
        // 阶段 D：家长焦虑沟通专项使用模拟通话界面（AI 模拟标识、通话时长、静音、停止播报、结束确认）；
        // 语音不可用时组件内提供文字输入，训练进度不受影响。
        ? <CommunicationCall session={session} speechReady={speechReady} busy={busy} onSend={sendConversationText} onFinish={finish} canFinish={Boolean(session.communication)} />
        : conversationContent;
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
      {session.caseOptions && <div className="case-source-banner"><strong>学习案例：{session.caseOptions.sourceName}</strong><span>{session.caseOptions.teachingSimulation ? 'AI教学模拟病例：病史、数值和结果为教学设定，配图为示意，非真实患者影像。' : session.caseOptions.hasSource ? '问诊、查体与检查按原病例资料展开；完成后对照诊疗经过复盘。' : '尚无独立病例正文，可开展问诊与诊疗思路记录。'}</span></div>}
      {error && <div className="alert" role="alert" style={{ margin: '14px 14px 0' }}>{error}</div>}
      <div className="training-grid">
        <section className="workspace-panel training-primary" data-stage={displayStage} data-mobile-hidden={mobileView !== 'task'} data-mobile-drawer={spatialExam && mobileView === 'task'}><div className="panel-head"><h2>{visibleStages[currentIndex]?.label}</h2><div className="panel-actions">{displayStage !== 'triage' && displayStage !== 'history' && displayStage !== 'communication' && displayStage !== 'report' && session.mode !== 'osce' && !activeScenario && <button className="conversation-return" type="button" onClick={() => { void navigate('history'); }}><MessageCircle size={14} /> 继续交流</button>}{busy && <LoaderCircle className="patient-breath" size={18} />}</div></div><div className="panel-body">{currentFocus && <div className="focus-banner"><span>本轮专项</span><strong>{focusLabels[currentFocus]}</strong></div>}{stageContent}{feedback && <div className="feedback">{feedback}</div>}</div></section>
        <section className="workspace-panel training-patient" data-mobile-hidden={spatialExam ? false : mobileView !== 'patient'}><div className="panel-head"><h2>{session.caseOptions ? '教学部位示意' : '患儿交互模型'}</h2><span className="emotion-pill">{caseProfile.age} · {caseProfile.sex}</span></div><PatientFigure posture={effectivePosture} patient={caseProfile} hotspots={examHotspots} selectedTool={selectedTool} onExamine={examine} onReplayObservation={(observation) => { if (!playExamObservationAudio(observation)) setFeedback('当前浏览器不支持结果声音播放，请直接阅读查体结果。'); }} observation={examObservation} busy={busy} interactive={spatialExam} />{!spatialExam && <div className="case-band">{session.caseOptions ? '教学示意模型；真实体征请查看本病例查体记录' : '进入查体阶段后解锁器材和体表热区'}</div>}</section>
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
