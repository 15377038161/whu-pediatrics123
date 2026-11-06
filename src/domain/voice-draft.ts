/** 将识别文本追加到当前字段草稿；已有文字与结尾空白原样保留，不触发提交。 */
export function appendVoiceTranscript(existing: string, transcript: string): string {
  const addition = transcript.trim();
  if (!addition) return existing;
  if (!existing.trim()) return addition;
  const separator = /[\s，。！？；：,.!?;:]$/u.test(existing) ? '' : ' ';
  return `${existing}${separator}${addition}`;
}
