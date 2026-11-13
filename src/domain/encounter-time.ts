export interface EncounterTimeContext {
  time: string;
  ageAtEncounter: string;
  note: string;
}

/**
 * 只从明确的入院/就诊上下文提取时点。没有原文依据时返回 undefined，
 * 不使用系统当前日期，也不由年龄反推精确出生日期。
 */
export function sourceEncounterContext(history: string, age: string): EncounterTimeContext | undefined {
  const lines = history.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? '';
    if (!/入院|就诊/.test(`${lines[index - 1] ?? ''}\n${line}`)) continue;
    const match = line.match(/(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})日?(?:\s*(\d{1,2})[:时](\d{1,2})?)?/);
    if (!match) continue;
    const [, year, month, day, hour, minute] = match;
    const time = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}${hour ? ` ${hour.padStart(2, '0')}:${(minute ?? '00').padStart(2, '0')}` : ''}`;
    return { time, ageAtEncounter: age, note: '年龄与相对时间均以本次就诊时点为准，不按系统当前日期换算。' };
  }
  return undefined;
}
