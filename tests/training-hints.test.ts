import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSession } from '@/lib/agent-engine';
import { progressHints } from '@/domain/training-hints';
test('hints track preparation and acquired history rather than repeat completed actions',()=>{
 const session=createInitialSession('synthetic','guided','teacher-川崎病');
 assert.match(progressHints(session,'exam')[0],/尚未完成手卫生/);
 session.unlockedEvidence.push('EX_PREP');
 assert.ok(progressHints(session,'exam').every(hint=>!hint.includes('先向患儿和家长说明')));
 assert.ok(progressHints(session,'history').some(hint=>hint.includes('起病时间')));
 session.askedIntents.push('SOURCE_HX_0','SOURCE_HX_2','SOURCE_HX_4');
 assert.ok(progressHints(session,'history').every(hint=>!hint.includes('起病时间和病程演变还没有')));
 session.orderedTests.push('source-test-0');assert.match(progressHints(session,'tests')[0],/已有检查/);
});
