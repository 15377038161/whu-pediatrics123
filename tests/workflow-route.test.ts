import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest, NextResponse } from 'next/server';
import { setPreviewCookie } from '../src/lib/preview-auth';
import { POST as create } from '../src/app/api/sessions/route';
import { POST as turn } from '../src/app/api/agent/turn/route';
import { POST as finish } from '../src/app/api/sessions/[id]/finish/route';
import { GET as reports } from '../src/app/api/reports/route';
import { AgentRepository } from '../src/lib/repository';

test('真实路由合成身份：创建→问查→检查→诊断→返回补查→修订→报告，匿名及跨学生拒绝', async () => {
  const saved = { preview: process.env.ENABLE_UI_PREVIEW, fixture: process.env.ENABLE_AI_FIXTURE };
  process.env.ENABLE_UI_PREVIEW = 'true'; process.env.ENABLE_AI_FIXTURE = 'true';
  try {
    const response = NextResponse.json({});
    setPreviewCookie(response, 'student');
    const cookie = response.cookies.get('luojia_peds_preview_student');
    assert.ok(cookie);
    const request = (path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
      method: body ? 'POST' : 'GET', headers: { cookie: `${cookie.name}=${cookie.value}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal((await create(new NextRequest('http://localhost/api/sessions', { method: 'POST', body: '{}' }))).status, 401);
    const options = { mode: 'guided', caseId: 'peds-respiratory-001', clientRequestId: crypto.randomUUID() };
    const created = await create(request('/api/sessions', options));
    assert.equal(created.status, 201);
    const session = (await created.json()).data;
    const retry = await create(request('/api/sessions', options));
    assert.equal((await retry.json()).data.id, session.id);
    const event = async (type: string, data: unknown) => {
      const result = await turn(request('/api/agent/turn', { sessionId: session.id, clientEventId: crypto.randomUUID(), event: { type, data } }));
      assert.equal(result.status, 200);
      return (await result.json()).data;
    };
    await event('ASK_QUESTION', { text: '哪里不舒服？什么时候开始？有没有呼吸困难？' });
    await event('EXAM_ACTION', { toolId: 'hand-hygiene', bodyPartId: 'hands', posture: 'standing' });
    await event('EXAM_ACTION', { toolId: 'stethoscope', bodyPartId: 'chest', posture: 'standing' });
    await event('ORDER_TEST', { requestedTests: '胸部影像' });
    const decision = { diagnosis: '学生诊断', summary: '根据本次问查记录形成病情摘要', diagnosisBasis: '已获取的病史和查体记录支持学生初步判断', differentials: '' };
    await event('SUBMIT_DECISION', decision);
    await event('NAVIGATE_STAGE', { stage: 'tests' });
    await event('ORDER_TEST', { requestedTests: '不存在的检查' });
    await event('SUBMIT_DECISION', { ...decision, diagnosisBasis: '补查后修订的最终诊断依据，未获得结果不作为阳性证据' });
    await event('SUBMIT_PLAN', { priority: '进一步评估', detail: '记录观察及复评安排' });
    await event('SEND_COMMUNICATION', { text: '我理解您很担心，接下来会继续评估并说明情况。' });
    const done = await finish(request(`/api/sessions/${session.id}/finish`, {}), { params: Promise.resolve({ id: session.id }) });
    assert.equal(done.status, 201);
    const report = (await done.json()).data;
    assert.match(report.studentDecision.diagnosisBasis, /最终诊断依据/);
    assert.equal((await reports(request('/api/reports'))).status, 200);
    const other = new AgentRepository({ id: 'preview-other-student', role: 'student', displayName: '合成另一学生', studentNo: null, chaoxingUid: null, provider: 'preview', accessToken: null });
    await assert.rejects(other.getSession(session.id), /FORBIDDEN/);
    await assert.rejects(other.getReport(report.id), /FORBIDDEN/);
  } finally {
    if (saved.preview === undefined) delete process.env.ENABLE_UI_PREVIEW; else process.env.ENABLE_UI_PREVIEW = saved.preview;
    if (saved.fixture === undefined) delete process.env.ENABLE_AI_FIXTURE; else process.env.ENABLE_AI_FIXTURE = saved.fixture;
  }
});
