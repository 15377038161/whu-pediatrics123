import assert from 'node:assert/strict';
import { TEACHER_CASE_CATALOG } from '../src/domain/teacher-case-catalog';
import { getCase } from '../src/domain/case';

// Run against an isolated local preview started with ENABLE_AI_FIXTURE=true.
async function main() {
const base = process.env.CASE_VERIFY_URL || 'http://127.0.0.1:8876';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('仅允许在本地预览验证，避免向正式库写入测试记录');
const login = await fetch(`${base}/api/preview/login?role=student`, { redirect: 'manual' });
assert.equal(login.status, 307);
const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
assert.ok(cookie);
async function api(url: string, body?: unknown) {
  const response = await fetch(base + url, { headers: { cookie, 'content-type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const payload = await response.json();
  assert.ok(response.ok && payload.ok, `${url}: ${response.status} ${payload.error?.code ?? ''}`);
  return payload.data;
}
let completed = 0;
let sourceBacked = 0;
let playableVideos = 0;
const missing: string[] = [];
const sourceIds = new Set<string>();
const queue = [...TEACHER_CASE_CATALOG];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const item = queue.shift()!;
    const definition = getCase(item.id);
    const session = await api('/api/sessions', { mode: 'guided', caseId: item.id });
    assert.equal(session.caseId, item.id);
    assert.ok(session.caseOptions);
    if (definition.sourceFacts) { sourceBacked++; sourceIds.add(definition.sourceFacts.caseId); assert.equal(session.caseOptions.hasSource, true); }
    else missing.push(item.name);
    const turn = (type: string, data: unknown) => api('/api/agent/turn', { sessionId: session.id, clientEventId: crypto.randomUUID(), event: { type, data } });
    await turn('ASK_QUESTION', { text: '哪里不舒服？什么时候开始的？' });
    await turn('EXAM_ACTION', { toolId: 'hand-hygiene', bodyPartId: 'hands' });
    const exam = session.caseOptions.exams.find((entry: { toolId: string }) => entry.toolId !== 'hand-hygiene');
    if (exam) await turn('EXAM_ACTION', { toolId: exam.toolId, bodyPartId: exam.bodyPartId });
    if (session.caseOptions.tests[0]) await turn('ORDER_TEST', { testId: session.caseOptions.tests[0].id });
    await turn('SUBMIT_DECISION', { diagnosis: '验收用学生诊断思路', summary: '依据已获得的病例证据记录病情摘要，等待教师复核。', differentials: '验收记录，不作为临床标准答案。' });
    const plan = await turn('SUBMIT_PLAN', { priority: '进一步评估并观察病情', detail: '记录检查理由、后续安排与复评节点。' });
    assert.deepEqual(plan.session.vitals, session.vitals);
    await turn('SEND_COMMUNICATION', { text: '我理解您的担心，下一步结合检查评估病情风险并说明观察安排。' });
    const report = await api(`/api/sessions/${session.id}/finish`, {});
    assert.equal(report.caseId, item.id);
    assert.equal(report.scoreBasis, 'process');
    assert.equal(report.status, 'pending_review');
    const resources = await api(`/api/cases/${encodeURIComponent(item.id)}/resources`);
    if (definition.sourceFacts) assert.ok(resources.length > 0, `${item.name} 未关联任何文件`);
    const sample = resources.find((entry: { kind: string }) => entry.kind === 'image') ?? resources[0];
    if (sample) {
      const response = await fetch(`${base}/api/cases/${encodeURIComponent(item.id)}/resource?path=${encodeURIComponent(sample.path)}`, { headers: { cookie, range: 'bytes=0-31' } });
      assert.ok(response.status === 200 || response.status === 206, `${item.name} 资料不能读取`);
      await response.arrayBuffer();
    }
    for (const video of resources.filter((entry: { kind: string }) => entry.kind === 'video')) {
      const response = await fetch(`${base}/api/cases/${encodeURIComponent(item.id)}/resource?path=${encodeURIComponent(video.path)}`, { headers: { cookie, range: 'bytes=0-31' } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('content-type'), 'video/mp4');
      await response.arrayBuffer(); playableVideos++;
    }
    completed++;
  }
}));
assert.equal(completed, TEACHER_CASE_CATALOG.length);
assert.equal(sourceIds.size, 53);
assert.equal(sourceBacked, 67);
console.log(JSON.stringify({ verified: completed, sourceBacked, uniqueSourceCases: sourceIds.size, playableVideoEntries: playableVideos, noIndependentSource: missing }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : '病例验收失败'); process.exitCode = 1; });
