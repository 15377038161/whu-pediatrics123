import assert from 'node:assert/strict';
import test from 'node:test';
import { appendVoiceTranscript } from '../src/domain/voice-draft';

test('语音结果追加到当前草稿并保留已有文字', () => {
  assert.equal(appendVoiceTranscript('先给予氧疗', '监测血氧'), '先给予氧疗 监测血氧');
  assert.equal(appendVoiceTranscript('先给予氧疗。', '监测血氧'), '先给予氧疗。监测血氧');
  assert.equal(appendVoiceTranscript('先给予氧疗\n', '监测血氧'), '先给予氧疗\n监测血氧');
});

test('空白识别结果不改变草稿，空草稿直接回填识别文本', () => {
  assert.equal(appendVoiceTranscript('原有内容', '  '), '原有内容');
  assert.equal(appendVoiceTranscript('', '  监测血氧  '), '监测血氧');
  assert.equal(appendVoiceTranscript('  ', '监测血氧'), '监测血氧');
});
