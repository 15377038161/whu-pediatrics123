import './fixtures/legacy-engine-catalog';
/**
 * 语音服务回归测试（阶段 D 补验 D-验收-01）：
 *  1. 能力探测：listVoices 成功不能推断 ASR/TTS 可用——两者分别经真实最小调用验证；
 *     TTS 失败时 ASR 无法验证，同样按 unavailable 处理（不宣称未经验证的可用）。
 *  2. 家长音色：按病例已知照护者性别选择；未知明确回退平台默认音色，不装作已知身份。
 *  3. TTS 合成守卫顺序：消息存在 → 角色可播报 → 非纯括注 → 患儿可言语；守卫命中即返回，
 *     不触发 SDK 调用（本文件全部测试不产生真实供应商调用）。
 * 探测执行器注入替身只验证分发逻辑；真实供应商链路由 scripts/verify-speech-sdk-smoke.ts 冒烟覆盖。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { VoiceInfo } from 'coder-coding-dev-sdk';
import { AudioDefaults } from 'coder-coding-dev-sdk';
import { createInitialSession } from '@/lib/agent-engine';
import type { AgentMessage } from '@/domain/agent';
import { COMMUNICATION_PROFILE_OVERRIDES, resolveCommunicationProfile } from '@/domain/communication-profile';
import {
  ROLE_VOICES,
  __resetVoiceCacheForTests,
  probeSpeechCapabilities,
  resolveParentVoicePreference,
  synthesizeRoleAudio,
} from '@/lib/speech-service';
import type { SpeechProbeDeps } from '@/lib/speech-service';

function fakeVoice(voiceId: string): VoiceInfo {
  return { voiceId, name: '测试音色', category: '通用', gender: 'female', provider: 'test' };
}

function fakeDeps(overrides: Partial<SpeechProbeDeps> = {}): SpeechProbeDeps {
  return {
    listVoices: async () => [fakeVoice('coder:female:default'), fakeVoice('coder:male:default')],
    synthesize: async () => ({ audioUrl: 'https://probe.internal/sanitized.mp3', audioSize: 8 }),
    downloadAudio: async () => Buffer.from('probe-audio'),
    recognize: async () => ({ text: '语音能力核验。' }),
    ...overrides,
  };
}

test('能力探测：listVoices 成功但 TTS 失败时，asr/tts 均如实 unavailable，音色数仍如实报告', async () => {
  __resetVoiceCacheForTests();
  const caps = await probeSpeechCapabilities(undefined, fakeDeps({
    synthesize: async () => { throw new Error('tts unavailable'); },
  }));
  assert.equal(caps.tts, 'unavailable');
  // ASR 探测依赖 TTS 探测音频；TTS 失败时 ASR 无法验证，不宣称可用
  assert.equal(caps.asr, 'unavailable');
  assert.equal(caps.voiceCount, 2);
});

test('能力探测：TTS 成功而 ASR 失败时，只有 tts=turn-based，asr 如实 unavailable', async () => {
  __resetVoiceCacheForTests();
  const caps = await probeSpeechCapabilities(undefined, fakeDeps({
    recognize: async () => { throw new Error('asr unavailable'); },
  }));
  assert.equal(caps.tts, 'turn-based');
  assert.equal(caps.asr, 'unavailable');
  assert.equal(caps.voiceCount, 2);
});

test('能力探测：全部真实最小调用成功时 asr/tts 均 turn-based，且成功结果短暂缓存不重复探测', async () => {
  __resetVoiceCacheForTests();
  let listCalls = 0;
  let synthCalls = 0;
  const deps = fakeDeps({
    listVoices: async () => { listCalls += 1; return [fakeVoice('coder:female:default')]; },
    synthesize: async () => { synthCalls += 1; return { audioUrl: 'https://probe.internal/sanitized.mp3', audioSize: 8 }; },
  });
  const first = await probeSpeechCapabilities(undefined, deps);
  assert.equal(first.asr, 'turn-based');
  assert.equal(first.tts, 'turn-based');
  assert.equal(first.voiceCount, 1);
  assert.equal(listCalls, 1);
  assert.equal(synthCalls, 1);
  // 命中缓存：不再次调用探测执行器
  const second = await probeSpeechCapabilities(undefined, fakeDeps({
    listVoices: async () => { throw new Error('不应再次探测'); },
  }));
  assert.deepEqual(second, first);
  assert.equal(listCalls, 1);
  assert.equal(synthCalls, 1);
});

test('家长音色：已知照护者性别按性别选择，未知明确回退平台默认音色', () => {
  assert.equal(resolveParentVoicePreference('female'), ROLE_VOICES.parentFemale);
  assert.equal(resolveParentVoicePreference('male'), ROLE_VOICES.parentMale);
  // 未知明确回退 SDK 官方默认音色（AudioDefaults.SPEAKER），不装作已知身份
  assert.equal(resolveParentVoicePreference('unknown'), AudioDefaults.SPEAKER);
  // 默认档照护者性别保持 unknown（原资料未逐例结构化，方案 9.2）
  assert.equal(resolveCommunicationProfile('any-case-id', '3岁2个月').caregiverGender, 'unknown');
});

test('TTS 守卫顺序：消息不存在/学生发言/纯括注/不能言语患儿语义台词均拒绝且不触发 SDK 调用', async () => {
  const session = createInitialSession('test-student', 'guided');
  const message = (id: string, actor: AgentMessage['actor'], content: string): AgentMessage => ({
    id,
    actor,
    content,
    emotion: 'neutral',
    kind: 'dialogue',
    createdAt: new Date().toISOString(),
  });
  session.messages.push(
    message('m-missing-target-parent', 'parent', '医生您好，孩子今天精神不太好。'),
    message('m-student', 'student', '孩子最近吃饭怎么样？'),
    message('m-child-parenthetical', 'child', '（哭闹不安）'),
    message('m-child-semantic', 'child', '我喉咙痛。'),
  );

  // 1. 消息不存在 → MESSAGE_NOT_FOUND（守卫先于任何 SDK 调用）
  const missing = await synthesizeRoleAudio(session, 'no-such-message');
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.error.code, 'MESSAGE_NOT_FOUND');

  // 2. 学生本人发言不参与角色播报 → NOT_SPEAKABLE
  const studentMsg = await synthesizeRoleAudio(session, 'm-student');
  assert.equal(studentMsg.ok, false);
  assert.equal(studentMsg.ok === false && studentMsg.error.code, 'NOT_SPEAKABLE');

  // 3. 纯括注（非言语舞台提示）不合成 → NOT_SPEAKABLE
  const parenthetical = await synthesizeRoleAudio(session, 'm-child-parenthetical');
  assert.equal(parenthetical.ok, false);
  assert.equal(parenthetical.ok === false && parenthetical.error.code, 'NOT_SPEAKABLE');

  // 4. 不能言语患儿（经审核覆盖 speechCapability=nonverbal）的语义台词不播报 → NOT_SPEAKABLE；
  //    覆盖表在测试后恢复（不把测试覆盖泄漏到其他用例）
  COMMUNICATION_PROFILE_OVERRIDES[session.caseId] = { speechCapability: 'nonverbal' };
  try {
    const nonverbalChild = await synthesizeRoleAudio(session, 'm-child-semantic');
    assert.equal(nonverbalChild.ok, false);
    assert.equal(nonverbalChild.ok === false && nonverbalChild.error.code, 'NOT_SPEAKABLE');
  } finally {
    delete COMMUNICATION_PROFILE_OVERRIDES[session.caseId];
  }
});
