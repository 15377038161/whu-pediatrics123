import type { AgentRuntimeSummary, AgentTraceItem, SessionMode, SessionState, SyncEventV1, TrainingReport, UserContext } from '@/domain/agent';
import { createInitialSession } from '@/lib/agent-engine';
import { buildReport } from '@/lib/scoring';
import { getSupabaseAdminClient } from '@/lib/supabase-client';

export interface TeacherStudentSummary {
  id: string;
  displayName: string;
  studentNo: string | null;
  latestScore: number | null;
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

async function assertCohortRoleAccess(userId: string, cohortId: string, role: 'student' | 'teacher'): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.from('cohort_members').select('user_id').eq('cohort_id', cohortId).eq('user_id', userId).eq('role', role).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('FORBIDDEN');
}

async function assertTeacherCohortAccess(teacherId: string, cohortId: string): Promise<void> {
  await assertCohortRoleAccess(teacherId, cohortId, 'teacher');
}

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

export class AgentRepository {
  constructor(private readonly actor: UserContext) {}

  private isPreview(): boolean {
    return this.actor.provider === 'preview';
  }

  async createSession(mode: SessionMode): Promise<SessionState> {
    const session = createInitialSession(this.actor.id, mode);
    if (this.isPreview()) {
      const store = memoryStore();
      store.users.set(this.actor.id, this.actor);
      store.sessions.set(session.id, clone(session));
      return session;
    }
    const admin = getSupabaseAdminClient();
    await assertCohortRoleAccess(this.actor.id, DEFAULT_COHORT_ID, 'student');
    const { error } = await admin.from('training_sessions').insert({
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
      return clone(session);
    }
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.from('training_sessions').select('state,user_id,cohort_id').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('SESSION_NOT_FOUND');
    if (this.actor.role === 'teacher') await assertTeacherCohortAccess(this.actor.id, data.cohort_id);
    else if (data.user_id !== this.actor.id) throw new Error('FORBIDDEN');
    return data.state as SessionState;
  }

  async saveSession(session: SessionState): Promise<void> {
    if (this.isPreview()) {
      memoryStore().sessions.set(session.id, clone(session));
      return;
    }
    if (session.userId !== this.actor.id) throw new Error('FORBIDDEN');
    const admin = getSupabaseAdminClient();
    const { error } = await admin.from('training_sessions').update({
      stage: session.stage,
      status: session.status,
      state: session,
      updated_at: session.updatedAt,
    }).eq('id', session.id).eq('user_id', this.actor.id);
    if (error) throw error;
    if (session.messages.length > 0) {
      const { error: messageError } = await admin.from('training_messages').upsert(session.messages.map((item) => ({
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
      const { error: operationError } = await admin.from('clinical_operations').upsert(session.events.map((item) => ({
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
    const admin = getSupabaseAdminClient();
    const { error } = await admin.from('agent_call_records').upsert({
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
    const admin = getSupabaseAdminClient();
    const { error } = await admin.from('training_reports').upsert({
      id: report.id,
      session_id: report.sessionId,
      user_id: report.userId,
      case_id: report.caseId,
      mode: report.mode,
      total_score: report.totalScore,
      data: report,
      status: report.status,
      created_at: report.createdAt,
    }, { onConflict: 'id' });
    if (error) throw error;
    const { error: abilityError } = await admin.from('ability_profiles').upsert({
      user_id: report.userId,
      dimensions: report.abilities,
      recommendation: { text: report.recommendation, improvements: report.improvements },
      source_report_id: report.id,
      updated_at: report.createdAt,
    }, { onConflict: 'user_id' });
    if (abilityError) throw abilityError;
    const { error: syncError } = await admin.from('sync_outbox').upsert({
      event_id: event.eventId,
      aggregate_type: event.recordType,
      aggregate_id: report.id,
      payload: event,
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
    }, { onConflict: 'event_id', ignoreDuplicates: true });
    if (syncError) throw syncError;
  }

  async getReport(id: string): Promise<TrainingReport> {
    if (this.isPreview()) {
      const report = memoryStore().reports.get(id);
      if (!report) throw new Error('REPORT_NOT_FOUND');
      if (this.actor.role !== 'teacher' && report.userId !== this.actor.id) throw new Error('FORBIDDEN');
      return clone(report);
    }
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.from('training_reports').select('data,user_id,session_id').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('REPORT_NOT_FOUND');
    if (this.actor.role === 'teacher') {
      const { data: session, error: sessionError } = await admin.from('training_sessions').select('cohort_id').eq('id', data.session_id).single();
      if (sessionError) throw sessionError;
      await assertTeacherCohortAccess(this.actor.id, session.cohort_id);
    } else if (data.user_id !== this.actor.id) throw new Error('FORBIDDEN');
    return data.data as TrainingReport;
  }

  async listOwnReports(): Promise<TrainingReport[]> {
    if (this.isPreview()) {
      return [...memoryStore().reports.values()].filter((report) => report.userId === this.actor.id).map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.from('training_reports').select('data').eq('user_id', this.actor.id).order('created_at', { ascending: false });
    if (error) throw error;
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
          latestMode: latest?.mode ?? 'osce',
          reportCount: reports.length || 1,
          latestReportId: latest?.id ?? null,
          latestSessionId: latestSession?.id ?? null,
          lastActiveAt: latestSession?.updatedAt ?? new Date(Date.now() - index * 86_400_000).toISOString(),
        };
      });
    }
    await assertTeacherCohortAccess(this.actor.id, DEFAULT_COHORT_ID);
    const admin = getSupabaseAdminClient();
    const { data: members, error } = await admin.from('cohort_members').select('user_id').eq('cohort_id', DEFAULT_COHORT_ID).eq('role', 'student');
    if (error) throw error;
    const ids = (members ?? []).map((row) => row.user_id as string);
    if (ids.length === 0) return [];
    const [{ data: profiles, error: profileError }, { data: reports, error: reportError }] = await Promise.all([
      admin.from('profiles').select('id,display_name,student_no').in('id', ids),
      admin.from('training_reports').select('id,session_id,user_id,total_score,mode,created_at').in('user_id', ids).order('created_at', { ascending: false }),
    ]);
    if (profileError) throw profileError;
    if (reportError) throw reportError;
    return (profiles ?? []).map((profile) => {
      const own = (reports ?? []).filter((report) => report.user_id === profile.id);
      const latest = own[0];
      return {
        id: profile.id,
        displayName: profile.display_name,
        studentNo: profile.student_no,
        latestScore: latest?.total_score ?? null,
        latestMode: (latest?.mode as SessionMode | undefined) ?? null,
        reportCount: own.length,
        latestReportId: latest?.id ?? null,
        latestSessionId: latest?.session_id ?? null,
        lastActiveAt: latest?.created_at ?? null,
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
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.from('training_sessions').select('state').eq('user_id', this.actor.id).order('updated_at', { ascending: false });
    if (error) throw error;
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
    const admin = getSupabaseAdminClient();
    const [{ data: profile, error: profileError }, { data: reportRow, error: reportError }] = await Promise.all([
      admin.from('profiles').select('id,display_name,student_no').eq('id', session.userId).single(),
      admin.from('training_reports').select('data').eq('session_id', id).maybeSingle(),
    ]);
    if (profileError) throw profileError;
    if (reportError) throw reportError;
    return { session, report: reportRow?.data as TrainingReport | null ?? null, student: { id: profile.id, displayName: profile.display_name, studentNo: profile.student_no } };
  }
}
