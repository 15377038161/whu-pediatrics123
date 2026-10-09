import type { AgentRuntimeSummary, AgentTraceItem, PracticeFocus, SessionMode, SessionState, SyncEventV1, TrainingReport, UserContext } from '@/domain/agent';
import { createInitialSession, refreshSourceSession } from '@/lib/agent-engine';
import { buildReport } from '@/lib/scoring';
import { getSupabaseUserClient, withDatabaseRetry } from '@/lib/supabase-client';
import { ensureCaseSnapshot, getSnapshotVersion, restoreCaseSnapshotFacts, getDatabaseSnapshotVersion } from '@/lib/case-snapshot';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface TeacherStudentSummary {
  id: string;
  displayName: string;
  studentNo: string | null;
  latestScore: number | null;
  latestScoreBasis?: 'clinical' | 'process';
  latestMode: SessionMode | null;
  reportCount: number;
  latestReportId: string | null;
  latestSessionId: string | null;
  lastActiveAt: string | null;
}

export interface TeacherSessionDetail {
  session: SessionState;
  report: TrainingReport | null;
  student: { id: string; displayName: string; studentNo: string | null };
}

interface Store {
  sessions: Map<string, SessionState>;
  reports: Map<string, TrainingReport>;
  users: Map<string, UserContext>;
  syncEvents: Map<string, SyncEventV1>;
}

declare global {
  var __luojiaPedsStore: Store | undefined;
}

function memoryStore(): Store {
  if (!globalThis.__luojiaPedsStore) {
    globalThis.__luojiaPedsStore = {
      sessions: new Map(),
      reports: new Map(),
      users: new Map(),
      syncEvents: new Map(),
    };
  }
  return globalThis.__luojiaPedsStore;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const DEFAULT_COHORT_ID = '10000000-0000-4000-8000-000000000102';

function previewSeedUsers(store: Store): void {
  const seeds: UserContext[] = [
    { id: 'preview-student-001', role: 'student', displayName: '张同学', studentNo: '20240001', provider: 'preview', chaoxingUid: null },
    { id: 'preview-student-002', role: 'student', displayName: '李同学', studentNo: '20240002', provider: 'preview', chaoxingUid: null },
    { id: 'preview-student-003', role: 'student', displayName: '王同学', studentNo: '20240003', provider: 'preview', chaoxingUid: null },
  ];
  for (const [index, user] of seeds.entries()) {
    if (!store.users.has(user.id)) store.users.set(user.id, user);
    const existing = [...store.sessions.values()].some((session) => session.userId === user.id);
    if (existing) continue;
    const session = createInitialSession(user.id, index === 1 ? 'guided' : 'osce');
    session.id = `preview-session-${index + 1}`;
    session.status = 'completed';
    session.stage = 'report';
    session.askedIntents = index === 1 ? ['onset', 'fever', 'general'] : ['onset', 'fever', 'danger', 'general', 'exposure', 'vaccination'];
    session.preparationActions = ['EX_PREP'];
    session.unlockedEvidence = index === 1 ? ['EX_PREP', 'EX_TEMP', 'EX_RESP'] : ['EX_PREP', 'EX_TEMP', 'EX_RESP', 'EX_SPO2', 'EX_MOUTH'];
    session.orderedTests = ['cbc-crp', 'chest-image'];
    session.decision = { diagnosis: '社区获得性肺炎伴低氧风险', summary: '3岁男童发热咳嗽2天，伴气促、静息血氧下降及右下肺细湿啰音。', differentials: '支原体肺炎、病毒性肺炎、喘息性疾病' };
    session.plan = { priority: '监测生命体征并给予氧疗', detail: '吸氧后复评血氧和呼吸，完善感染评估，必要时住院观察。' };
    session.communication = '我理解您很担心。孩子现在呼吸和血氧有风险，我们先吸氧监测，再完成必要检查并及时告诉您下一步。';
    session.events = [
      { id: crypto.randomUUID(), clientEventId: `seed-hx-${index}`, type: 'ASK_QUESTION', stage: 'history', summary: '完成呼吸危险信号问诊', correct: true, evidenceCodes: ['HX_DANGER'], createdAt: session.startedAt },
      { id: crypto.randomUUID(), clientEventId: `seed-ex-${index}`, type: 'EXAM_ACTION', stage: 'exam', summary: '完成肺部听诊与血氧评估', correct: true, evidenceCodes: index === 1 ? ['EX_PREP','EX_RESP'] : ['EX_PREP','EX_RESP','EX_SPO2'], createdAt: session.startedAt },
      { id: crypto.randomUUID(), clientEventId: `seed-dx-${index}`, type: 'SUBMIT_DECISION', stage: 'assessment', summary: '提交初步诊断', correct: true, evidenceCodes: ['DECISION'], createdAt: session.startedAt },
      { id: crypto.randomUUID(), clientEventId: `seed-plan-${index}`, type: 'SUBMIT_PLAN', stage: 'plan', summary: '提交安全处置计划', correct: true, evidenceCodes: ['PLAN'], createdAt: session.startedAt },
      { id: crypto.randomUUID(), clientEventId: `seed-com-${index}`, type: 'SEND_COMMUNICATION', stage: 'communication', summary: '完成家长沟通', correct: true, evidenceCodes: ['COMMUNICATION'], createdAt: session.startedAt },
    ];
    const report = buildReport(session, `preview-report-${index + 1}`);
    session.reportId = report.id;
    store.sessions.set(session.id, clone(session));
    store.reports.set(report.id, clone(report));
  }
}

/**
 * 数据库访问身份（fail-closed）：
 * - 预览身份（provider === 'preview'）走进程内存，不触碰数据库；
 * - 真实身份必须携带会话 JWT（accessToken），以用户身份访问数据库，行级权限完全由 RLS 依 auth.uid() 判定；
 * - 缺少 JWT 时抛 AUTH_REQUIRED，绝不回退匿名/admin 身份。
 */
export class AgentRepository {
  constructor(private readonly actor: UserContext & { accessToken: string | null }) {}

  private isPreview(): boolean {
    return this.actor.provider === 'preview';
  }

  private db(): SupabaseClient {
    if (this.isPreview() || !this.actor.accessToken) throw new Error('AUTH_REQUIRED');
    return getSupabaseUserClient(this.actor.accessToken);
  }

  async createSession(mode: SessionMode, caseId?: string, practiceFocus?: PracticeFocus): Promise<SessionState> {
    // 本地 teaching-cases 缺失时，先预热知识库召回快照（失败降级，不阻塞建会话）。
    // 教师触发时同时持久化 answers（诊断/原文/媒体，仅教师可读），学生仅持久化教学事实。
    let coldStartVersion: string | null = null;
    if (caseId?.startsWith('teacher-')) {
      await ensureCaseSnapshot(caseId, { accessToken: this.actor.accessToken, teacher: this.actor.role === 'teacher' });
      // 首次加载即绑定快照版本：之后（含重启后）按此版本恢复病例事实，防召回漂移换患者。
      // 冷启动兜底（本地文件缺失且召回无缓存）：从 DB 持久缓存解析教师导入版本
      // （case_snapshot_latest_version RPC，仅版本文本无内容）并绑定。
      let version = getSnapshotVersion(caseId);
      if (!version && !this.isPreview() && this.actor.accessToken) {
        version = await getDatabaseSnapshotVersion(caseId, this.actor.accessToken);
        if (version) {
          coldStartVersion = version;
          if (this.actor.role === 'teacher') {
            // 教师直读恢复（RLS app_is_teacher 放行）：恢复写入进程缓存 sourceId@version，
            // 随后 createInitialSession 按 DB 导入版本一次成型完整教学事实。
            await restoreCaseSnapshotFacts(caseId, version, this.actor.accessToken, 'teacher');
          }
        }
      }
      const session = createInitialSession(this.actor.id, mode, caseId, practiceFocus, version);
      if (version) session.sourceSnapshotVersion = version;
      if (this.isPreview()) {
        const store = memoryStore();
        store.users.set(this.actor.id, this.actor);
        store.sessions.set(session.id, clone(session));
        return session;
      }
      const db = this.db();
      const { error } = await db.from('training_sessions').insert({
        id: session.id,
        user_id: this.actor.id,
        cohort_id: DEFAULT_COHORT_ID,
        case_id: session.caseId,
        case_version: session.caseVersion,
        mode: session.mode,
        stage: session.stage,
        status: session.status,
        state: session,
        started_at: session.startedAt,
        updated_at: session.updatedAt,
        expires_at: session.expiresAt,
      });
      if (error) throw error;
      // 学生冷启动：会话行已落库（版本绑定生效，RPC 校验：会话归属本人+版本绑定+病例匹配），
      // 经受控 RPC 恢复教学事实写入进程缓存后，以 DB 导入版本重建展示字段
      // （caseOptions/vitals/messages；新会话无学生内容，整体重建安全）并回写 DB。
      // RPC 校验失败/无数据保持"资料不足"，不回退漂移数据换患者。
      if (coldStartVersion && this.actor.role !== 'teacher') {
        const facts = await restoreCaseSnapshotFacts(caseId, coldStartVersion, this.actor.accessToken, this.actor.role, session.id);
        if (facts) {
          const fresh = createInitialSession(this.actor.id, mode, caseId, practiceFocus, coldStartVersion);
          session.caseVersion = fresh.caseVersion;
          session.caseOptions = fresh.caseOptions;
          session.vitals = fresh.vitals;
          session.messages = fresh.messages;
          session.updatedAt = new Date().toISOString();
          const { error: updateError } = await db.from('training_sessions').update({ state: session, updated_at: session.updatedAt }).eq('id', session.id).eq('user_id', this.actor.id);
          if (updateError) throw updateError;
        }
      }
      return session;
    }
    const session = createInitialSession(this.actor.id, mode, caseId, practiceFocus);
    if (this.isPreview()) {
      const store = memoryStore();
      store.users.set(this.actor.id, this.actor);
      store.sessions.set(session.id, clone(session));
      return session;
    }
    const db = this.db();
    const { error } = await db.from('training_sessions').insert({
      id: session.id,
      user_id: this.actor.id,
      cohort_id: DEFAULT_COHORT_ID,
      case_id: session.caseId,
      case_version: session.caseVersion,
      mode: session.mode,
      stage: session.stage,
      status: session.status,
      state: session,
      started_at: session.startedAt,
      updated_at: session.updatedAt,
      expires_at: session.expiresAt,
    });
    if (error) throw error;
    return session;
  }

  async getSession(id: string): Promise<SessionState> {
    if (this.isPreview()) {
      const session = memoryStore().sessions.get(id);
      if (!session) throw new Error('SESSION_NOT_FOUND');
      if (this.actor.role !== 'teacher' && session.userId !== this.actor.id) throw new Error('FORBIDDEN');
      if (session.caseId.startsWith('teacher-')) await ensureCaseSnapshot(session.caseId);
      return refreshSourceSession(clone(session));
    }
    const db = this.db();
    const { data } = await withDatabaseRetry(async () => {
      const result = await db.from('training_sessions').select('state,user_id,cohort_id').eq('id', id).maybeSingle();
      if (result.error) throw result.error;
      return result;
    });
    if (!data) throw new Error('SESSION_NOT_FOUND');
    // 教师访问由 RLS（teacher_select via app_is_teacher）放行；学生仅限本人
    if (this.actor.role !== 'teacher' && data.user_id !== this.actor.id) throw new Error('FORBIDDEN');
    const restored = data.state as SessionState;
    if (restored.caseId?.startsWith('teacher-')) {
      // 版本绑定：会话已有绑定版本时按版本从数据库恢复教学事实（防召回漂移/TTL过期/重启换患者）；
      // 未绑定版本（旧会话）绑定当前快照版本。
      if (restored.sourceSnapshotVersion) {
        // 学生走受控 RPC（会话归属+版本绑定校验）；教师直读。RPC 返回 null（校验失败/无数据）
        // 时不做兜底召回换患者：保持会话绑定的空事实（资料不足），由 ensureCaseSnapshot 仅在
        // 召回版本与会话绑定版本一致时才允许刷新（见 ensureCaseSnapshotCompat）。
        const facts = await restoreCaseSnapshotFacts(restored.caseId, restored.sourceSnapshotVersion, this.actor.accessToken, this.actor.role, restored.id);
        if (!facts && this.actor.role === 'teacher') {
          await ensureCaseSnapshot(restored.caseId, { accessToken: this.actor.accessToken, teacher: true });
        }
      } else {
        await ensureCaseSnapshot(restored.caseId, { accessToken: this.actor.accessToken, teacher: this.actor.role === 'teacher' });
        const version = getSnapshotVersion(restored.caseId);
        if (version) {
          restored.sourceSnapshotVersion = version;
          await db.from('training_sessions').update({ state: restored }).eq('id', id).eq('user_id', this.actor.id);
        }
      }
    }
    return refreshSourceSession(restored);
  }

  async saveSession(session: SessionState): Promise<void> {
    if (this.isPreview()) {
      memoryStore().sessions.set(session.id, clone(session));
      return;
    }
    if (session.userId !== this.actor.id) throw new Error('FORBIDDEN');
    const db = this.db();
    const { error } = await db.from('training_sessions').update({
      stage: session.stage,
      status: session.status,
      state: session,
      updated_at: session.updatedAt,
    }).eq('id', session.id).eq('user_id', this.actor.id);
    if (error) throw error;
    if (session.messages.length > 0) {
      const { error: messageError } = await db.from('training_messages').upsert(session.messages.map((item) => ({
        id: item.id,
        session_id: session.id,
        actor: item.actor,
        content: item.content,
        emotion: item.emotion,
        message_kind: item.kind,
        created_at: item.createdAt,
      })), { onConflict: 'id' });
      if (messageError) throw messageError;
    }
    if (session.events.length > 0) {
      const { error: operationError } = await db.from('clinical_operations').upsert(session.events.map((item) => ({
        id: item.id,
        session_id: session.id,
        client_event_id: item.clientEventId,
        event_type: item.type,
        stage: item.stage,
        payload: { summary: item.summary },
        result: { correct: item.correct, evidenceCodes: item.evidenceCodes },
        created_at: item.createdAt,
      })), { onConflict: 'session_id,client_event_id' });
      if (operationError) throw operationError;
    }
  }

  async saveAgentCall(sessionId: string, clientEventId: string, trace: AgentTraceItem[], runtime?: AgentRuntimeSummary): Promise<void> {
    if (this.isPreview()) return;
    const db = this.db();
    const { error } = await db.from('agent_call_records').upsert({
      session_id: sessionId,
      client_event_id: clientEventId,
      execution: runtime?.execution ?? 'deterministic',
      model_name: runtime?.model ?? null,
      duration_ms: runtime?.durationMs ?? 0,
      trace,
    }, { onConflict: 'session_id,client_event_id', ignoreDuplicates: true });
    if (error) throw error;
  }

  async saveReport(report: TrainingReport, event: SyncEventV1): Promise<void> {
    if (this.isPreview()) {
      const store = memoryStore();
      store.reports.set(report.id, clone(report));
      store.syncEvents.set(event.eventId, clone(event));
      return;
    }
    if (report.userId !== this.actor.id) throw new Error('FORBIDDEN');
    if (!this.actor.accessToken) throw new Error('AUTH_REQUIRED');
    const db = this.db();
    // 报告写入走受控 RPC（会话归属+完成态+幂等校验，分数由服务端 buildReport 计算）：
    // 学生无任何直接 INSERT/UPDATE 策略，无法自插自选分数的报告行。
    const { data: saved, error: rpcError } = await db.rpc('report_save_completed', {
      p_report_id: report.id,
      p_session_id: report.sessionId,
      p_case_id: report.caseId,
      p_mode: report.mode,
      p_total_score: report.totalScore,
      p_status: report.status,
      p_data: report,
    });
    if (rpcError) throw rpcError;
    if (saved !== true) throw new Error('REPORT_SAVE_REJECTED');
    // 副作用（能力画像 + 同步事件 outbox）走受控 RPC：
    // ability_profiles/sync_outbox 无学生直写策略（RLS 拒绝 42501），RPC 校验
    // 会话归属+完成态+报告已合法写入，数据全部来自服务端 buildReport 产物。
    const { data: sideEffects, error: sideEffectsError } = await db.rpc('report_side_effects_save', {
      p_session_id: report.sessionId,
      p_display_name: this.actor.displayName,
      p_ability: { dimensions: report.abilities, recommendation: { text: report.recommendation, improvements: report.improvements } },
      p_event_id: event.eventId,
      p_event_payload: event,
    });
    if (sideEffectsError) throw sideEffectsError;
    if (sideEffects !== true) throw new Error('REPORT_SIDE_EFFECTS_REJECTED');
  }

  async getReport(id: string): Promise<TrainingReport> {
    if (this.isPreview()) {
      const report = memoryStore().reports.get(id);
      if (!report) throw new Error('REPORT_NOT_FOUND');
      if (this.actor.role !== 'teacher' && report.userId !== this.actor.id) throw new Error('FORBIDDEN');
      return clone(report);
    }
    const db = this.db();
    // 学生走受控 RPC（受保护 user_id 列判定）；教师直读（RLS teacher_select 放行）
    if (this.actor.role === 'student') {
      const { data, error } = await db.rpc('report_get_mine', { p_report_id: id });
      if (error) throw error;
      if (!data || typeof data !== 'object') throw new Error('REPORT_NOT_FOUND');
      return (data as { data: TrainingReport }).data as TrainingReport;
    }
    const { data, error } = await db.from('training_reports').select('data,user_id,session_id').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('REPORT_NOT_FOUND');
    return data.data as TrainingReport;
  }

  async listOwnReports(): Promise<TrainingReport[]> {
    if (this.isPreview()) {
      return [...memoryStore().reports.values()].filter((report) => report.userId === this.actor.id).map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const db = this.db();
    // 学生走受控 RPC（受保护 user_id 列判定，无直读策略）；教师走 RLS 直读后过滤本人
    if (this.actor.role === 'student') {
      const { data, error } = await db.rpc('report_list_mine');
      if (error) throw error;
      return ((data ?? []) as Array<{ data: TrainingReport }>).map((row) => row.data as TrainingReport);
    }
    const { data } = await withDatabaseRetry(async () => {
      const result = await db.from('training_reports').select('data').eq('user_id', this.actor.id).order('created_at', { ascending: false });
      if (result.error) throw result.error;
      return result;
    });
    return (data ?? []).map((row) => row.data as TrainingReport);
  }

  async listTeacherStudents(): Promise<TeacherStudentSummary[]> {
    if (this.actor.role !== 'teacher') throw new Error('FORBIDDEN');
    if (this.isPreview()) {
      const store = memoryStore();
      previewSeedUsers(store);
      return [...store.users.values()].filter((user) => user.role === 'student').map((user, index) => {
        const reports = [...store.reports.values()].filter((report) => report.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const latest = reports[0];
        const latestSession = latest ? store.sessions.get(latest.sessionId) : null;
        return {
          id: user.id,
          displayName: user.displayName,
          studentNo: user.studentNo,
          latestScore: latest?.totalScore ?? [86, 78, 92][index] ?? null,
          latestScoreBasis: latest?.scoreBasis ?? 'clinical',
          latestMode: latest?.mode ?? 'osce',
          reportCount: reports.length || 1,
          latestReportId: latest?.id ?? null,
          latestSessionId: latestSession?.id ?? null,
          lastActiveAt: latestSession?.updatedAt ?? new Date(Date.now() - index * 86_400_000).toISOString(),
        };
      });
    }
    const db = this.db();
    // 教师可见范围由 RLS 放行（training_sessions/training_reports 的 teacher_select，基于 teacher_emails 白名单）
    const [{ data: reports }, { data: sessions }] = await Promise.all([
      withDatabaseRetry(async () => {
        const result = await db.from('training_reports').select('id,session_id,user_id,total_score,mode,created_at,data').order('created_at', { ascending: false });
        if (result.error) throw result.error;
        return result;
      }),
      withDatabaseRetry(async () => {
        const result = await db.from('training_sessions').select('user_id,updated_at').order('updated_at', { ascending: false });
        if (result.error) throw result.error;
        return result;
      }),
    ]);
    const ids = [...new Set([
      ...(reports ?? []).map((row) => row.user_id as string),
      ...(sessions ?? []).map((row) => row.user_id as string),
    ])];
    if (ids.length === 0) return [];
    const { data: profiles, error: profileError } = await db.from('profiles').select('id,display_name,student_no').in('id', ids);
    if (profileError) throw profileError;
    return (profiles ?? []).map((profile) => {
      const own = (reports ?? []).filter((report) => report.user_id === profile.id);
      const latest = own[0];
      const lastSession = (sessions ?? []).find((row) => row.user_id === profile.id) ?? null;
      return {
        id: profile.id,
        displayName: profile.display_name,
        studentNo: profile.student_no,
        latestScore: latest?.total_score ?? null,
        latestScoreBasis: (latest?.data as TrainingReport | undefined)?.scoreBasis ?? 'clinical',
        latestMode: (latest?.mode as SessionMode | undefined) ?? null,
        reportCount: own.length,
        latestReportId: latest?.id ?? null,
        latestSessionId: latest?.session_id ?? null,
        lastActiveAt: lastSession?.updated_at ?? latest?.created_at ?? null,
      };
    });
  }

  async listOwnSessions(): Promise<SessionState[]> {
    if (this.isPreview()) {
      return [...memoryStore().sessions.values()]
        .filter((session) => session.userId === this.actor.id)
        .map(clone)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    const db = this.db();
    const { data } = await withDatabaseRetry(async () => {
      const result = await db.from('training_sessions').select('state').eq('user_id', this.actor.id).order('updated_at', { ascending: false });
      if (result.error) throw result.error;
      return result;
    });
    return (data ?? []).map((row) => row.state as SessionState);
  }

  async getTeacherSession(id: string): Promise<TeacherSessionDetail> {
    if (this.actor.role !== 'teacher') throw new Error('FORBIDDEN');
    const session = await this.getSession(id);
    if (this.isPreview()) {
      const user = memoryStore().users.get(session.userId) ?? { id: session.userId, displayName: '学生', studentNo: null };
      const report = [...memoryStore().reports.values()].find((item) => item.sessionId === id) ?? null;
      return { session, report: report ? clone(report) : null, student: { id: user.id, displayName: user.displayName, studentNo: user.studentNo } };
    }
    const db = this.db();
    const [{ data: profile }, { data: reportRow }] = await Promise.all([
      withDatabaseRetry(async () => {
        const result = await db.from('profiles').select('id,display_name,student_no').eq('id', session.userId).single();
        if (result.error) throw result.error;
        return result;
      }),
      withDatabaseRetry(async () => {
        const result = await db.from('training_reports').select('data').eq('session_id', id).maybeSingle();
        if (result.error) throw result.error;
        return result;
      }),
    ]);
    return { session, report: reportRow?.data as TrainingReport | null ?? null, student: { id: profile.id, displayName: profile.display_name, studentNo: profile.student_no } };
  }
}
