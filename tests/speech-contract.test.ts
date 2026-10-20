import assert from 'node:assert/strict';
import test from 'node:test';
import * as contract from '../src/domain/speech-contract';

test('语音能力默认不可用且冻结，前端常量不决定启用状态', () => {
  assert.deepEqual(contract.UNAVAILABLE_SPEECH_CAPABILITIES, {
    asr: 'unavailable',
    tts: 'unavailable',
    voiceCount: 0,
  });
  assert.ok(Object.isFrozen(contract.UNAVAILABLE_SPEECH_CAPABILITIES));
});

test('isSpeechCapabilities 守卫：畸形/不可用探测结果按不可用处理', () => {
  assert.ok(contract.isSpeechCapabilities({ asr: 'unavailable', tts: 'unavailable', voiceCount: 0 }));
  assert.ok(contract.isSpeechCapabilities({ asr: 'turn-based', tts: 'turn-based', voiceCount: 16 }));
  assert.ok(!contract.isSpeechCapabilities(null));
  assert.ok(!contract.isSpeechCapabilities(undefined));
  assert.ok(!contract.isSpeechCapabilities({ asr: 'streaming', tts: 'turn-based', voiceCount: 16 }));
  assert.ok(!contract.isSpeechCapabilities({ asr: 'turn-based', tts: 'turn-based' }));
  assert.ok(!contract.isSpeechCapabilities({ asr: 'turn-based', tts: 'turn-based', voiceCount: -1 }));
});

test('语音轮状态机：合法转移封闭、未确认转写不可发送、不自动连录', () => {
  assert.ok(Object.isFrozen(contract.VOICE_TURN_TRANSITIONS));
  assert.ok(contract.canTransitionVoiceTurn('idle', 'recording'));
  assert.ok(contract.canTransitionVoiceTurn('recording', 'transcribing'));
  assert.ok(contract.canTransitionVoiceTurn('transcribing', 'confirming'));
  assert.ok(contract.canTransitionVoiceTurn('confirming', 'sending'));
  assert.ok(contract.canTransitionVoiceTurn('confirming', 'idle'));
  assert.ok(contract.canTransitionVoiceTurn('sending', 'idle'));
  assert.ok(contract.canTransitionVoiceTurn('failed', 'recording'));
  // 未确认的转写不能直接发送：transcribing → sending 不存在
  assert.ok(!contract.canTransitionVoiceTurn('transcribing', 'sending'));
  // 不自动连录：sending → recording 不存在，结束一轮后只能回到 idle 或失败回确认态
  assert.ok(!contract.canTransitionVoiceTurn('sending', 'recording'));
  // 发送失败回到确认态：草稿保留，可重试发送
  assert.ok(contract.canTransitionVoiceTurn('sending', 'confirming'));
  // 取消录音回到 idle 后可重新开始
  assert.ok(contract.canTransitionVoiceTurn('recording', 'idle'));
  // idle 不能直接转写/确认/发送
  assert.ok(!contract.canTransitionVoiceTurn('idle', 'transcribing'));
  assert.ok(!contract.canTransitionVoiceTurn('idle', 'sending'));
});

test('resolveSpeechTurnMeta：记录 ASR 原文与是否编辑，评分只看确认后语义', () => {
  assert.deepEqual(contract.resolveSpeechTurnMeta('孩子发烧两天了', '孩子发烧两天了'), {
    inputMode: 'voice',
    asrRawText: '孩子发烧两天了',
    transcriptEdited: false,
  });
  assert.deepEqual(contract.resolveSpeechTurnMeta('孩子发烧两天了', '孩子发烧三天了'), {
    inputMode: 'voice',
    asrRawText: '孩子发烧两天了',
    transcriptEdited: true,
  });
  // 仅首尾空白差异不算编辑
  const meta = contract.resolveSpeechTurnMeta(' 孩子发烧两天了 ', '孩子发烧两天了');
  assert.equal(meta.transcriptEdited, false);
});

test('契约模块只含纯类型与纯函数，不导出网络实现或假成功 adapter', () => {
  // interface/type 导出不进入运行时命名空间，只断言值导出清单
  const exported = Object.keys(contract).sort();
  assert.deepEqual(exported, [
    'UNAVAILABLE_SPEECH_CAPABILITIES',
    'VOICE_TURN_TRANSITIONS',
    'canTransitionVoiceTurn',
    'isSpeechCapabilities',
    'resolveSpeechTurnMeta',
  ]);
  for (const name of exported) {
    const value = (contract as Record<string, unknown>)[name];
    if (typeof value === 'function') {
      // 纯函数断言：不返回 Promise、不发起网络
      const isAsync = value.constructor.name === 'AsyncFunction';
      assert.ok(!isAsync, `${name} 不应是异步函数`);
    }
  }
});
