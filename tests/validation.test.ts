import assert from 'node:assert/strict';
import test from 'node:test';
import { agentTurnSchema } from '@/lib/validation';

test('统一智能体事件拒绝空问诊和未知事件', () => {
  const base = { sessionId: '10000000-0000-4000-8000-000000000001', clientEventId: 'client-event-001' };
  assert.equal(agentTurnSchema.safeParse({ ...base, event: { type: 'ASK_QUESTION', data: { text: '  ' } } }).success, false);
  assert.equal(agentTurnSchema.safeParse({ ...base, event: { type: 'UNKNOWN', data: {} } }).success, false);
  assert.equal(agentTurnSchema.safeParse({ ...base, event: { type: 'DOCTOR_INTERVENTION', data: { action: 'comfort_child' } } }).success, true);
});
