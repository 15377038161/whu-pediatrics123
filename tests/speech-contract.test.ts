import assert from 'node:assert/strict';
import test from 'node:test';
import * as contract from '../src/domain/speech-contract';
test('语音默认不可用，契约没有默认实现、网络请求或假成功出口', () => {
  assert.deepEqual(contract.speechCapabilities, { asr: 'unavailable', tts: 'unavailable' });
  assert.ok(Object.isFrozen(contract.speechCapabilities));
  assert.deepEqual(Object.keys(contract), ['speechCapabilities']);
});
