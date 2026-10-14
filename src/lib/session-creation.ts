import { createHash } from 'node:crypto';
export function creationSessionId(userId: string, requestId: string): string {
  const hex = createHash('sha256').update(`${userId}\0${requestId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface SessionCreationOptions {
  mode: 'guided' | 'practice' | 'osce' | 'immersive';
  caseId?: string;
  focus?: 'history' | 'exam' | 'safety' | 'communication';
  random?: boolean;
  excludeCaseId?: string;
  allowRepeat?: boolean;
  clientRequestId?: string;
}
export function creationFingerprint(options: SessionCreationOptions): string {
  return JSON.stringify([options.mode, options.caseId ?? null, options.focus ?? null, Boolean(options.random), options.excludeCaseId ?? null, Boolean(options.allowRepeat)]);
}
