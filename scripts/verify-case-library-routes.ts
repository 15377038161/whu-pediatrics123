/** All catalog entries through the actual route handlers with existing local
 * preview identities. No real OAuth/DB/browser/model/medical approval implied. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { setPreviewCookie } from '@/lib/preview-auth';
import { isDatabaseConfigured } from '@/lib/supabase-client';
import { CASE_CATALOG } from '@/domain/case-catalog';
import { getCase } from '@/domain/case';
import { resolveCaseId, publicCaseId } from '@/lib/case-identity';
import { POST as create } from '@/app/api/sessions/route';
import { POST as turn } from '@/app/api/agent/turn/route';
import { POST as finish } from '@/app/api/sessions/[id]/finish/route';
import { GET as restore } from '@/app/api/sessions/[id]/route';
import { GET as report } from '@/app/api/reports/[id]/route';
import { GET as catalog } from '@/app/api/cases/route';
import { AgentRepository } from '@/lib/repository';
import type { AgentEvent, SessionMode, PracticeFocus } from '@/domain/agent';

async function main() {
  if (isDatabaseConfigured() || process.env.CODER_PROJECT_ENV === 'PROD' || process.env.COZE_PROJECT_ENV === 'PROD') throw new Error('LOCAL_ONLY');
  process.env.ENABLE_UI_PREVIEW = 'true';
  process.env.ENABLE_AI_FIXTURE = 'true';
  const response = NextResponse.json({});
  setPreviewCookie(response, 'student');
  const cookie = response.cookies.get('luojia_peds_preview_student');
  assert.ok(cookie);
  const request = (url: string, body?: unknown) => new NextRequest(`http://localhost${url}`, {
    method: body ? 'POST' : 'GET', headers: { cookie: `${cookie.name}=${cookie.value}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const repo = new AgentRepository({ id: 'preview-student-001', role: 'student', displayName: '本地病例流程核验', studentNo: null, chaoxingUid: null, provider: 'preview', accessToken: null });
  const listed = await catalog(request('/api/cases'));
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).data.length, CASE_CATALOG.length);
  const rows: Array<Record<string, unknown>> = [];
  const paths: Array<{ mode: SessionMode; practiceFocus?: PracticeFocus }> = [
    { mode: 'guided' }, { mode: 'practice', practiceFocus: 'history' },
    { mode: 'practice', practiceFocus: 'exam' }, { mode: 'practice', practiceFocus: 'safety' },
    { mode: 'practice', practiceFocus: 'communication' }, { mode: 'osce' }, { mode: 'immersive' },
  ];
  const out = 'outputs/case-library-review/20261023';
  mkdirSync(out, { recursive: true });
  const save = () => writeFileSync(`${out}/route-verification.json`, JSON.stringify({ environment: 'local_route_handlers_preview_memory_ai_fixture',
    exclusions: ['real_oauth', 'production_database', 'real_model', 'browser', 'medical_approval'], cases: rows }, null, 2) + '\n');
  for (const entry of CASE_CATALOG) {
    const id = resolveCaseId(entry.id);
    const definition = getCase(id);
    const missing = definition.sourceFacts === null;
    for (const { mode, practiceFocus } of paths) {
      const row: Record<string, unknown> = { publicCaseId: publicCaseId(id), mode, practiceFocus, sourceAvailable: !missing, result: 'started', phase: 'create' };
      rows.push(row); save();
      try {
        const options = { mode, focus: practiceFocus, caseId: entry.id, clientRequestId: crypto.randomUUID() };
        const created = await create(request('/api/sessions', options));
        if (missing && mode === 'osce') {
          assert.equal(created.status, 403);
          assert.equal((await created.json()).error.code, 'CASE_INSUFFICIENT');
          row.result = 'expected_insufficient_guard'; save(); continue;
        }
        assert.equal(created.status, 201);
        const session = (await created.json()).data;
        const replay = await create(request('/api/sessions', options));
        assert.equal(replay.status, 201);
        assert.equal((await replay.json()).data.id, session.id);
        assert.equal(session.caseId, entry.id);
        assert.equal(session.caseOptions?.tests.length ?? 0, 0);
        const event = async (event: AgentEvent) => {
          row.phase = event.type;
          const result = await turn(request('/api/agent/turn', { sessionId: session.id, clientEventId: crypto.randomUUID(), event }));
          assert.equal(result.status, 200);
          const payload = (await result.json()).data;
          assert.ok(payload.trace.every((t: { sourceIds: string[] }) => t.sourceIds.length === 0));
          return payload;
        };
        if (mode !== 'practice' || practiceFocus === 'history') await event({ type: 'ASK_QUESTION', data: { text: '这次为什么来就诊，什么时候开始不舒服的？' } });
        if (mode === 'practice') {
          if (practiceFocus === 'history') await event({ type: 'SUBMIT_HISTORY_SUMMARY', data: { summary: '记录本次来诊原因、病程以及尚未获得的信息，后续继续核实。' } });
          if (practiceFocus === 'exam') {
            await event({ type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands' } });
            for (const exam of definition.exams.filter(e => e.toolId !== 'hand-hygiene')) {
              const result = await event({ type: 'EXAM_ACTION', data: { toolId: exam.toolId, bodyPartId: exam.bodyPartId, posture: 'supine' } });
              assert.ok(result.session.unlockedEvidence.includes(exam.evidenceCode));
            }
            const linkedEvidence = definition.exams.filter(e => e.toolId !== 'hand-hygiene').map(e => e.evidenceCode);
            if (linkedEvidence.length) await event({ type: 'SUBMIT_EXAM_OBSERVATION', data: { findings: '按本次实际操作记录所见。', interpretation: '对照本次取得的证据继续核实。', linkedEvidence } });
          }
          if (practiceFocus === 'safety') {
            await event({ type: 'SUBMIT_DECISION', data: { diagnosis: '待进一步评估', summary: '依据当前实际获得信息判断危险程度', diagnosisBasis: '记录已有事实和待核实信息', differentials: '进一步鉴别' } });
            await event({ type: 'SUBMIT_PLAN', data: { priority: '评估生命体征与风险', detail: '结合实际发现监测、复查和向家长解释安排。' } });
          }
          if (practiceFocus === 'communication') await event({ type: 'SEND_COMMUNICATION', data: { text: '我理解您的担心，我们先解释现有信息，再讨论需继续核实的问题和后续安排，并请您确认理解。' } });
        } else {
        if (mode === 'osce') await event({ type: 'NAVIGATE_STAGE', data: { stage: 'exam' } });
        await event({ type: 'EXAM_ACTION', data: { toolId: 'hand-hygiene', bodyPartId: 'hands', posture: 'standing' } });
        for (const exam of definition.exams.filter(e => e.toolId !== 'hand-hygiene')) {
          const result = await event({ type: 'EXAM_ACTION', data: { toolId: exam.toolId, bodyPartId: exam.bodyPartId, posture: 'supine' } });
          assert.ok(result.session.unlockedEvidence.includes(exam.evidenceCode));
        }
        if (mode === 'osce') await event({ type: 'NAVIGATE_STAGE', data: { stage: 'tests' } });
        for (const test of definition.tests) {
          await event({ type: 'ORDER_TEST', data: { testId: test.id } });
          assert.ok((await repo.getSession(session.id)).unlockedEvidence.includes(test.evidenceCode));
        }
        await event({ type: 'ORDER_TEST', data: { requestedTests: '不存在的检查项目' } });
        if (mode === 'osce') await event({ type: 'NAVIGATE_STAGE', data: { stage: 'assessment' } });
        await event({ type: 'SUBMIT_DECISION', data: { diagnosis: '待进一步核实的临床判断', summary: '根据本次已获得的病史查体和检查结果整理摘要', diagnosisBasis: '仅引用本轮已获得的临床证据，并注明需要继续核实的内容', differentials: '结合病程与证据进一步鉴别' } });
        if (mode !== 'osce') await event({ type: 'NAVIGATE_STAGE', data: { stage: 'tests' } });
        else await event({ type: 'NAVIGATE_STAGE', data: { stage: 'plan' } });
        await event({ type: 'SUBMIT_PLAN', data: { priority: '评估并监测病情', detail: '根据当前已获得的证据进一步评估并向家长解释复查安排' } });
        await event({ type: 'SEND_COMMUNICATION', data: { text: '我们先解释已经得到的检查结果，再一起讨论仍需核实的问题和后续安排。' } });
        }
        row.phase = 'finish';
        const ctx = { params: Promise.resolve({ id: session.id }) };
        const finished = await finish(request(`/api/sessions/${session.id}/finish`, {}), ctx);
        assert.equal(finished.status, 201);
        const finalReport = (await finished.json()).data;
        const repeated = await finish(request(`/api/sessions/${session.id}/finish`, {}), ctx);
        assert.equal(repeated.status, 200);
        assert.equal((await repeated.json()).data.id, finalReport.id);
        const restored = await restore(request(`/api/sessions/${session.id}`), ctx);
        assert.equal(restored.status, 200);
        const restoredState = (await restored.json()).data;
        assert.equal(restoredState.caseId, entry.id);
        assert.equal(restoredState.sourceSnapshotVersion, session.sourceSnapshotVersion);
        assert.equal(restoredState.status, 'completed');
        const reportRead = await report(request(`/api/reports/${finalReport.id}`), { params: Promise.resolve({ id: finalReport.id }) });
        assert.equal(reportRead.status, 200);
        assert.equal((await reportRead.json()).data.id, finalReport.id);
        Object.assign(row, { result: missing ? 'insufficient_guided_process_only' : 'passed', phase: 'complete', examCount: mode === 'practice' && practiceFocus !== 'exam' ? 0 : definition.exams.length - 1, testCount: mode === 'practice' ? 0 : definition.tests.length });
      } catch (error) {
        row.result = 'failed';
        // Assertions may carry patient values. Persist only generic failure type.
        row.errorType = error instanceof Error ? error.name : 'UnknownError';
      }
      save();
    }
  }
  const failed = rows.filter(row => row.result === 'failed');
  console.log(JSON.stringify({ catalogEntries: CASE_CATALOG.length, modeRuns: rows.length, passed: rows.filter(r => r.result === 'passed').length,
    insufficientGuidedOnly: rows.filter(r => r.result === 'insufficient_guided_process_only').length,
    expectedInsufficientGuards: rows.filter(r => r.result === 'expected_insufficient_guard').length,
    failures: failed.map(({ publicCaseId, mode, phase }) => ({ publicCaseId, mode, phase })) }, null, 2));
  if (failed.length) process.exitCode = 1;
}
main().catch(() => { console.error('本地全量路由验证未完成；详见分阶段脱敏记录。'); process.exitCode = 1; });
